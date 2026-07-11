# Production topology

Development keeps the single-image Compose workflow. Production uses
`docker-compose.production.yml`, where the API, PostgreSQL, ClickHouse,
SeaweedFS object store, TileDB worker, and reverse proxy are separate services.
Only the reverse proxy publishes ports; the `private` network is internal.

Create secret files before starting:

```sh
mkdir -m 700 secrets
openssl rand -hex 32 > secrets/admin_api_key
openssl rand -hex 32 > secrets/jwt_secret
openssl rand -hex 32 > secrets/postgres_password
openssl rand -hex 32 > secrets/clickhouse_password
printf 'postgres://shennong:%s@postgres:5432/shennong\n' "$(cat secrets/postgres_password)" > secrets/database_url
printf 'http://shennong:%s@clickhouse:8123\n' "$(cat secrets/clickhouse_password)" > secrets/clickhouse_url
chmod 600 secrets/*
docker compose -f docker-compose.production.yml up -d
```

The API container runs as UID 10001 with a read-only root filesystem, dropped
capabilities, and `no-new-privileges`. It does not mount database volumes.
TileDB requests use the internal HTTP worker, while object data uses the
internal S3-compatible SeaweedFS service. Caddy is the only public ingress and
enforces the request body limit and upstream timeouts; configure a real domain
and TLS certificates before exposing it publicly.

To migrate an existing embedded deployment, run
`scripts/migrate-embedded-to-production.sh`. It creates a PostgreSQL dump and
an untouched `/data` backup. Review and upload retained objects before restoring
the dump; the script never deletes the old volume. Rollback is the reverse:
stop the production stack and start the original single-container Compose file
with its original volumes.

Release images are immutable semantic-version tags plus a `sha-<git-sha>` tag.
Verify the recorded digest and signature before deployment:

```sh
cosign verify zerostwo/shennong-db@sha256:<digest>
docker pull zerostwo/shennong-db@sha256:<digest>
```

Never deploy `latest` in production; keep the previous digest available for a
one-command rollback in the Compose `SHENNONG_IMAGE` variable.
