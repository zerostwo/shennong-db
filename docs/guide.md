# ShennongDB Docker and API Guide

## 1. Production installation

Requirements:

- Linux with Docker Engine and Docker Compose v2
- one host port for the HTTP API
- enough disk for the source datasets, TileDB arrays, ClickHouse cache, and PostgreSQL metadata

Create the deployment directory and data layout:

```bash
sudo mkdir -p /srv/shennong-db/data/pbmc
cd /srv/shennong-db
curl -fsSLO https://raw.githubusercontent.com/zerostwo/shennong-db/main/docker-compose.yml
```

Place the supported source files at these exact paths:

```text
/srv/shennong-db/data/pbmc/pbmc1k_filtered_feature_bc_matrix.h5
/srv/shennong-db/data/pbmc/pbmc3k_filtered_feature_bc_matrix.h5
/srv/shennong-db/data/pbmc/pbmc4k_filtered_feature_bc_matrix.h5
```

Create `/srv/shennong-db/.env`:

```dotenv
SHENNONG_ADMIN_API_KEY=replace-with-openssl-rand-hex-32
SHENNONG_JWT_SECRET=replace-with-a-different-openssl-rand-hex-32
SHENNONG_DATA_PATH=/srv/shennong-db/data
SHENNONG_BIND_ADDRESS=127.0.0.1
SHENNONG_PORT=8000
SHENNONG_IMAGE=zerostwo/shennong-db:0.1.0
```

On a restricted or slow outbound network, optionally set
`SHENNONG_DOWNLOAD_PROXY=http://host.docker.internal:7890`. Compose maps
`host.docker.internal` to the Docker host gateway.

Generate each secret with `openssl rand -hex 32`. Start the single service and
import the bundled Resource metadata:

```bash
docker compose pull
docker compose up -d
docker compose exec shennong-db shennong-cli import /app/seed/toil-pbmc.json
curl -fsS http://127.0.0.1:8000/healthz
```

Install or refresh the complete built-in Toil cohort directly from UCSC Xena:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/resources/install \
  -H "X-Shennong-Admin-Key: $SHENNONG_ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"toil"}'
```

The request streams and resumes the 1.32 GB compressed TPM matrix, decompresses
it, builds the gene-row index, and installs phenotype, category, TCGA survival,
and GENCODE v23 mapping Artifacts. The completed Resource occupies about 9 GB
plus the small annotation files.

The one container starts PostgreSQL, internal-only ClickHouse, embedded TileDB,
and the HTTP API. On first startup it creates TileDB arrays under
`$SHENNONG_DATA_PATH/tiledb`. ClickHouse data is stored under
`$SHENNONG_DATA_PATH/clickhouse`.

Provider installation requires a SHA-256 checksum for every source file.
Downloaded compressed raw files are retained beside canonical files, and
canonical plus gene-index checksums are recorded in Artifact provenance.
`SHENNONG_PROVIDER_ALLOW_UNVERIFIED=1` is reserved for isolated development
fixtures and marks those Artifacts as unverified.

Upgrade with:

```bash
cd /srv/shennong-db
docker compose pull
docker compose up -d --force-recreate
docker compose exec shennong-db shennong-cli import /app/seed/toil-pbmc.json
```

Back up both metadata and analytical data:

```bash
docker compose exec -T shennong-db pg_dump -U shennong shennong > shennong-metadata.sql
rsync -a /srv/shennong-db/data/ /backup/shennong-db-data/
```

## 2. Agent discovery

Discovery is deliberately two-level.

First, read the small catalog:

```bash
curl -sS http://127.0.0.1:8000/.well-known/shennong-agent.json | jq
```

Each entry contains only selection metadata and a `details_url`. After choosing
a candidate Resource, retrieve its complete metadata, dimensions, fields,
analysis readiness, missing annotation requirements, Artifacts, Relations, and
query example:

```bash
curl -sS http://127.0.0.1:8000/api/v1/agent/resources/toil | jq
curl -sS http://127.0.0.1:8000/api/v1/agent/resources/pbmc-3k | jq
```

An agent must plan only operations listed under
`metadata.analysis_capabilities.ready`. Items under
`requires_additional_resources` identify the exact missing Resources needed for
the requested analysis.

For a melanoma CAR-T target task, the current catalog correctly reports only
Toil and PBMC expression Resources. A complete plan additionally requires a
melanoma single-cell Resource, TCGA sample and clinical annotations, GTEx tissue
annotations, and an OpenTargets Resource. ShennongDB does not advertise data
that has not been installed.

## 3. Expression queries

Toil accepts the versioned Ensembl identifier present in the matrix:

```bash
curl -sS http://127.0.0.1:8000/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "resource":"toil",
    "operation":"expression",
    "feature":{"type":"gene","name":"ENSG00000198492.14"},
    "options":{"limit":100}
  }' | jq
```

Toil reads only the requested indexed gene row, then joins the bounded result
to phenotype or survival metadata when the query supplies context.

PBMC accepts a gene symbol or Ensembl identifier and reads the sparse TileDB
array:

```bash
curl -sS http://127.0.0.1:8000/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "resource":"pbmc-3k",
    "operation":"expression",
    "feature":{"type":"gene","name":"YTHDF2"},
    "options":{"limit":100}
  }' | jq
```

Filter Toil by installed phenotype labels:

```bash
curl -sS http://127.0.0.1:8000/api/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "resource":"toil",
    "operation":"expression",
    "feature":{"type":"gene","name":"ENSG00000198492.14"},
    "context":{"disease":"Skin Cutaneous Melanoma","sample_type":"Primary Tumor"},
    "options":{"limit":1000}
  }' | jq
```

Use `"operation":"survival_expression"` to attach OS, DSS, DFI, and PFI
endpoints to the filtered expression rows.

Context filters are rejected until the selected Resource declares the required
annotations. This prevents an agent from mistaking unfiltered results for a
cancer cohort, tumor/normal comparison, survival analysis, or cell-type result.

## 4. Resources, Artifacts, and Relations

```bash
curl -sS http://127.0.0.1:8000/api/v1/resources | jq
curl -sS http://127.0.0.1:8000/api/v1/resources/toil/artifacts | jq
curl -sS http://127.0.0.1:8000/api/v1/resources/pbmc-3k/relations | jq
curl -o matrix.h5 http://127.0.0.1:8000/api/v1/resources/pbmc-3k/artifacts/pbmc-3k-matrix/download
curl -r 0-1048575 -o matrix.part http://127.0.0.1:8000/api/v1/resources/pbmc-3k/artifacts/pbmc-3k-matrix/download
```

Artifact downloads are streamed, support one `Range: bytes=...` request, and
return `416` for invalid ranges. Set `SHENNONG_DOWNLOAD_CONCURRENCY` and
`SHENNONG_DOWNLOAD_TIMEOUT_SECS` to bound simultaneous downloads and a stalled
file read.

TileDB subprocesses use `SHENNONG_TILEDB_MAX_CONCURRENCY`,
`SHENNONG_TILEDB_TIMEOUT_SECS`, `SHENNONG_TILEDB_MAX_STDOUT_BYTES`, and
`SHENNONG_TILEDB_MAX_STDERR_BYTES`. ClickHouse uses one shared client with the
`SHENNONG_CLICKHOUSE_*` timeout and idle-connection settings.

Queries accept at most 10,000 rows, a 256-byte gene feature name, 20 context
fields with 256-byte string values, and a 10 MiB serialized response.

Write operations require the bootstrap administrator key:

```bash
curl -X PUT http://127.0.0.1:8000/api/v1/resources/example \
  -H "X-Shennong-Admin-Key: $SHENNONG_ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"id":"example","kind":"Dataset","metadata":{},"spec":{},"status":"available","provenance":{},"permissions":{"visibility":"private","read_scopes":["resource.read"]}}'
```

## 5. Users and private Resources

Create a user and issue a JWT:

```bash
curl -X PUT http://127.0.0.1:8000/api/v1/users/analyst \
  -H "X-Shennong-Admin-Key: $SHENNONG_ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"id":"analyst","display_name":"Analyst","email":"analyst@example.org","role":"user","status":"active"}'

curl -X POST http://127.0.0.1:8000/api/v1/users/analyst/tokens \
  -H "X-Shennong-Admin-Key: $SHENNONG_ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"expires_in":86400}'

curl -X PUT http://127.0.0.1:8000/api/v1/resources/private-dataset/grants/analyst \
  -H "X-Shennong-Admin-Key: $SHENNONG_ADMIN_API_KEY"
```

Use the returned token as `Authorization: Bearer TOKEN`. Private Resources
require an active user, an explicit grant, and every scope in
`permissions.read_scopes`; an admin user can use the `*` scope. Resource
permissions are fail-closed: omitted `visibility` defaults to `private`, and
unknown values or invalid scopes are rejected with `422`. Setting the user's
status to `disabled` revokes access immediately, including already-issued JWTs.

## 6. Gene identifiers across annotation releases

Use `/api/v1/genes/resolve` before cross-dataset analysis. ShennongDB joins
GENCODE v23 Toil and GENCODE v37 PBMC features by the unversioned stable Ensembl
gene ID while retaining each original versioned ID and annotation release.
Symbols are search/display values, not join keys. See
[gene-identifiers.md](gene-identifiers.md) for the complete policy.

## 7. Operations

```bash
docker compose ps
docker compose logs --tail=200 shennong-db
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/healthz
curl -fsS http://127.0.0.1:8000/version
```

`/healthz` succeeds only when PostgreSQL and ClickHouse are ready. TileDB is
reported as embedded because it has no separate daemon.
