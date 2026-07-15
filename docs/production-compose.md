# Production topology

The current production topology is intentionally one all-in-one container, one
published HTTP port, and one persistent `/data` mount. The checked-in
`docker-compose.production.yml` is the production reference. Docker Compose
2.24 or newer is required for its optional `.env` file declaration.

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
| `/data/.shennong-secrets` | generated administrator, session, Agent credential-encryption, and object-storage secrets |

The container creates these runtime credentials on first start and reuses them
for the life of the data volume. A normal deployment does not put credentials
in `.env`. Back up `/data/.shennong-secrets` as part of the data volume and do
not replace it during an upgrade.

## Normal configuration

The normal path has only the image, persistent host path, bind address, and
published port:

```dotenv
SHENNONG_IMAGE=zerostwo/shennong-db:0.7.0
SHENNONG_DATA_PATH=/srv/shennong-db/data
SHENNONG_BIND_ADDRESS=127.0.0.1
SHENNONG_PORT=18080
```

`SHENNONG_DOWNLOAD_PROXY` is optional when provider downloads need an outbound
HTTP proxy. The Compose file reads `.env` when present and also works without
it, using its checked-in defaults. Model providers and their credentials are
configured per user in **Settings → Models**, not in the deployment file.

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

## Advanced overrides

ShennongDB supplies service defaults for the settings below. Put an override in
`.env` only for a measured capacity need or a deliberate ingress/security
policy; the Compose file passes the optional file through without duplicating
those defaults in its `environment` block.

| Concern | Optional variables |
|---|---|
| Request bounds | `SHENNONG_MAX_BODY_BYTES`, `SHENNONG_REQUEST_TIMEOUT_SECS`, `SHENNONG_MAX_CONCURRENCY`, `SHENNONG_QUERY_MAX_CONCURRENCY` |
| Rate limits | `SHENNONG_QUERY_RATE_LIMIT_PER_MINUTE`, `SHENNONG_DOWNLOAD_RATE_LIMIT_PER_MINUTE` |
| Transfer limits | `SHENNONG_DOWNLOAD_CONCURRENCY`, `SHENNONG_DOWNLOAD_TIMEOUT_SECS`, `SHENNONG_MAX_DOWNLOAD_BYTES`, `SHENNONG_MAX_UPLOAD_BYTES` |
| Ingress | `SHENNONG_CORS_ORIGINS`, `SHENNONG_TRUST_PROXY_HEADERS`, `SHENNONG_ENABLE_HSTS`, `SHENNONG_COOKIE_SECURE` |
| TileDB worker | `SHENNONG_TILEDB_MAX_CONCURRENCY`, `SHENNONG_TILEDB_TIMEOUT_SECS`, `SHENNONG_TILEDB_MAX_STDOUT_BYTES`, `SHENNONG_TILEDB_MAX_STDERR_BYTES` |
| ClickHouse cache | `SHENNONG_CLICKHOUSE_CONNECT_TIMEOUT_SECS`, `SHENNONG_CLICKHOUSE_TIMEOUT_SECS`, `SHENNONG_CLICKHOUSE_MAX_IDLE_PER_HOST`, `SHENNONG_CLICKHOUSE_CACHE_TTL_DAYS`, `SHENNONG_CLICKHOUSE_CACHE_MAX_BYTES` |

The commented **Advanced overrides** section in `.env.example` shows the
current values and safety notes. Recreate the service after changing an
override:

```bash
docker compose -f docker-compose.production.yml up -d --force-recreate
```

`SHENNONG_PROVIDER_ALLOW_UNVERIFIED=1` is reserved for isolated development
fixtures. Production providers should retain checksum verification.

## Images and upgrades

Use a semantic-version tag or immutable digest:

```dotenv
SHENNONG_IMAGE=zerostwo/shennong-db:0.7.0
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
- preserve and protect the generated secret file with the data volume;
- keep `.env` outside source control and use mode `0600` if it contains policy
  overrides or a proxy credential;
- use personal tokens with only needed scopes for scripts and MCP;
- leave unverified providers disabled;
- preserve audit and login history according to policy;
- test full restore on an isolated host;
- monitor dependency and image vulnerabilities before each release.

For the product's core capabilities and interface boundaries, see
[product-core.md](product-core.md). For exact installation commands, see
[guide.md](guide.md). For backup scope and
restore steps, see [backup-recovery.md](backup-recovery.md).
