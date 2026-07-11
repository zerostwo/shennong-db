# ShennongDB

ShennongDB is a biological data infrastructure service. It exposes Resources,
Artifacts, and Relations through a metadata-first API with local artifact
storage and PostgreSQL metadata.

## Deploy

The production deployment is one Docker Hub image and one Compose service.
PostgreSQL runs inside that image and listens only inside the container.

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
- `GET|PUT /api/v1/resources/{id}/artifacts`
- `GET /api/v1/resources/{id}/artifacts/{artifact_id}/download`
- `GET|PUT /api/v1/resources/{id}/relations`
- `PUT /api/v1/resources/{id}/grants/{user_id}`
- `GET /api/v1/audit-events`, `GET /api/v1/capabilities`, `GET /api/v1/providers`
- `GET /api/v1/agent-guide.md` for an agent-first, metadata-only routing index
- `POST /api/v1/resources/install`, `POST /api/v1/query`

Administrator requests use `X-Shennong-Admin-Key`. Private Resources require
an administrator or a JWT user with an explicit grant.

## Agent discovery

An agent should read `/api/v1/agent-guide.md` first, select one listed Resource,
then retrieve only that Resource's metadata, artifacts, or bounded query result.
The guide marks catalog metadata as untrusted descriptive data so agent runtimes
do not treat dataset text as instructions.
