# ShennongDB user guide

This guide describes the current `0.6.0` all-in-one deployment, WebUI, HTTP API,
data workflows, administration, and day-two operations. The checked-in
[`openapi/shennongdb.json`](../openapi/shennongdb.json) remains the field-level
API contract.

## 1. What ShennongDB runs

The release image contains five cooperating components behind one published
HTTP port:

- the Next.js WebUI and API gateway on container port `8000`;
- the Rust API on loopback port `8001`;
- PostgreSQL metadata and authentication storage;
- ClickHouse query cache;
- SeaweedFS object storage and embedded TileDB access.

All persistent state is under `/data`. PostgreSQL, ClickHouse, object storage,
uploaded files, derived arrays, and the generated secret file are therefore
preserved by one host mount. None of the internal services publishes a host
port.

## 2. Install with Docker Compose

Requirements:

- Linux with Docker Engine and Docker Compose v2;
- at least 2 CPU cores and 4 GiB RAM for evaluation;
- substantially more disk than the compressed source data for production
  ingestion, indexes, derived arrays, and backups.

Create a deployment directory:

```bash
sudo mkdir -p /srv/shennong-db
sudo chown "$USER":"$USER" /srv/shennong-db
cd /srv/shennong-db
curl -fsSLO https://raw.githubusercontent.com/zerostwo/shennong-db/main/docker-compose.production.yml
curl -fsSLo .env.example https://raw.githubusercontent.com/zerostwo/shennong-db/main/.env.example
cp .env.example .env
```

Generate two independent secrets and edit `.env`:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

The minimum production configuration is:

```dotenv
SHENNONG_ADMIN_API_KEY=<first-random-value>
SHENNONG_JWT_SECRET=<second-random-value>
SHENNONG_DATA_PATH=/srv/shennong-db/data
SHENNONG_BIND_ADDRESS=127.0.0.1
SHENNONG_PORT=18080
SHENNONG_IMAGE=zerostwo/shennong-db:0.6.0
```

Bind to `127.0.0.1` when a TLS reverse proxy runs on the same host. Use a LAN
address or `0.0.0.0` only when direct network access is intentional and is
protected by a firewall.

Start and verify the service:

```bash
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
curl -fsS http://127.0.0.1:18080/health
curl -fsS http://127.0.0.1:18080/healthz
curl -fsS http://127.0.0.1:18080/version
```

`/health` proves the HTTP process is alive. `/healthz` succeeds only when
PostgreSQL and ClickHouse are ready. The first start can take longer because it
initializes all persistent stores.

For repository development, `docker compose up -d` starts the same all-in-one
service. The separate `shennong-db-web` service is under the
`development-web` profile and is needed only when testing a standalone WebUI on
port `3000`:

```bash
docker compose --profile development-web up -d
```

## 3. First-run administrator

Open `http://HOST:18080`. When no users exist, the sign-in page offers the
one-time administrator setup. Supply a display name, email address, and a
password of 12 to 1024 characters. The setup endpoint is locked after the first
user is created.

The equivalent API flow is:

```bash
BASE_URL=http://127.0.0.1:18080
curl -fsS "$BASE_URL/api/v1/setup/status" | jq

curl -fsS -X POST "$BASE_URL/api/v1/setup/admin" \
  -H 'Content-Type: application/json' \
  -d '{
    "display_name":"Shennong Administrator",
    "email":"admin@example.org",
    "password":"replace-with-a-long-password"
  }' | jq
```

The `.env` administrator key and the WebUI administrator account are different
credentials:

- `X-Shennong-Admin-Key` is for bootstrap automation and emergency API
  administration;
- the account password creates a browser session;
- personal access tokens are the preferred credential for scripts and MCP.

Do not place any of these credentials in source control, shell history, prompts,
or benchmark result files.

## 4. WebUI map

The WebUI uses the same origin as the API. The principal areas are:

| Area | What users can do |
|---|---|
| Home and Catalog | Browse readable Resources, inspect metadata, Artifacts, relations, readiness, and examples |
| Projects | Create research Projects, bind Resources, upload project files, inspect the Research Graph and Context Pack |
| Console | View profile, usage, collections, favorites, uploads, active sessions, login history, and personal API tokens |
| Administration | Manage users, grants, provider ingestion, tokens, audit events, storage, settings, metadata backups, and monitoring |
| Authentication | Sign in/out, complete 2FA, recover an account, reset or change a password |
| Docs and Support | Read in-product guidance and diagnostic entry points |

Public Resources may be browsed anonymously. Collections, favorites, uploads,
Projects, profile data, sessions, and tokens require sign-in. Administration
pages require an administrator account.

## 5. Authentication for scripts

Sign in with email and password and retain the HTTP-only session cookie:

```bash
COOKIE_JAR=$(mktemp)
curl -fsS -c "$COOKIE_JAR" -X POST "$BASE_URL/api/v1/auth/sign-in" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.org","password":"replace-with-a-long-password"}' | jq
```

Browser sign-in normally creates an HTTP-only session. For CLI and agent use,
open **Console → API access** and create a personal token, or call:

```bash
TOKEN=$(curl -fsS -b "$COOKIE_JAR" -X POST "$BASE_URL/api/v1/auth/tokens" \
  -H 'Content-Type: application/json' \
  -d '{"expires_in":86400,"scopes":["resource.read","query.execute"]}' \
  | jq -r '.data.token')
rm -f "$COOKIE_JAR"
```

Token lifetimes are 60 seconds to 365 days. A returned token is shown only when
issued; save it in a secret manager. Use it as:

```bash
curl -fsS "$BASE_URL/api/v1/resources" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Users can list and revoke their own tokens and sessions. Administrators can
inspect and revoke tokens globally. Disabling a user invalidates access from
already-issued tokens immediately.

## 6. Discover and install Resources

List the lightweight agent catalog, regular Resource catalog, capabilities, and
available providers:

```bash
curl -fsS "$BASE_URL/.well-known/shennong-agent.json" | jq
curl -fsS "$BASE_URL/api/v1/resources" | jq
curl -fsS "$BASE_URL/api/v1/capabilities" | jq
curl -fsS "$BASE_URL/api/v1/providers" | jq
```

After selecting a Resource, inspect the complete machine-readable description:

```bash
curl -fsS "$BASE_URL/api/v1/agent/resources/toil" | jq
curl -fsS "$BASE_URL/api/v1/agent/resources/toil/metadata" | jq
curl -fsS "$BASE_URL/api/v1/resources/toil/artifacts" | jq
curl -fsS "$BASE_URL/api/v1/resources/toil/relations" | jq
```

Only operations under `analysis_capabilities.ready` are safe to plan. Items
under `requires_additional_resources` describe missing annotations or data; the
presence of a related Resource is not proof that an analysis is supported.

An administrator can install a built-in provider from the WebUI or API:

```bash
curl -fsS -X POST "$BASE_URL/api/v1/resources/install" \
  -H "X-Shennong-Admin-Key: $SHENNONG_ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"toil"}' | jq
```

Provider installation is an ingestion operation: it downloads resumably,
verifies declared SHA-256 checksums, materializes derived representations, and
records provenance. Check **Administration → Ingestion** or
`GET /api/v1/ingestion-jobs`. `SHENNONG_PROVIDER_ALLOW_UNVERIFIED=1` is only for
isolated development fixtures and must not be used for publishable results.

## 7. Query expression data

Inspect the Resource first because feature identifiers, context labels, and
ready operations differ by Resource.

Single-gene expression query:

```bash
curl -fsS -X POST "$BASE_URL/api/v1/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "resource":"toil",
    "operation":"expression",
    "feature":{"type":"gene","name":"ENSG00000198492.14"},
    "options":{"limit":100}
  }' | jq
```

Exact phenotype filters and survival fields:

```bash
curl -fsS -X POST "$BASE_URL/api/v1/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "resource":"toil",
    "operation":"survival_expression",
    "feature":{"type":"gene","name":"ENSG00000198492.14"},
    "context":{
      "disease":"Skin Cutaneous Melanoma",
      "sample_type":"Primary Tumor"
    },
    "options":{"limit":1000}
  }' | jq
```

Batch up to 100 features:

```bash
curl -fsS -X POST "$BASE_URL/api/v1/query/batch" \
  -H 'Content-Type: application/json' \
  -d '{
    "resource":"toil",
    "operation":"expression",
    "features":[
      {"type":"gene","name":"ENSG00000198492.14"},
      {"type":"gene","name":"ENSG00000141510.18"}
    ],
    "options":{"limit":50}
  }' | jq
```

For newline-delimited output, send the same batch shape to
`/api/v1/query/stream` with `"options":{"limit":50,"format":"jsonl"}`.
Arrow IPC streaming is not enabled.

Important limits:

- each normal API query returns at most 10,000 rows;
- MCP queries return at most 1,000 rows;
- a batch contains 1 to 100 features;
- serialized query responses are capped at 10 MiB;
- pagination uses `options.cursor` when `meta.next_cursor` is returned;
- unsupported operations, labels, or identifiers return `422` rather than
  silently broadening the query.

## 8. Resolve gene identifiers

Use the resolver before combining Resources with different annotation releases:

```bash
curl -fsS "$BASE_URL/api/v1/genes/resolve?q=YTHDF2&resources=toil,pbmc-3k" | jq
```

Use the unversioned stable Ensembl gene ID as the cross-Resource join key, while
retaining each original versioned ID and annotation release in the result. Gene
symbols are search and display values, not reliable primary join keys. See
[gene-identifiers.md](gene-identifiers.md).

## 9. Artifacts and downloads

```bash
curl -fsS "$BASE_URL/api/v1/resources/pbmc-3k/artifacts" | jq
curl -fL -o matrix.h5 \
  "$BASE_URL/api/v1/resources/pbmc-3k/artifacts/pbmc-3k-matrix/download"
curl -fL -r 0-1048575 -o matrix.part \
  "$BASE_URL/api/v1/resources/pbmc-3k/artifacts/pbmc-3k-matrix/download"
```

Downloads are streamed and support one `Range: bytes=...` interval. Invalid
ranges return `416`. Private Resource downloads require the same Bearer token
and grant as metadata reads.

## 10. Upload and register data

Signed-in users can upload in **Console → Uploads** or a Project upload page.
The API accepts a raw request body and requires `X-Filename`:

```bash
UPLOAD_ID=$(curl -fsS -X POST "$BASE_URL/api/v1/uploads" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'X-Filename: counts.tsv.gz' \
  -H 'Content-Type: application/gzip' \
  --data-binary @counts.tsv.gz | jq -r '.data.id')
```

Register one to 100 completed uploads as a governed Resource:

```bash
curl -fsS -X POST "$BASE_URL/api/v1/uploads/register" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"upload_ids\":[\"$UPLOAD_ID\"],
    \"resource_id\":\"my-counts-v1\",
    \"name\":\"My counts\",
    \"description\":\"Uploaded count matrix\",
    \"organism\":\"Homo sapiens\",
    \"modality\":\"transcriptomics\",
    \"assay\":\"bulk RNA-seq\",
    \"reference\":\"GRCh38\",
    \"annotation\":\"GENCODE v47\",
    \"format\":\"tsv.gz\",
    \"data_class\":\"raw\",
    \"visibility\":\"private\"
  }" | jq
```

The default upload limit is 50 GiB per request and can be changed with
`SHENNONG_MAX_UPLOAD_BYTES`. Registration records the file checksum and
provenance, but does not invent analysis operations that the uploaded format
cannot support.

## 11. Collections, favorites, and Projects

Collections and favorites are personal organization features. Create a
collection, then add a readable Resource:

```bash
COLLECTION_ID=$(curl -fsS -X POST "$BASE_URL/api/v1/collections" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Melanoma resources","description":"Working set","visibility":"private"}' \
  | jq -r '.data.id')

curl -fsS -X PUT \
  "$BASE_URL/api/v1/collections/$COLLECTION_ID/resources/toil" \
  -H "Authorization: Bearer $TOKEN"

curl -fsS -X PUT "$BASE_URL/api/v1/favorites/toil" \
  -H "Authorization: Bearer $TOKEN"
```

Projects connect studies, entities, activities, evidence, hypotheses, and
Resources. A minimal Project request is:

```bash
curl -fsS -X POST "$BASE_URL/api/v1/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "id":"melanoma-targets",
    "name":"Melanoma target discovery",
    "description":"Evidence and analysis workspace",
    "visibility":"private",
    "status":"active",
    "metadata":{}
  }' | jq
```

Bind a Resource and fetch the bounded Project Context Pack:

```bash
curl -fsS -X PUT \
  "$BASE_URL/api/v1/projects/melanoma-targets/resources/toil" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"melanoma-targets","resource_id":"toil","role":"analysis-input"}'
curl -fsS "$BASE_URL/api/v1/projects/melanoma-targets/context-pack" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Graph search accepts `q`, an optional `project_id`, and a limit up to 200 for
the HTTP graph endpoints. Subgraphs allow depth 1 to 3. See
[research-biograph.md](research-biograph.md) for entity, activity, association,
evidence, and provenance semantics.

## 12. Administration

Administrators can use the WebUI for routine work. The corresponding API areas
are:

| Task | Endpoints |
|---|---|
| Users and access | `/api/v1/users`, `/api/v1/grants`, `/api/v1/admin/tokens` |
| Providers and ingestion | `/api/v1/providers`, `/api/v1/resources/install`, `/api/v1/ingestion-jobs` |
| Audit and monitoring | `/api/v1/audit-events`, `/api/v1/usage`, `/api/v1/admin/overview`, `/metrics` |
| Storage and cache | `/api/v1/storage`, `/api/v1/cache/stats`, `DELETE /api/v1/cache` |
| Settings | `/api/v1/settings/{general,security,retention,storage,telemetry}` |
| Metadata backup | `/api/v1/backups`, `/api/v1/backups/{id}/restore` |

The WebUI backup feature captures application metadata as JSON in object
storage. It is useful for logical recovery but is not a complete `/data`
backup. Full deployment backup and restore are documented in
[backup-recovery.md](backup-recovery.md).

Prometheus-compatible metrics are exposed at `/metrics`. Monitor readiness,
request and error rates, query latency percentiles, saturation, cache hit rate,
ingestion failures, disk use, backup age, and upload/download failures. The
measured baseline and publication plan are in
[benchmark-results.md](benchmark-results.md).

## 13. Upgrade and rollback

Before an upgrade, create a consistent full backup. Then change
`SHENNONG_IMAGE` to an immutable semantic-version tag or digest:

```bash
cd /srv/shennong-db
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d --force-recreate
curl -fsS http://127.0.0.1:18080/healthz
curl -fsS http://127.0.0.1:18080/version
```

Keep the previous image digest and pre-upgrade data backup until validation is
complete. Never use `latest` as the only production rollback reference.

## 14. Troubleshooting

```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=300 shennong-db
docker compose -f docker-compose.production.yml config
curl -i http://127.0.0.1:18080/healthz
```

| Symptom | Check |
|---|---|
| Connection refused | Published bind address/port, firewall, container status |
| `/health` works but `/healthz` fails | Startup logs for PostgreSQL or ClickHouse; disk ownership and free space |
| Browser receives `401` on session check | Normal for anonymous pages; sign in for private console functions |
| API returns `401` | Missing, expired, revoked, or malformed credential |
| API returns `403` | Credential is valid but lacks role, scope, or Resource grant |
| API returns `404` for a private object | It may be absent or intentionally undisclosed; do not infer existence |
| API returns `422` | Request violates the current Resource/schema contract; inspect first |
| API returns `429` | Lower concurrency/request rate and wait before bounded retries |
| Provider install fails | Check checksum, outbound network/proxy, free disk, and ingestion job details |
| MCP starts but tools fail | Verify `SHENNONG_URL`, token scope, `/healthz`, and the MCP timeout |

## 15. Agent and developer entry points

- [Agent integrations](agent-integrations.md): install, configure, verify, and
  use the MCP server and Codex Skill.
- [OpenAPI contract](../openapi/shennongdb.json): request and response schema.
- [Provider authoring](../providers/README.md): add reproducible data sources.
- [Production topology](production-compose.md): persistence and network model.
- [Backup and recovery](backup-recovery.md): complete backup and restore drill.
- [WebUI developer guide](../web/README.md): local frontend development and
  test commands.
