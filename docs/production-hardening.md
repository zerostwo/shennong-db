# Production Hardening Test Baseline

`P0-00` uses a dedicated Compose project, temporary data and PostgreSQL
volumes, and tiny fixtures. It never mounts the production data directory and
removes all test volumes on exit.

Run the complete integration baseline from the repository root:

```bash
./scripts/test-platform.sh
```

If Docker requires elevated access on the host:

```bash
COMPOSE_COMMAND='sudo docker compose' ./scripts/test-platform.sh
```

Set `SHENNONG_TEST_PULL=0` only for an offline run using already cached base
images. To exercise the API checks against an already built image without
building, set `SHENNONG_TEST_IMAGE` to that local image tag. When combining it
with sudo, preserve that variable explicitly:

```bash
SHENNONG_TEST_IMAGE=zerostwo/shennong-db:0.5.2 \
  COMPOSE_COMMAND='sudo --preserve-env=SHENNONG_TEST_IMAGE docker compose' \
  DOCKER_COMMAND='sudo docker' \
  ./scripts/test-platform.sh
```

The default always builds and pulls current base-image metadata.

By default the command builds `shennong-db:test`; every mode validates the test
Compose file, starts an isolated stack, and checks:

- `/health` and `/healthz`;
- public Resource reads;
- fail-closed Resource permissions: missing visibility is private and invalid
  visibility/scope payloads return `422`;
- private Resource enumeration protection (`404`), explicit grants, required
  scopes, disabled-user denial, and active-admin access;
- consistent private-resource authorization for lists, details, artifacts,
  relations, download, query, gene resolution, and agent discovery;
- streamed Artifact downloads with full and HTTP Range response checks,
  invalid-range rejection, a large sparse-file probe, and concurrency limiting;
- bounded TileDB subprocesses and shared ClickHouse HTTP clients, including
  timeout, output-cap, non-zero-exit, and concurrency regression checks;
- atomic seed import and provider-ingestion state checks, including failed
  transaction rollback, duplicate-provider rejection, unavailable resources,
  and restart persistence;
- Provider integrity checks: production rejection of missing checksums, streamed
  SHA-256 verification, bounded gzip materialization, free-space preflight, and
  raw-file retention;
- HTTP boundary checks: request IDs, security headers, configured CORS allowlist,
  oversized-body rejection, redacted Provider manifests, and per-IP query rate
  limiting;
- authenticated administrator writes;
- a query bounded to two fixture rows;
- a local expression fixture inside `/data` and rejection of an Artifact path
  outside `/data`.

The quality baseline recorded for `main@f6f8441` on 2026-07-11 was:

| Check | Result |
|---|---|
| `cargo fmt --all --check` | passed |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | passed |
| `cargo test --workspace --all-features` | passed, 12 test suites |
| `docker compose config` | passed |
| `docker build --pull -t shennong-db:test .` | blocked locally by a 30-second `auth.docker.io` timeout; application compilation did not fail |
| GitHub main image build for `f6f8441` | passed ([run 29137753896](https://github.com/zerostwo/shennong-db/actions/runs/29137753896)) |
| `scripts/test-platform.sh` with the then-current published `0.1.0` image | passed; isolated containers and volumes removed on exit |

Run the Rust checks separately when changing application code:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```
