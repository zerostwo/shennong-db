# Production topology

The current production topology is intentionally one all-in-one container, one
published HTTP port, and one persistent `/data` mount. The checked-in
`docker-compose.production.yml` is the production reference.

## Service boundary

```text
client / TLS reverse proxy
          |
          v
HOST:18080 -> Next.js WebUI and same-origin API gateway (:8000)
                         |
                         v
                 Rust API (127.0.0.1:8001)
                    /        |        \
          PostgreSQL     ClickHouse   SeaweedFS + TileDB
                    \        |        /
                         /data
```

PostgreSQL, ClickHouse, SeaweedFS, and the Rust API bind only inside the
container. The standalone `shennong-db-web` service in `docker-compose.yml` is
an optional frontend-development profile; it is not part of production.

## Persistent data

The host path selected by `SHENNONG_DATA_PATH` is mounted at `/data` and holds:

| Path | Content |
|---|---|
| `/data/postgresql` | catalog, users, sessions, grants, audit, Projects, settings |
| `/data/clickhouse` | analytical cache |
| `/data/objects` | uploads, backup objects, and managed files |
| `/data/tiledb` and `/data/work` | derived arrays, indexes, and ingestion work |
| `/data/.shennong-secrets` | generated fallback secrets for this data volume |

When explicit `SHENNONG_ADMIN_API_KEY` and `SHENNONG_JWT_SECRET` values are
provided, back up `.env` separately and securely because those values are not
replaced by the generated fallback file.

## Network and TLS

The recommended same-host reverse-proxy binding is:

```dotenv
SHENNONG_BIND_ADDRESS=127.0.0.1
SHENNONG_PORT=18080
```

Terminate TLS at a maintained reverse proxy and forward to
`http://127.0.0.1:18080`. Set `SHENNONG_TRUST_PROXY_HEADERS=1` only when every
request reaches ShennongDB through a trusted proxy that overwrites forwarded
headers. Enable `SHENNONG_ENABLE_HSTS=1` only after HTTPS is confirmed. If a
TLS proxy is the only browser entry point, also set `SHENNONG_COOKIE_SECURE=1`.
If a browser on another origin calls the API directly, configure an explicit
comma-separated `SHENNONG_CORS_ORIGINS` allowlist.

## Images and upgrades

Use a semantic-version tag or immutable digest:

```dotenv
SHENNONG_IMAGE=zerostwo/shennong-db:0.6.0
```

Record the deployed digest with `docker image inspect`, retain the previous
digest, and take a full consistent backup before upgrading. `latest` is useful
for local evaluation but is not a rollback strategy.

## Capacity and isolation

The all-in-one topology simplifies installation and backup but shares CPU,
memory, disk bandwidth, and failure scope among all stores. Production sizing
must therefore monitor container CPU and memory, filesystem capacity and IOPS,
query concurrency, upload/download activity, and ingestion jobs together.

The current measured concurrency baseline is in
[benchmark-results.md](benchmark-results.md). Before a public service or paper,
repeat the benchmark on the intended hardware, pinned image digest, fixed data
snapshot, and both warm- and cold-cache states.

## Security checklist

- keep the host bind private unless direct access is intended;
- use TLS and a firewall at public ingress;
- generate independent administrator and JWT secrets;
- store `.env` with mode `0600` and outside source control;
- use personal tokens with only needed scopes for scripts and MCP;
- leave unverified providers disabled;
- preserve audit and login history according to policy;
- test full restore on an isolated host;
- monitor dependency and image vulnerabilities before each release.

For exact installation commands, see [guide.md](guide.md). For backup scope and
restore steps, see [backup-recovery.md](backup-recovery.md).
