# Benchmark Results and Performance Plan

This document records reproducible ShennongDB API and WebUI performance results. Raw measurements are committed beside it so later releases can be compared without copying values from prose.

## Current verdict

The measured deployment is responsive and error-free for the tested single-host workload. Public metadata scales to roughly 1,300–3,200 requests/second depending on the endpoint. The real Toil expression query scales from 8.46 requests/second at one worker to 26.73 requests/second at eight workers, with p95 latency increasing from 134 ms to 347 ms.

The main observed saturation signal is the catalog path: p95 latency rises from 4 ms at one worker to 75 ms at 32 workers and 109 ms at 64 workers while throughput stays near 1,200–1,340 requests/second. This is queueing rather than an error cliff. The current ten-connection PostgreSQL pool is smaller than the 64-request global concurrency limit, so database-backed routes need mixed-workload and pool-wait instrumentation before a production capacity claim.

The catalog read and asynchronous usage-event insert share that PostgreSQL pool. The request-usage middleware also buffers non-download responses when no content length is present before spawning the insert. Those code paths are plausible contributors to the catalog tail-latency and memory/IO deltas, but this run cannot attribute time between pool wait, SQL execution, response measurement, and the BFF; the missing instrumentation must be added before calling any one of them the confirmed root cause.

The WebUI passes laboratory Core Web Vitals thresholds for the measured public routes: median LCP is 0.85–0.96 seconds and median CLS is 0–0.01. The landing page and Catalog each request `/api/v1/auth/session` anonymously and receive `401`; it does not break rendering, but it is unnecessary request/error noise.

## Snapshot identity

| Field | Value |
|---|---|
| Measurement date | 2026-07-14 (Asia/Shanghai) |
| Checkout | `main@560c6398e4de` |
| Running deployment | ShennongDB `0.5.2`, all-in-one container, host port `18080` |
| Host | `miga`, Linux `7.0.0-27-generic`, x86-64 |
| CPU | Intel Core Ultra 9 285HX, 24 logical CPUs |
| Memory | 91 GiB total |
| Dataset | Toil TCGA/TARGET/GTEx, 60,498 features and 19,131 samples |
| Load generator | Same host, persistent HTTP/1.1 connection per worker |
| Browser | Playwright Chromium, cold browser context and disabled cache per run |

The running `0.5.2` image does not contain the unreleased Research Graph changes at checkout `560c6398e4de`. Results therefore describe the currently deployed API/WebUI, not a build of the exact checkout. Port `18080` is the Next.js public boundary; the Rust API is bound inside the container, so `/api/v1` figures include BFF overhead and cannot be separated into Rust-only and BFF-only latency in this run.

## API and data-access results

Each metadata point contains 200 measured requests after three warm-up requests. Each Toil point contains 20 measured queries after three warm-ups. The query returns 1,000 bounded rows in a 21,976-byte JSON response. There were 3,260 measured requests in total, with no HTTP errors, transport errors, `429`, or `5xx` responses.

| Scenario | Concurrency | Requests/s | p50 | p95 | p99 | Error rate |
|---|---:|---:|---:|---:|---:|---:|
| Process health | 1 | 1,234 | 0.8 ms | 1.4 ms | 1.7 ms | 0% |
| Process health | 8 | 2,448 | 2.7 ms | 6.2 ms | 7.2 ms | 0% |
| Process health | 32 | 3,201 | 8.4 ms | 12.6 ms | 13.7 ms | 0% |
| Process health | 64 | 3,189 | 15.9 ms | 21.4 ms | 33.3 ms | 0% |
| PostgreSQL + ClickHouse readiness | 1 | 591 | 1.7 ms | 2.5 ms | 2.9 ms | 0% |
| PostgreSQL + ClickHouse readiness | 8 | 2,859 | 2.8 ms | 4.0 ms | 4.9 ms | 0% |
| PostgreSQL + ClickHouse readiness | 32 | 2,801 | 10.9 ms | 12.0 ms | 12.5 ms | 0% |
| PostgreSQL + ClickHouse readiness | 64 | 2,580 | 16.8 ms | 31.1 ms | 32.2 ms | 0% |
| PostgreSQL Resource catalog | 1 | 325 | 2.9 ms | 4.1 ms | 5.5 ms | 0% |
| PostgreSQL Resource catalog | 8 | 1,327 | 5.7 ms | 8.5 ms | 9.6 ms | 0% |
| PostgreSQL Resource catalog | 32 | 1,216 | 14.8 ms | 75.3 ms | 118.1 ms | 0% |
| PostgreSQL Resource catalog | 64 | 1,337 | 8.1 ms | 109.1 ms | 123.2 ms | 0% |
| Agent manifest | 1 | 923 | 0.9 ms | 2.2 ms | 3.0 ms | 0% |
| Agent manifest | 8 | 2,908 | 2.4 ms | 4.6 ms | 6.5 ms | 0% |
| Agent manifest | 32 | 3,103 | 9.1 ms | 10.4 ms | 11.5 ms | 0% |
| Agent manifest | 64 | 3,155 | 9.0 ms | 16.6 ms | 16.8 ms | 0% |
| Toil expression, 1,000 rows | 1 | 8.46 | 113.6 ms | 133.7 ms | 153.2 ms | 0% |
| Toil expression, 1,000 rows | 4 | 19.14 | 204.3 ms | 239.9 ms | 267.6 ms | 0% |
| Toil expression, 1,000 rows | 8 | 26.73 | 246.8 ms | 347.3 ms | 359.0 ms | 0% |

The eight-worker query throughput is 3.16 times the single-worker result, while median latency is 2.17 times higher. This is useful parallel scaling but not linear scaling. Concurrency eight matches the server's default query semaphore; higher query concurrency should be tested only in an isolated environment because the default per-IP limit is 120 queries/minute.

### Container-level delta

The cgroup accumulated 15.49 CPU-seconds over the 8.0-second HTTP run, or about 1.94 CPU cores on average. Memory current increased from 3.36 GiB to 4.47 GiB, cgroup writes increased by 22.7 MiB, reads did not increase, and CPU throttling remained zero. The memory delta includes filesystem/database cache and is not a leak claim; a soak test with periodic RSS, anonymous memory, page cache, and post-test recovery is required.

## WebUI results

Each route was measured five times with a new Chromium context, browser cache disabled, `networkidle`, and a further 250 ms observation window.

| Route | Median TTFB | Median FCP | Median LCP | Median CLS | Median load | Transfer | Browser errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/` | 10.3 ms | 864 ms | 924 ms | 0.01 | 2,259 ms | 212 KiB | `401 GET /api/v1/auth/session` |
| `/catalog` | 3.2 ms | 856 ms | 920 ms | 0.01 | 2,472 ms | 212 KiB | `401 GET /api/v1/auth/session` |
| `/docs` | 2.9 ms | 920 ms | 956 ms | 0 | 2,000 ms | 184 KiB | none |
| `/support` | 2.8 ms | 836 ms | 852 ms | 0 | 2,243 ms | 183 KiB | none |
| `/auth/sign-in` | 2.7 ms | 840 ms | 868 ms | 0 | 2,245 ms | 192 KiB | none |

The navigation response is fast; rendering dominates. Initial transfer is modest, but the 2.0–2.5 second load event and anonymous-session `401` should be tracked after frontend dependency or authentication changes. INP is intentionally absent: it is an interaction/field metric and cannot be inferred responsibly from navigation-only runs.

## Reproduce

Run the dependency-free HTTP benchmark:

```bash
python3 scripts/benchmark_http.py \
  --base-url http://127.0.0.1:18080 \
  --requests 200 \
  --query-requests 20 \
  --warmup 3 \
  --output docs/benchmarks/$(date +%F)-http.json
```

Run browser measurements after installing WebUI dependencies and Playwright Chromium:

```bash
cd webui
node scripts/benchmark-web.mjs \
  --base-url http://127.0.0.1:18080 \
  --runs 5 \
  --output ../docs/benchmarks/$(date +%F)-webui.json
```

Raw results for this snapshot:

- [HTTP concurrency and query data](benchmarks/2026-07-14-http.json)
- [WebUI browser data](benchmarks/2026-07-14-webui.json)
- [Container cgroup snapshots](benchmarks/2026-07-14-cgroup.json)

## Production and publication measurement plan

Do not treat this snapshot as a production capacity limit or a publication benchmark. A defensible campaign needs the following dimensions.

| Area | Required metrics | Method |
|---|---|---|
| Reliability | success rate, timeout rate, status distribution, retry count | mixed workload plus failure injection |
| Latency | p50/p90/p95/p99/max, queue time, service time, first-byte time | per endpoint and query class |
| Capacity | requests/s, rows/s, bytes/s, active requests, saturation point | stepped concurrency until the SLO fails |
| Resources | CPU, RSS, anonymous/cache memory, allocation rate, disk IOPS/latency, network bytes | cgroup/container and host telemetry |
| PostgreSQL | pool in-use/idle/waiters, acquire latency, query duration, locks, cache hit ratio, temporary bytes, WAL | SQLx pool hooks, `pg_stat_statements`, PostgreSQL metrics |
| ClickHouse | query duration, scanned rows/bytes, cache hit/miss/fill time, merges, memory | `system.query_log` and server metrics |
| TileDB/file access | subprocess queue time, open/read bytes, decompression time, rows decoded, cold/warm cache | executor instrumentation and OS cache-controlled runs |
| Object storage | first-byte latency, throughput, retries, multipart latency, range-read amplification | S3 client metrics and representative artifact sizes |
| WebUI | TTFB, FCP, LCP, CLS, INP, JS/CSS bytes, hydration time, API waterfalls, console/request errors | lab runs plus real-user monitoring |
| Stability | latency drift, memory recovery, connection growth, error accumulation | 1-hour and 24-hour soak tests |
| Recovery | restart/readiness time, dependency outage behavior, backlog drain time | PostgreSQL/ClickHouse/S3 interruption tests |

For publication, pin and disclose the commit, image digest, dataset versions and checksums, hardware, kernel, storage device, filesystem, runtime configuration, query corpus, payload sizes, cold/warm-cache definition, repetitions, randomization order, and raw measurements. Use at least 30 independent samples per reported distribution, report confidence intervals and effect sizes, and separate metadata, cached analytical, uncached analytical, TileDB, and object-streaming workloads. Compare systems only with equivalent data, query semantics, result sizes, and durability guarantees.

### Proposed release gates

These are engineering targets, not measured service-level agreements:

- zero unexpected errors in a 15-minute target-load run;
- metadata p95 at or below 100 ms and p99 at or below 250 ms at the declared production concurrency;
- representative 1,000-row analytical query p95 at or below 500 ms at query concurrency eight;
- no sustained memory growth after a one-hour steady-state soak and a 10-minute recovery window;
- WebUI p75 LCP at or below 2.5 seconds, CLS at or below 0.1, and INP at or below 200 ms from field data;
- readiness accurately fails within the dependency timeout and recovers without manual intervention;
- no hidden `401`, `404`, or `5xx` browser request noise on public pages.

## Current observability gaps

The Rust `/metrics` endpoint currently exposes only ClickHouse cache hit, miss,
and maximum-byte values. The deployed snapshot used for this benchmark did not
proxy `/metrics` or `/version` through the public Next.js boundary. The current
checkout now proxies both paths, and the rebuilt all-in-one image returned `200`
for them during smoke testing. Usage events persist request latency and response
bytes, but production monitoring still needs request-duration histograms,
status/method/route counters, in-flight gauges, rate-limit counters, SQLx pool
wait metrics, backend-specific durations, process/cgroup metrics, and WebUI
field telemetry.

Do not increase the current limits until those signals exist. Defaults at this checkout are 64 global requests, 10 PostgreSQL connections, eight analytical queries, four TileDB subprocesses, and eight downloads. Capacity changes must be validated as a coordinated queueing system rather than one limit at a time.
