# ShennongDB

ShennongDB is a versioned store and read API for bioinformatics datasets. Its scope is deliberately
small: preserve data, describe it consistently, control access, and serve it efficiently. Analysis,
workflow execution, chat, and agent features are outside this service.

## Deploy

The container includes the API, SQLite metadata registry, user system, and local asset storage. Only
the persistent host path and published port normally need configuration:

```bash
cp .env.example .env
# edit SHENNONG_DATA_PATH and SHENNONG_PORT if needed
docker compose pull
docker compose up -d
```

Defaults:

```dotenv
SHENNONG_DATA_PATH=./data
SHENNONG_PORT=8000
```

Open API documentation at `http://HOST:8000/docs` and check health at
`http://HOST:8000/health`. All metadata, users, grants, uploaded files, optimized files, and indexes
remain below the mounted `/data` directory.

## First administrator

Bootstrap is allowed exactly once:

```bash
curl -X POST http://localhost:8000/v1/auth/bootstrap \
  -H 'content-type: application/json' \
  -d '{
    "email": "admin@example.org",
    "display_name": "Administrator",
    "password": "replace-with-a-long-password"
  }'
```

The response contains an API token that is shown only once. Later sessions use
`POST /v1/auth/login`.

## Access model

- Guest: anonymous; sees and reads only `public` datasets.
- User: authenticates with `Authorization: Bearer TOKEN`; reads public datasets plus private
  datasets explicitly granted by an administrator.
- Administrator: manages users, tokens, dataset grants, ingestion, and audit records.

Unauthorized private datasets return `404` so their identifiers and metadata are not disclosed.
Public datasets such as Toil and PBMC therefore remain directly readable by `ShennongData` without
requiring every R user to create an account.

## Dataset model

A dataset is not assumed to be one table. The stable identity is:

```text
dataset_id + version + visibility + data_model + asset manifest
```

Each asset has a semantic `role`, a broad `kind`, a physical `format`, optional compression,
checksum/size metadata, and a controlled storage path. Examples:

- single-cell: `matrix`, `obs`, `var`, `embedding.umap`, `embedding.pca`;
- reference genome: `reference.fasta`, `annotation.gtf`, `index.fai`, `index.bwa.*`;
- transcription-factor resources: `data`, `metadata`, `index.*` in Feather/Parquet;
- CellPhoneDB: `database`, `metadata`, and documentation assets;
- bulk expression: `expression`, `phenotype`, `gene_map`.

The server exposes standard profiles at `GET /v1/catalog/formats`. See
[Unified data model](docs/SHENNONG_PLATFORM_BLUEPRINT.md) for the complete convention.

## APIs

Discovery and reading:

- `GET /v1/catalog/formats`
- `GET /v1/catalog/datasets`
- `GET /v1/catalog/datasets/{dataset}`
- `GET /v1/catalog/datasets/{dataset}/manifest`
- `GET /v1/catalog/assets/{asset_id}/download`
- `POST /v1/query` for supported lazy matrix/table backends

Authentication and administration:

- `POST /v1/auth/bootstrap`, `POST /v1/auth/login`, `GET /v1/auth/me`
- `GET|POST /v1/admin/users`, `GET|PATCH /v1/admin/users/{user_id}`
- `GET|POST /v1/admin/tokens`, `DELETE /v1/admin/tokens/{token_id}`
- `PUT|DELETE /v1/admin/datasets/{dataset}/grants/{user_id}`
- `GET /v1/admin/datasets/{dataset}/grants`
- `GET /v1/admin/audit-events`

Ingestion:

- `POST /v1/ingest/validate`
- `POST /v1/ingest`
- `POST /v1/ingest/upload/validate`
- `POST /v1/ingest/upload`
- `GET /v1/ingest/{job_id}`

`POST /v1/ingest` accepts `visibility: "public" | "private"`, a data model, backend, version,
and a `source` mapping of asset roles to paths under `/data`.

## Read optimization

Format handling is performed during ingestion. The currently implemented fast path detects gzip
Xena gene-by-sample matrices, preserves the original compressed asset, writes an uncompressed
derived matrix under `/data/optimized`, builds a row-offset JSON index, and registers all three in
the manifest. This avoids rescanning or decompressing the full Toil matrix for each gene query.

Other formats are registered without lossy conversion. Their manifest makes it possible to add
backend-specific derivatives later without changing the dataset identity or client API.
