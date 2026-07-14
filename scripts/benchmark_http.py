#!/usr/bin/env python3
"""Dependency-free HTTP concurrency benchmark for ShennongDB.

The runner keeps one HTTP/1.1 connection per worker and emits machine-readable
JSON. It is intentionally small enough to run in release CI and on air-gapped
production hosts.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import http.client
import json
import math
import platform
import socket
import statistics
import sys
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


DEFAULT_QUERY = {
    "resource": "toil",
    "operation": "expression",
    "feature": {"type": "gene", "name": "ENSG00000198492.14"},
    "context": {
        "disease": "Skin Cutaneous Melanoma",
        "sample_type": "Primary Tumor",
    },
    "options": {"limit": 1000},
}


@dataclass(frozen=True)
class Scenario:
    name: str
    method: str
    path: str
    requests: int
    concurrency: int
    body: bytes | None = None


@dataclass
class Sample:
    latency_ms: float
    status: int | None
    response_bytes: int
    error: str | None


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def connection_for(parsed: Any, timeout: float) -> http.client.HTTPConnection:
    connection_type = (
        http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    )
    return connection_type(parsed.hostname, parsed.port, timeout=timeout)


def worker(
    parsed: Any,
    scenario: Scenario,
    count: int,
    timeout: float,
    headers: dict[str, str],
) -> list[Sample]:
    samples: list[Sample] = []
    connection = connection_for(parsed, timeout)
    request_headers = {"accept": "application/json", "connection": "keep-alive", **headers}
    if scenario.body is not None:
        request_headers["content-type"] = "application/json"
    target = f"{parsed.path.rstrip('/')}{scenario.path}" or "/"

    for _ in range(count):
        started = time.perf_counter_ns()
        try:
            connection.request(scenario.method, target, scenario.body, request_headers)
            response = connection.getresponse()
            payload = response.read()
            samples.append(
                Sample(
                    latency_ms=(time.perf_counter_ns() - started) / 1_000_000,
                    status=response.status,
                    response_bytes=len(payload),
                    error=None,
                )
            )
        except (OSError, http.client.HTTPException) as error:
            samples.append(
                Sample(
                    latency_ms=(time.perf_counter_ns() - started) / 1_000_000,
                    status=None,
                    response_bytes=0,
                    error=f"{type(error).__name__}: {error}",
                )
            )
            try:
                connection.close()
            finally:
                connection = connection_for(parsed, timeout)
    connection.close()
    return samples


def run_scenario(
    base_url: str,
    scenario: Scenario,
    timeout: float,
    headers: dict[str, str],
    warmup: int,
) -> dict[str, Any]:
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError(f"invalid base URL: {base_url}")

    if warmup:
        worker(parsed, scenario, warmup, timeout, headers)

    counts = [scenario.requests // scenario.concurrency] * scenario.concurrency
    for index in range(scenario.requests % scenario.concurrency):
        counts[index] += 1

    started = time.perf_counter()
    samples: list[Sample] = []
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=scenario.concurrency,
        thread_name_prefix="shennong-benchmark",
    ) as executor:
        futures = [
            executor.submit(worker, parsed, scenario, count, timeout, headers)
            for count in counts
            if count
        ]
        for future in concurrent.futures.as_completed(futures):
            samples.extend(future.result())
    elapsed = time.perf_counter() - started

    latencies = [sample.latency_ms for sample in samples]
    statuses = Counter(str(sample.status) if sample.status is not None else "transport_error" for sample in samples)
    errors = Counter(sample.error for sample in samples if sample.error)
    successes = sum(1 for sample in samples if sample.status is not None and 200 <= sample.status < 400)
    return {
        "name": scenario.name,
        "method": scenario.method,
        "path": scenario.path,
        "requests": len(samples),
        "concurrency": scenario.concurrency,
        "elapsed_seconds": round(elapsed, 6),
        "requests_per_second": round(len(samples) / elapsed, 3) if elapsed else 0.0,
        "successes": successes,
        "error_rate": round(1 - successes / len(samples), 6) if samples else 1.0,
        "status_counts": dict(sorted(statuses.items())),
        "response_bytes_total": sum(sample.response_bytes for sample in samples),
        "latency_ms": {
            "min": round(min(latencies), 3) if latencies else 0.0,
            "mean": round(statistics.fmean(latencies), 3) if latencies else 0.0,
            "p50": round(percentile(latencies, 0.50), 3),
            "p90": round(percentile(latencies, 0.90), 3),
            "p95": round(percentile(latencies, 0.95), 3),
            "p99": round(percentile(latencies, 0.99), 3),
            "max": round(max(latencies), 3) if latencies else 0.0,
        },
        "errors": dict(errors.most_common(10)),
    }


def default_scenarios(requests: int, query_requests: int) -> list[Scenario]:
    query = json.dumps(DEFAULT_QUERY, separators=(",", ":")).encode()
    scenarios = []
    for concurrency in (1, 8, 32, 64):
        scenarios.extend(
            [
                Scenario("health", "GET", "/health", requests, concurrency),
                Scenario("readiness", "GET", "/healthz", requests, concurrency),
                Scenario("catalog", "GET", "/api/v1/resources", requests, concurrency),
                Scenario(
                    "agent-discovery",
                    "GET",
                    "/.well-known/shennong-agent.json",
                    requests,
                    concurrency,
                ),
            ]
        )
    for concurrency in (1, 4, 8):
        scenarios.append(
            Scenario("toil-expression", "POST", "/api/v1/query", query_requests, concurrency, query)
        )
    return scenarios


def parse_headers(values: list[str]) -> dict[str, str]:
    headers: dict[str, str] = {}
    for value in values:
        if ":" not in value:
            raise ValueError(f"header must use NAME:VALUE syntax: {value}")
        name, content = value.split(":", 1)
        headers[name.strip()] = content.strip()
    return headers


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:18080")
    parser.add_argument("--requests", type=int, default=200, help="requests per metadata scenario")
    parser.add_argument("--query-requests", type=int, default=20, help="requests per query scenario")
    parser.add_argument("--warmup", type=int, default=3, help="warm-up requests per scenario")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--header", action="append", default=[], help="repeatable NAME:VALUE header")
    parser.add_argument("--output", type=Path, help="write JSON to this path")
    args = parser.parse_args()
    if args.requests < 1 or args.query_requests < 1 or args.warmup < 0:
        parser.error("request counts must be positive and warmup must not be negative")

    try:
        headers = parse_headers(args.header)
        scenarios = default_scenarios(args.requests, args.query_requests)
        results = []
        for scenario in scenarios:
            print(
                f"running {scenario.name} c={scenario.concurrency} n={scenario.requests}",
                file=sys.stderr,
                flush=True,
            )
            results.append(
                run_scenario(args.base_url, scenario, args.timeout, headers, args.warmup)
            )
    except (ValueError, OSError) as error:
        print(f"benchmark failed: {error}", file=sys.stderr)
        return 2

    output = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_url": args.base_url,
        "host": {
            "hostname": socket.gethostname(),
            "platform": platform.platform(),
            "python": platform.python_version(),
            "logical_cpus": __import__("os").cpu_count(),
        },
        "methodology": {
            "connection_model": "one persistent HTTP/1.1 connection per worker",
            "warmup_requests_per_scenario": args.warmup,
            "timeout_seconds": args.timeout,
            "latency_clock": "time.perf_counter_ns",
        },
        "results": results,
    }
    rendered = json.dumps(output, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return 0 if all(result["error_rate"] == 0 for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
