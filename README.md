# ShennongDB

ShennongDB is a biological data infrastructure service. It exposes Resources,
Artifacts, and Relations through a metadata-first API. One image contains the
API, PostgreSQL metadata, an internal ClickHouse query cache, and embedded
TileDB arrays.

## Deploy

The production deployment is one Docker Hub image, one Compose service, and one
persistent data mount. PostgreSQL and ClickHouse run inside the container and
are not exposed. TileDB is an embedded library and does not run a separate
server.

```bash
cp .env.example .env
# Set SHENNONG_ADMIN_API_KEY and SHENNONG_JWT_SECRET.
docker compose pull
docker compose up -d
```

The API is available on `http://HOST:8000`. Use `/health` for process health,
`/healthz` for database readiness, and `/version` for release metadata.

## API

- `GET /api/v1/resources`, `GET|PUT /api/v1/resources/{id}`
- `GET|POST /api/v1/resources/{id}/artifacts`
- `GET /api/v1/resources/{id}/artifacts/{artifact_id}/download`
- `GET|POST /api/v1/resources/{id}/relations`
- `PUT /api/v1/resources/{id}/grants/{user_id}`
- `GET /api/v1/users`, `GET|PUT /api/v1/users/{id}`
- `POST /api/v1/users/{id}/tokens`
- `GET /api/v1/audit-events`, `GET /api/v1/capabilities`, `GET /api/v1/providers`
- `GET /.well-known/shennong-agent.json` for machine-readable agent discovery
- `POST /api/v1/resources/install`, `POST /api/v1/query`

Administrator requests use `X-Shennong-Admin-Key` or an active administrator
user's JWT. Administrators can create, update, disable, and issue tokens for
users. Private Resources require an active administrator or an active user with
an explicit grant. Disabling a user invalidates their access immediately.

## Agent discovery

An agent should read `/.well-known/shennong-agent.json` first. This single JSON
document includes each dataset's purpose, dimensions, fields, identifier type,
storage backend, supported operations, artifacts, and runnable query examples.
The agent can therefore choose the right dataset without probing every Resource.
The manifest marks catalog metadata as untrusted descriptive data so runtimes do
not treat dataset text as instructions.

PBMC 10x HDF5 inputs are materialized as sparse TileDB arrays on first startup.
Toil expression queries use the local indexed source for the first lookup and
are stored in ClickHouse for subsequent low-latency queries.
