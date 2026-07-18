# V1 production topology

ShennongDB V1 is an internal, headless data plane. The canonical production
topology is the unified Shennong stack supplied by `shennong-os/deploy`, not a
public standalone ShennongDB application.

```text
browser
  |
  v
Shennong OS WebUI / control plane
  |  authenticates user and enforces Project RBAC
  |  X-Shennong-Admin-Key on an internal control network
  v
ShennongDB :8000 (headless)
  |
  +-- PostgreSQL metadata and provenance
  +-- SeaweedFS object storage
  +-- ClickHouse replaceable query cache
  +-- TileDB data and bounded workers
  `-- /data (the only persistent mount)
```

No DB route is browser-authenticated in this topology. Health/version endpoints
are available to the orchestrator; every data-plane route requires the
deployment service key. Shennong OS owns users, invitations, sessions, Project
membership, Chat, Memory, providers, Skills, Agent orchestration, and IDE
access. The legacy WebUI and Pi source trees are not part of the V1 image.

## Unified deployment

Use the Compose file and secret-file layout documented by
`shennong-os/deploy/README.md`. The DB service must have:

- `SHENNONG_DB_PROFILE=headless`;
- `SHENNONG_ENV=production`;
- `SHENNONG_ADMIN_API_KEY_FILE` mounted read-only from the same secret file
  used by Shennong OS;
- one private control-network attachment and no published host port;
- `/srv/shennong.one/data/db` (or the configured equivalent) mounted at
  `/data`;
- `no-new-privileges` enabled.

Back up the complete DB data directory consistently, plus the immutable image
digest and deployment manifest. The service key is deployment configuration,
not DB application state, and belongs in the protected unified secret backup.

## Loopback-only standalone diagnostics

`docker-compose.production.yml` remains useful for isolated DB maintenance and
compatibility diagnostics. It defaults to the headless profile and binds only
to `127.0.0.1:18080`:

```bash
cp .env.example .env
docker compose --file docker-compose.production.yml config --quiet
docker compose --file docker-compose.production.yml up --detach --wait
curl --fail --silent --show-error http://127.0.0.1:18080/healthz
curl --fail --silent --show-error http://127.0.0.1:18080/version
```

The entrypoint generates a persistent default service credential inside
`/data/.shennong-secrets` when no external key is supplied. Do not print that
credential into logs or shell history. A unified deployment instead mounts the
explicit OS/DB shared key file and does not rely on this generated fallback.

Standalone Compose is not a browser product, does not start a WebUI or Pi
runtime, and must not be exposed as public ingress. Delete the local `.env`
after diagnostics if it is no longer needed; never commit it or `/data`.

## Upgrade and rollback

Before an upgrade:

1. record the current image digest and ShennongDB `/version` response;
2. take a consistent full backup of `/data` and verify it off-host;
3. validate the new Compose expansion;
4. run the headless contract suite against the candidate image;
5. upgrade inside the unified stack and verify OS-to-DB Project shadow and
   Resource operations;
6. retain the previous digest and backup until rollback has been exercised.

Database migrations are forward changes. An image rollback is not a database
rollback; restore the matching pre-upgrade data snapshot when schema
compatibility is not explicitly documented.
