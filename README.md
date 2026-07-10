# Shennong Data Server

Shennong Data Server is a modular biomedical data API:

```text
R client -> FastAPI -> Backend router -> ClickHouse / TileDB-SOMA / PostgreSQL
```

It deliberately avoids a monolithic database. PostgreSQL stores dataset registry and version metadata only. ClickHouse serves bulk expression, survival, and eQTL tables. TileDB-SOMA serves sparse single-cell and spatial matrices.

## Run

```bash
cp .env.example .env
docker compose up --build
```

Health check:

```bash
curl http://localhost:8000/v1/health
```

## Core APIs

SPEC v2 uses one semantic public API over multiple storage backends:

- `GET /v1/catalog/datasets`
- `GET /v1/catalog/datasets/{dataset_id}`
- `GET /v1/catalog/datasets/{dataset_id}/schema`
- `GET /v1/catalog/datasets/{dataset_id}/capabilities`
- `GET /v1/catalog/datasets/{dataset_id}/fields`
- `GET /v1/catalog/datasets/{dataset_id}/values/{field}`
- `POST /v1/query`
- `POST /v1/compute`
- `POST /v1/jobs`
- `GET /v1/jobs/{job_id}`
- `DELETE /v1/jobs/{job_id}`
- `GET /v1/artifacts/{artifact_id}`
- `GET /v1/agent/tools`
- `POST /v1/agent/call`
- `POST /v1/ingest` for admin-side dataset registration
- `POST /v1/ingest/validate` for admin-side release validation reports
- `POST /v1/ingest/upload/validate` to preview and validate uploaded files without registering

All query endpoints return bounded pages with `next_cursor`, so R clients can lazily request batches without loading full matrices.

## Dataset Registry

Register a dataset version:

```bash
curl -X POST http://localhost:8000/v1/ingest \
  -H 'X-Shennong-Admin-Key: $SHENNONG_ADMIN_API_KEY' \
  -H 'content-type: application/json' \
  -d '{
    "dataset": "tcga_bulk",
    "data_model": "bulk",
    "backend": "clickhouse",
    "version": "2026.07",
    "citation": "TCGA via curated pipeline",
    "is_default": true,
    "metadata": {"organism": "human"}
  }'
```

## Lazy R-Compatible Query Shape

```bash
curl -X POST http://localhost:8000/v1/query \
  -H 'content-type: application/json' \
  -d '{
    "dataset": "tcga_bulk",
    "version": "2026.07",
    "assay": "rna",
    "data_model": "bulk",
    "select": {
      "features": ["IDH1", "TP53"],
      "observations": {"cancer": ["LGG"]},
      "fields": ["sample_id", "cancer", "group"]
    },
    "layer": "log2_tpm",
    "measure": "expression",
    "return": {"format": "json", "shape": "tidy"},
    "options": {"limit": 1000}
  }'
```

Response fields include `status`, `data`, and `meta`. `meta.next_cursor` lets R clients
continue lazy pagination without loading a full matrix.

## R Client

The R client is now published as a standalone package in this workspace at
`/home/duansq/dev/packages/shennong-data`, and is loaded as
`library(ShennongData)`. It is lazy by default: `sn_load_data()` creates a
remote dataset handle only, while `filter()` and `select()` record query
constraints. Data is fetched from `/v1/query` only when `sn_collect()`,
`sn_fetch_genes()`, or plotting helpers are called.

Install from the local source tree:

```bash
R CMD INSTALL /home/duansq/dev/packages/shennong-data
```

Example:

```r
library(ShennongData)

sn_set_api_url("http://127.0.0.1:18000")

toil <- sn_load_data("toil")

toil |>
  filter(cancer == "PAAD") |>
  sn_plot_box(gene = "YTHDF2", x = "group")
```

For bounded collection without plotting:

```r
rows <- toil |>
  filter(cancer == "PAAD") |>
  sn_collect(features = "YTHDF2", limit = 1000)

attr(rows, "shennong_meta")
```

## Ingestion

Validate a pending dataset release before registration:

```bash
curl -X POST http://localhost:8000/v1/ingest/validate \
  -H 'content-type: application/json' \
  -H "X-Shennong-Admin-Key: $SHENNONG_ADMIN_API_KEY" \
  -d '{
    "dataset": "toil",
    "version": "2026.07",
    "data_model": "bulk",
    "backend": "xena",
    "source": {"expression": "/data/shennong/toil/expression.tsv"},
    "metadata": {"title": "Toil Xena"}
  }'
```

The report separates registry validity from immediate queryability, so metadata-only
drafts can be staged without pretending they are queryable. For local tabular
sources under `SHENNONG_LOCAL_DATA_ROOT`, validation previews the header/sample
rows and applies initial modality checks for bulk expression, survival/clinical,
and eQTL/QTL tables.

Uploaded files can be checked before registration through
`POST /v1/ingest/upload/validate`; the file is saved under the controlled upload
staging directory, previewed, and validated with the same report shape.

Initialize schemas:

```bash
shennong-ingest schema metadata
shennong-ingest schema clickhouse
```

Load a CSV into ClickHouse in chunks and optionally register a dataset manifest:

```bash
shennong-ingest clickhouse load-csv \
  --table expression_bulk \
  --csv-file data/expression_bulk.csv \
  --manifest manifests/tcga_bulk.json
```

TileDB-SOMA datasets are registered by `storage_uri`; the API reads sparse slices lazily from SOMA.

## Gene Query Performance

Gene-level bulk expression queries are optimized by:

- ClickHouse `MergeTree` ordering on `(dataset, version, gene_symbol, cancer, sample_id)`
- Bloom skip indexes for gene and sample filters
- Redis-backed query cache with a longer TTL for expression queries
- Cursor-bounded API responses to prevent accidental full loads

The target is `<300ms` for cached gene-level queries under normal service/network conditions.
