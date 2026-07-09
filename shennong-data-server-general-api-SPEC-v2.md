# Shennong Data Server — General API Design SPEC v2.0

> Updated design: replace fragmented endpoints such as `/expression/query`, `/singlecell/query`, `/survival/query`, and `/eqtl/query` with a general semantic query system built around `Catalog`, `QuerySpec`, `ComputeSpec`, `Jobs`, and `Artifacts`.

---

## 0. Project Positioning

**Shennong Data Server** is an AI-agent-native biomedical data backend for curated omics data access and analysis.

It should support:

- Bulk RNA-seq: TCGA, GTEx, Toil, CCLE, DepMap
- Survival and clinical data
- Single-cell RNA-seq
- Spatial transcriptomics
- eQTL / sQTL / QTL summary statistics
- Curated signatures, pathways, markers, cell type references
- Future modalities: scATAC-seq, CITE-seq, proteomics, metabolomics, methylation, mutation, CNV, microbiome

The core goal is:

```text
One semantic API, multiple data backends.
```

The user should not care whether the actual storage backend is ClickHouse, TileDB-SOMA, PostgreSQL, Parquet, DuckDB, local files, or object storage.

---

## 1. Core Architecture

```text
R / Python Client / AI Agent
          │
          ▼
FastAPI Semantic API Layer
          │
          ▼
Query Router / Compute Router
          │
 ┌────────┼────────────┬───────────────┬──────────────┐
 ▼        ▼            ▼               ▼              ▼
PostgreSQL ClickHouse  TileDB-SOMA      Parquet/DuckDB File/Object Store
metadata   tables      matrix store     offline layer  raw/export/cache
```

---

## 2. Design Principle

### 2.1 Do not expose backend-specific APIs

Do not design the public API around physical storage.

Bad:

```text
/v1/clickhouse/expression/query
/v1/tiledb/singlecell/query
```

Good:

```text
/v1/query
/v1/compute
/v1/catalog
```

---

### 2.2 Do not design by data type endpoint

Bad:

```text
/v1/expression/query
/v1/singlecell/query
/v1/survival/query
/v1/eqtl/query
/v1/spatial/query
```

This becomes fragmented as the platform grows.

Good:

```text
/v1/query      # get data
/v1/compute    # run analysis
/v1/catalog    # discover datasets and schemas
/v1/jobs       # async tasks
/v1/artifacts  # retrieve generated files/results
```

---

### 2.3 Unify semantics, not storage

The server should support multiple backends internally but expose one stable semantic API.

```text
User query → QuerySpec → Router → Backend Adapter → Result
```

---

## 3. Core Concepts

### 3.1 Dataset

A versioned biological data product.

Examples:

```text
toil
tcga_gdc_star
gtex_v11
hilca
glioma_idh
gtex_v11_eqtl
cellmarker
msigdb
```

Each dataset must define:

- dataset ID
- title
- version
- data model
- assay/modality
- backend
- schema
- capabilities
- citation
- license
- processing pipeline
- visibility
- default version

---

### 3.2 Observation

An observation is the entity being measured.

Examples:

| Data type | Observation |
|---|---|
| Bulk RNA-seq | sample |
| Survival | patient/sample |
| Single-cell RNA-seq | cell |
| Spatial transcriptomics | spot/cell/region |
| eQTL | variant-gene-tissue record |
| Mutation | sample/patient |
| ATAC | cell/sample |
| Proteomics | sample |

Canonical field name:

```text
observation_id
```

---

### 3.3 Feature

A feature is the measured biological entity.

Examples:

| Data type | Feature |
|---|---|
| RNA-seq | gene / transcript |
| scRNA-seq | gene |
| scATAC-seq | peak / motif / gene activity |
| eQTL | gene / variant |
| Protein | protein |
| Pathway score | pathway / signature |
| Mutation | gene / variant |

Canonical field name:

```text
feature_id
```

Optional fields:

```text
feature_symbol
feature_type
feature_namespace
```

---

### 3.4 Assay

Assay describes the biological measurement layer.

Examples:

```text
rna
transcript
protein
atac
spatial_rna
clinical
survival
eqtl
sqtl
mutation
cnv
signature
pathway
```

---

### 3.5 Data Model

Data model describes the structure of the dataset.

Recommended values:

```text
bulk
single_cell
spatial
table
clinical
qtl
knowledge
multiome
```

---

### 3.6 Layer

Layer identifies a matrix or measurement representation.

Examples:

```text
counts
tpm
log2_tpm
expected_count
lognorm
scaled
raw
imputed
pseudobulk
```

---

### 3.7 Measure

Measure identifies the value being returned.

Examples:

```text
expression
tpm
count
beta
pvalue
qvalue
hazard_ratio
survival_time
event
score
```

---

### 3.8 Cohort

A cohort is a filtered subset of observations.

Examples:

```json
{
  "cancer": ["PAAD"],
  "group": ["Tumor"],
  "tissue": ["Pancreas"]
}
```

---

## 4. Public API Overview

### 4.1 Minimal stable API

```text
GET  /health
GET  /version

GET  /v1/catalog/datasets
GET  /v1/catalog/datasets/{dataset_id}
GET  /v1/catalog/datasets/{dataset_id}/schema
GET  /v1/catalog/datasets/{dataset_id}/capabilities
GET  /v1/catalog/datasets/{dataset_id}/fields
GET  /v1/catalog/datasets/{dataset_id}/values/{field}

POST /v1/query
POST /v1/compute

POST /v1/jobs
GET  /v1/jobs/{job_id}
DELETE /v1/jobs/{job_id}

GET  /v1/artifacts/{artifact_id}

POST /v1/ingest
GET  /v1/ingest/{job_id}

GET  /v1/agent/tools
POST /v1/agent/call
```

---

## 5. Catalog API

The catalog allows R clients and AI agents to discover datasets, schemas, fields, and supported operations.

---

### 5.1 `GET /v1/catalog/datasets`

Return all datasets visible to the current user.

Example response:

```json
{
  "status": "success",
  "data": [
    {
      "dataset": "toil",
      "title": "UCSC Toil TCGA/TARGET/GTEx RNA-seq Recompute",
      "data_model": "bulk",
      "assays": ["rna"],
      "default_version": "v1",
      "backend": "clickhouse",
      "visibility": "public"
    },
    {
      "dataset": "hilca",
      "title": "Human ILC/NK Single-cell Atlas",
      "data_model": "single_cell",
      "assays": ["rna"],
      "default_version": "v1",
      "backend": "tiledb_soma",
      "visibility": "private"
    }
  ]
}
```

---

### 5.2 `GET /v1/catalog/datasets/{dataset_id}`

Return dataset metadata.

Example:

```json
{
  "status": "success",
  "data": {
    "dataset": "toil",
    "title": "UCSC Toil RNA-seq Recompute",
    "description": "Uniformly recomputed TCGA, TARGET and GTEx RNA-seq expression compendium.",
    "data_model": "bulk",
    "assays": ["rna"],
    "default_version": "v1",
    "versions": ["v1"],
    "citation": "Vivian et al., Nature Biotechnology 2017",
    "license": "source-dependent",
    "backend": "clickhouse"
  }
}
```

---

### 5.3 `GET /v1/catalog/datasets/{dataset_id}/schema`

Return the semantic schema of a dataset.

Example for bulk RNA-seq:

```json
{
  "status": "success",
  "data": {
    "dataset": "toil",
    "version": "v1",
    "data_model": "bulk",
    "assays": ["rna"],
    "observation": {
      "type": "sample",
      "id_field": "sample_id",
      "fields": {
        "sample_id": "string",
        "cancer": "categorical",
        "tissue": "categorical",
        "group": "categorical",
        "project": "categorical"
      }
    },
    "feature": {
      "type": "gene",
      "id_fields": ["gene_id", "gene_symbol"],
      "fields": {
        "gene_id": "string",
        "gene_symbol": "string",
        "biotype": "categorical"
      }
    },
    "layers": ["expected_count", "tpm", "log2_tpm"],
    "measures": ["expression"],
    "return_formats": ["json", "arrow", "parquet"],
    "return_shapes": ["tidy", "matrix", "matrix_with_obs"]
  }
}
```

Example for single-cell:

```json
{
  "status": "success",
  "data": {
    "dataset": "hilca",
    "version": "v1",
    "data_model": "single_cell",
    "assays": ["rna"],
    "observation": {
      "type": "cell",
      "id_field": "cell_id",
      "fields": {
        "cell_id": "string",
        "sample_id": "string",
        "tissue": "categorical",
        "disease": "categorical",
        "cell_type_level1": "categorical",
        "cell_type_level2": "categorical",
        "donor": "string"
      }
    },
    "feature": {
      "type": "gene",
      "id_fields": ["gene_id", "gene_symbol"]
    },
    "layers": ["counts", "lognorm", "scaled"],
    "embeddings": ["X_umap", "X_pca"],
    "return_formats": ["json", "arrow", "parquet", "h5ad", "seurat"],
    "return_shapes": ["tidy", "matrix", "matrix_with_obs", "anndata", "seurat"]
  }
}
```

---

### 5.4 `GET /v1/catalog/datasets/{dataset_id}/capabilities`

Return operations supported by the dataset.

Example:

```json
{
  "status": "success",
  "data": {
    "dataset": "hilca",
    "can_query_matrix": true,
    "can_filter_observations": true,
    "can_filter_features": true,
    "can_query_embedding": true,
    "can_compute_pseudobulk": true,
    "can_compute_de": true,
    "can_compute_signature_score": true,
    "can_export_seurat": true,
    "can_export_h5ad": true,
    "max_sync_cells": 100000,
    "max_sync_features": 200,
    "async_required_above_cells": 100000
  }
}
```

---

### 5.5 `GET /v1/catalog/datasets/{dataset_id}/values/{field}`

Return allowed values for a categorical field.

Example:

```text
GET /v1/catalog/datasets/toil/values/cancer
```

Response:

```json
{
  "status": "success",
  "data": {
    "field": "cancer",
    "values": ["PAAD", "LIHC", "GBM", "LGG", "BRCA"]
  }
}
```

---

## 6. Query API

### 6.1 Endpoint

```text
POST /v1/query
```

The query endpoint returns a data slice. It should not perform statistical modeling unless explicitly requested through `/v1/compute`.

---

## 7. QuerySpec

### 7.1 QuerySpec schema

```json
{
  "dataset": "string",
  "version": "latest",
  "assay": "rna",
  "data_model": "bulk",
  "select": {
    "features": [],
    "observations": {},
    "fields": []
  },
  "layer": "tpm",
  "measure": "expression",
  "return": {
    "format": "json",
    "shape": "tidy"
  },
  "options": {
    "limit": 100000,
    "include_metadata": true,
    "include_feature_metadata": false
  }
}
```

---

### 7.2 QuerySpec fields

| Field | Required | Meaning |
|---|---:|---|
| dataset | yes | dataset ID |
| version | no | dataset version; default is latest/default |
| assay | yes | rna, clinical, eqtl, spatial, etc. |
| data_model | no | bulk, single_cell, table, spatial, qtl |
| select.features | no | genes, transcripts, peaks, proteins, variants, signatures |
| select.observations | no | sample/cell/spot filters |
| select.fields | no | metadata fields to return |
| layer | no | counts, tpm, lognorm, etc. |
| measure | no | expression, beta, pvalue, score |
| return.format | no | json, arrow, parquet, h5ad, seurat |
| return.shape | no | tidy, matrix, matrix_with_obs, table |
| options | no | limit, metadata, sampling, etc. |

---

## 8. Query Examples

### 8.1 Bulk expression query

R user intent:

```r
toil |>
  filter(cancer == "PAAD") |>
  sn_plot_box(gene = "YTHDF2", x = "group")
```

API request:

```json
{
  "dataset": "toil",
  "version": "latest",
  "assay": "rna",
  "data_model": "bulk",
  "select": {
    "features": ["YTHDF2"],
    "observations": {
      "cancer": ["PAAD"]
    },
    "fields": ["sample_id", "cancer", "group"]
  },
  "layer": "tpm",
  "measure": "expression",
  "return": {
    "format": "json",
    "shape": "tidy"
  }
}
```

Response:

```json
{
  "status": "success",
  "data": [
    {
      "observation_id": "TCGA-2J-AAB1",
      "feature": "YTHDF2",
      "value": 7.31,
      "cancer": "PAAD",
      "group": "Tumor"
    }
  ],
  "meta": {
    "dataset": "toil",
    "version": "v1",
    "backend": "clickhouse",
    "n_rows": 184
  }
}
```

---

### 8.2 Single-cell expression query

```json
{
  "dataset": "hilca",
  "version": "latest",
  "assay": "rna",
  "data_model": "single_cell",
  "select": {
    "features": ["IL7R", "KIT", "RORC"],
    "observations": {
      "tissue": ["Liver"],
      "disease": ["Tumor"],
      "cell_type_level2": ["ILC3"]
    },
    "fields": ["cell_id", "sample_id", "tissue", "cell_type_level2"]
  },
  "layer": "lognorm",
  "measure": "expression",
  "return": {
    "format": "arrow",
    "shape": "matrix_with_obs"
  },
  "options": {
    "include_metadata": true
  }
}
```

---

### 8.3 Spatial query

```json
{
  "dataset": "spatial_liver_tumor",
  "version": "latest",
  "assay": "spatial_rna",
  "data_model": "spatial",
  "select": {
    "features": ["IL7R", "CXCL13"],
    "observations": {
      "sample_id": ["S1"],
      "region": ["tumor_margin"]
    },
    "fields": ["spot_id", "x", "y", "region", "cell_type"]
  },
  "layer": "lognorm",
  "return": {
    "format": "json",
    "shape": "tidy"
  }
}
```

---

### 8.4 eQTL query

```json
{
  "dataset": "gtex_v11_eqtl",
  "version": "latest",
  "assay": "eqtl",
  "data_model": "qtl",
  "select": {
    "features": ["YTHDF2"],
    "observations": {
      "tissue": ["Pancreas"]
    },
    "fields": ["variant_id", "gene_symbol", "tissue", "beta", "pvalue", "qvalue"]
  },
  "measure": ["beta", "pvalue", "qvalue"],
  "return": {
    "format": "json",
    "shape": "table"
  }
}
```

---

### 8.5 Clinical / survival table query

```json
{
  "dataset": "tcga_clinical",
  "version": "latest",
  "assay": "clinical",
  "data_model": "clinical",
  "select": {
    "observations": {
      "cancer": ["PAAD"]
    },
    "fields": ["sample_id", "patient_id", "OS_time", "OS_event", "age", "gender", "stage"]
  },
  "return": {
    "format": "json",
    "shape": "table"
  }
}
```

---

## 9. Compute API

### 9.1 Endpoint

```text
POST /v1/compute
```

The compute endpoint performs analysis tasks using one or more datasets.

It should support both synchronous and asynchronous execution.

---

## 10. ComputeSpec

### 10.1 ComputeSpec schema

```json
{
  "task": "string",
  "dataset": "string",
  "version": "latest",
  "inputs": {},
  "cohort": {},
  "parameters": {},
  "return": {
    "format": "json",
    "include_plot_data": true
  },
  "execution": {
    "mode": "auto"
  }
}
```

---

### 10.2 ComputeSpec fields

| Field | Required | Meaning |
|---|---:|---|
| task | yes | survival, de, pseudobulk, correlation, enrichment, signature_score |
| dataset | yes | primary dataset ID |
| inputs | yes | assay/layer/features/clinical info |
| cohort | no | sample/cell filters |
| parameters | no | task-specific parameters |
| return | no | format and detail level |
| execution.mode | no | sync, async, auto |

---

## 11. Compute Task Examples

### 11.1 Survival analysis

```json
{
  "task": "survival",
  "dataset": "toil",
  "version": "latest",
  "inputs": {
    "expression": {
      "assay": "rna",
      "features": ["YTHDF2"],
      "layer": "tpm"
    },
    "clinical": {
      "time": "OS_time",
      "event": "OS_event"
    }
  },
  "cohort": {
    "cancer": ["PAAD"]
  },
  "parameters": {
    "group_method": "median_split",
    "model": "kaplan_meier",
    "cox_covariates": []
  },
  "return": {
    "format": "json",
    "include_plot_data": true
  },
  "execution": {
    "mode": "sync"
  }
}
```

Response:

```json
{
  "status": "success",
  "result": {
    "task": "survival",
    "feature": "YTHDF2",
    "hazard_ratio": 1.82,
    "p_value": 0.013,
    "n_high": 89,
    "n_low": 89,
    "curve_data": [
      {
        "time": 0,
        "survival": 1.0,
        "group": "high"
      }
    ]
  },
  "meta": {
    "dataset": "toil",
    "version": "v1"
  }
}
```

---

### 11.2 Differential expression

```json
{
  "task": "differential_expression",
  "dataset": "hilca",
  "version": "latest",
  "inputs": {
    "assay": "rna",
    "layer": "counts"
  },
  "cohort": {
    "cell_type_level2": ["ILC3"],
    "tissue": ["Liver"]
  },
  "parameters": {
    "group_by": "disease",
    "case": "Tumor",
    "control": "Normal",
    "method": "pseudobulk_deseq2",
    "replicate_field": "sample_id"
  },
  "return": {
    "format": "json"
  },
  "execution": {
    "mode": "async"
  }
}
```

---

### 11.3 Pseudobulk

```json
{
  "task": "pseudobulk",
  "dataset": "hilca",
  "version": "latest",
  "inputs": {
    "assay": "rna",
    "layer": "counts",
    "features": ["IL7R", "KIT", "RORC"]
  },
  "cohort": {
    "tissue": ["Liver"],
    "cell_type_level2": ["ILC3"]
  },
  "parameters": {
    "group_by": ["sample_id", "disease"],
    "aggregation": "sum"
  },
  "return": {
    "format": "arrow",
    "shape": "matrix"
  }
}
```

---

### 11.4 Signature score

```json
{
  "task": "signature_score",
  "dataset": "hilca",
  "version": "latest",
  "inputs": {
    "assay": "rna",
    "layer": "lognorm",
    "signature": {
      "name": "ILC3_signature",
      "genes": ["RORC", "KIT", "IL7R", "IL23R"]
    }
  },
  "cohort": {
    "tissue": ["Liver"]
  },
  "parameters": {
    "method": "average_expression",
    "group_by": ["cell_type_level2"]
  },
  "return": {
    "format": "json",
    "shape": "tidy"
  }
}
```

---

### 11.5 Correlation

```json
{
  "task": "correlation",
  "dataset": "toil",
  "version": "latest",
  "inputs": {
    "assay": "rna",
    "features_x": ["YTHDF2"],
    "features_y": ["CD274", "PDCD1LG2", "CXCL10"],
    "layer": "tpm"
  },
  "cohort": {
    "cancer": ["PAAD"]
  },
  "parameters": {
    "method": "spearman"
  },
  "return": {
    "format": "json"
  }
}
```

---

## 12. Jobs API

Large tasks should be executed asynchronously.

### 12.1 Start job

```text
POST /v1/jobs
```

Request:

```json
{
  "type": "compute",
  "spec": {
    "task": "differential_expression",
    "dataset": "hilca",
    "parameters": {
      "method": "pseudobulk_deseq2"
    }
  }
}
```

Response:

```json
{
  "status": "accepted",
  "job_id": "job_20260706_0001",
  "state": "queued"
}
```

---

### 12.2 Get job status

```text
GET /v1/jobs/{job_id}
```

Response:

```json
{
  "status": "success",
  "data": {
    "job_id": "job_20260706_0001",
    "state": "running",
    "progress": 0.42,
    "message": "Running pseudobulk aggregation",
    "created_at": "2026-07-06T12:00:00Z",
    "updated_at": "2026-07-06T12:03:10Z"
  }
}
```

---

### 12.3 Completed job response

```json
{
  "status": "success",
  "data": {
    "job_id": "job_20260706_0001",
    "state": "completed",
    "artifacts": [
      {
        "artifact_id": "artifact_de_result_001",
        "type": "table",
        "format": "parquet"
      }
    ]
  }
}
```

---

## 13. Artifacts API

Artifacts are generated outputs from queries or compute jobs.

Examples:

- Parquet result
- Arrow IPC file
- HTML report
- plot JSON
- Seurat object
- H5AD file
- CSV table
- cached query result

### 13.1 Retrieve artifact metadata

```text
GET /v1/artifacts/{artifact_id}
```

Response:

```json
{
  "status": "success",
  "data": {
    "artifact_id": "artifact_de_result_001",
    "type": "table",
    "format": "parquet",
    "size_bytes": 1234567,
    "download_url": "/v1/artifacts/artifact_de_result_001/download",
    "expires_at": "2026-07-07T00:00:00Z"
  }
}
```

---

## 14. Agent API

AI agents should not receive many narrow tools. They should receive a small number of general tools.

---

### 14.1 Agent tools

Required agent tools:

```text
list_datasets
get_dataset_schema
get_dataset_capabilities
query_data
compute
get_job
get_artifact
```

Optional tools:

```text
search_features
search_samples
validate_query
explain_dataset
```

---

### 14.2 `GET /v1/agent/tools`

Return tool schemas for AI agents.

Example response:

```json
{
  "status": "success",
  "tools": [
    {
      "name": "query_data",
      "description": "Query a data slice from any Shennong dataset using QuerySpec.",
      "input_schema": {
        "type": "object",
        "properties": {
          "dataset": {
            "type": "string"
          },
          "assay": {
            "type": "string"
          },
          "select": {
            "type": "object"
          },
          "return": {
            "type": "object"
          }
        },
        "required": ["dataset", "assay", "select"]
      }
    },
    {
      "name": "compute",
      "description": "Run a supported analysis task using ComputeSpec.",
      "input_schema": {
        "type": "object",
        "properties": {
          "task": {
            "type": "string"
          },
          "dataset": {
            "type": "string"
          },
          "inputs": {
            "type": "object"
          },
          "parameters": {
            "type": "object"
          }
        },
        "required": ["task", "dataset", "inputs"]
      }
    }
  ]
}
```

---

### 14.3 `POST /v1/agent/call`

Generic tool call endpoint.

Request:

```json
{
  "tool": "query_data",
  "args": {
    "dataset": "toil",
    "assay": "rna",
    "select": {
      "features": ["YTHDF2"],
      "observations": {
        "cancer": ["PAAD"]
      }
    },
    "layer": "tpm",
    "return": {
      "format": "json",
      "shape": "tidy"
    }
  }
}
```

Response:

```json
{
  "status": "success",
  "tool": "query_data",
  "data": [],
  "meta": {
    "dataset": "toil",
    "backend": "clickhouse",
    "n_rows": 184
  }
}
```

---

## 15. Backend Router

The public API should not know the physical backend. It uses dataset registry and capability registry to route requests.

Pseudo-code:

```python
def route_query(spec: QuerySpec):
    dataset = registry.get_dataset(spec.dataset, spec.version)
    backend = backend_factory.get(dataset.backend)
    return backend.query(spec)
```

---

## 16. Backend Adapter Interface

All backend adapters must implement a stable interface.

```python
class BackendAdapter:
    def query(self, spec: QuerySpec) -> QueryResult:
        raise NotImplementedError

    def compute(self, spec: ComputeSpec) -> ComputeResult:
        raise NotImplementedError

    def validate_query(self, spec: QuerySpec) -> ValidationResult:
        raise NotImplementedError

    def get_schema(self, dataset: str, version: str) -> dict:
        raise NotImplementedError
```

---

## 17. Recommended Backend Mapping

| Data type | Backend | Reason |
|---|---|---|
| Bulk expression | ClickHouse | Fast gene/sample OLAP queries |
| eQTL / sQTL | ClickHouse | Large table with gene/variant/tissue filtering |
| Clinical/survival | PostgreSQL + ClickHouse | Metadata + fast cohort queries |
| Single-cell RNA-seq | TileDB-SOMA | Sparse matrix + obs/var/obsm |
| Spatial transcriptomics | TileDB-SOMA / Zarr | Matrix + coordinates + image metadata |
| Raw files | local filesystem / S3 | Archival and export |
| Metadata registry | PostgreSQL | Dataset versions, schemas, permissions |
| Cache | Redis | Frequent queries and computed results |

---

## 18. PostgreSQL Metadata Schema

### 18.1 datasets

```sql
CREATE TABLE datasets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    data_model TEXT NOT NULL,
    backend TEXT NOT NULL,
    default_version TEXT,
    visibility TEXT DEFAULT 'private',
    citation TEXT,
    license TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);
```

---

### 18.2 dataset_versions

```sql
CREATE TABLE dataset_versions (
    id TEXT PRIMARY KEY,
    dataset_id TEXT REFERENCES datasets(id),
    version TEXT NOT NULL,
    status TEXT DEFAULT 'building',
    schema JSONB,
    capabilities JSONB,
    backend_config JSONB,
    processing_info JSONB,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    UNIQUE(dataset_id, version)
);
```

---

### 18.3 artifacts

```sql
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    dataset_id TEXT,
    job_id TEXT,
    type TEXT,
    format TEXT,
    path TEXT,
    size_bytes BIGINT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT now(),
    expires_at TIMESTAMP
);
```

---

### 18.4 jobs

```sql
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    state TEXT NOT NULL,
    spec JSONB NOT NULL,
    result JSONB,
    error TEXT,
    progress FLOAT DEFAULT 0,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);
```

---

## 19. ClickHouse Schemas

### 19.1 bulk expression

```sql
CREATE TABLE expression_bulk (
    dataset LowCardinality(String),
    version LowCardinality(String),
    observation_id String,
    sample_id String,
    gene_id String,
    gene_symbol LowCardinality(String),
    cancer LowCardinality(String),
    tissue LowCardinality(String),
    group_name LowCardinality(String),
    layer LowCardinality(String),
    value Float32
)
ENGINE = MergeTree
PARTITION BY (dataset, version)
ORDER BY (dataset, version, gene_symbol, cancer, group_name, observation_id);
```

---

### 19.2 QTL table

```sql
CREATE TABLE qtl_results (
    dataset LowCardinality(String),
    version LowCardinality(String),
    tissue LowCardinality(String),
    variant_id String,
    gene_id String,
    gene_symbol LowCardinality(String),
    beta Float32,
    pvalue Float64,
    qvalue Float64,
    maf Float32,
    n UInt32
)
ENGINE = MergeTree
PARTITION BY (dataset, version)
ORDER BY (dataset, version, gene_symbol, tissue, pvalue);
```

---

### 19.3 clinical survival table

```sql
CREATE TABLE survival_clinical (
    dataset LowCardinality(String),
    version LowCardinality(String),
    sample_id String,
    patient_id String,
    cancer LowCardinality(String),
    time Float32,
    event UInt8,
    endpoint LowCardinality(String),
    age Float32,
    gender LowCardinality(String),
    stage LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY (dataset, version)
ORDER BY (dataset, version, cancer, endpoint, sample_id);
```

---

## 20. TileDB-SOMA Layout

For single-cell and spatial datasets:

```text
/datasets/{dataset_id}/{version}/soma/
  obs
  var
  ms/
    RNA/
      X/
        counts
        lognorm
        scaled
      obsm/
        X_umap
        X_pca
      varm/
      layers/
  uns
```

Required obs columns:

```text
cell_id
sample_id
donor_id
dataset
tissue
disease
cell_type_level1
cell_type_level2
batch
```

Required var columns:

```text
gene_id
gene_symbol
biotype
```

Spatial obs extensions:

```text
spot_id
x
y
region
image_id
segmentation_id
```

---

## 21. R Client Mapping

The R client should expose lazy objects.

### 21.1 Load dataset

```r
toil <- sn_load_data("toil")
hilca <- sn_load_data("hilca")
```

No data should be downloaded at this stage.

---

### 21.2 Bulk query

```r
toil |>
  filter(cancer == "PAAD") |>
  sn_plot_box(gene = "YTHDF2", x = "group")
```

Internal QuerySpec:

```json
{
  "dataset": "toil",
  "assay": "rna",
  "data_model": "bulk",
  "select": {
    "features": ["YTHDF2"],
    "observations": {
      "cancer": ["PAAD"]
    }
  },
  "layer": "tpm",
  "return": {
    "format": "json",
    "shape": "tidy"
  }
}
```

---

### 21.3 Single-cell query

```r
hilca |>
  filter(tissue == "Liver", cell_type_level2 == "ILC3") |>
  sn_fetch_genes(c("IL7R", "KIT", "RORC"))
```

Internal QuerySpec:

```json
{
  "dataset": "hilca",
  "assay": "rna",
  "data_model": "single_cell",
  "select": {
    "features": ["IL7R", "KIT", "RORC"],
    "observations": {
      "tissue": ["Liver"],
      "cell_type_level2": ["ILC3"]
    }
  },
  "layer": "lognorm",
  "return": {
    "format": "arrow",
    "shape": "matrix_with_obs"
  }
}
```

---

## 22. Ingestion API

### 22.1 Endpoint

```text
POST /v1/ingest
```

For large imports, ingestion should run as a background job.

Request:

```json
{
  "dataset": "toil",
  "version": "v1",
  "data_model": "bulk",
  "backend": "clickhouse",
  "source": {
    "expression": "/data/raw/toil/expression.tsv.gz",
    "metadata": "/data/raw/toil/phenotype.tsv.gz"
  },
  "options": {
    "layer": "tpm",
    "id_type": "gene_symbol"
  }
}
```

Response:

```json
{
  "status": "accepted",
  "job_id": "ingest_20260706_0001"
}
```

---

## 23. CLI

The server should include a CLI for administrators.

Examples:

```bash
shennong-data-server datasets list
shennong-data-server datasets inspect toil
shennong-data-server ingest bulk --dataset toil --version v1
shennong-data-server ingest soma --dataset hilca --version v1 --input hilca.h5ad
shennong-data-server validate toil:v1
shennong-data-server publish toil:v1
shennong-data-server rollback toil:v1
```

---

## 24. Docker Compose

Minimum services:

```yaml
services:
  api:
    build: ./api
    env_file: .env
    volumes:
      - ./data:/data
    depends_on:
      - postgres
      - redis

  worker:
    build: ./api
    command: ["shennong-worker"]
    env_file: .env
    volumes:
      - ./data:/data
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16
    volumes:
      - postgres_data:/var/lib/postgresql/data

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    volumes:
      - clickhouse_data:/var/lib/clickhouse

  redis:
    image: redis:7
    volumes:
      - redis_data:/data

  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config

volumes:
  postgres_data:
  clickhouse_data:
  redis_data:
  caddy_data:
  caddy_config:
```

---

## 25. Repository Structure

```text
shennong-data-server/
├── README.md
├── docker-compose.yml
├── .env.example
├── api/
│   ├── Dockerfile
│   ├── pyproject.toml
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── routers/
│       │   ├── catalog.py
│       │   ├── query.py
│       │   ├── compute.py
│       │   ├── jobs.py
│       │   ├── artifacts.py
│       │   ├── ingest.py
│       │   └── agent.py
│       ├── schemas/
│       │   ├── query.py
│       │   ├── compute.py
│       │   ├── catalog.py
│       │   ├── jobs.py
│       │   └── common.py
│       ├── backends/
│       │   ├── base.py
│       │   ├── clickhouse.py
│       │   ├── tiledb_soma.py
│       │   ├── postgres.py
│       │   ├── parquet.py
│       │   └── file.py
│       ├── services/
│       │   ├── registry.py
│       │   ├── router.py
│       │   ├── cache.py
│       │   ├── artifact.py
│       │   └── agent_tools.py
│       ├── compute/
│       │   ├── survival.py
│       │   ├── pseudobulk.py
│       │   ├── differential_expression.py
│       │   ├── signature_score.py
│       │   └── correlation.py
│       ├── ingest/
│       │   ├── bulk.py
│       │   ├── soma.py
│       │   ├── qtl.py
│       │   └── clinical.py
│       └── cli.py
├── migrations/
├── schemas/
│   ├── postgres.sql
│   └── clickhouse.sql
├── deploy/
│   └── Caddyfile
├── data/
│   ├── raw/
│   ├── curated/
│   ├── tiledb/
│   ├── artifacts/
│   └── cache/
└── tests/
    ├── test_catalog.py
    ├── test_query.py
    ├── test_compute.py
    └── test_agent_tools.py
```

---

## 26. Error Response Format

All errors must use the same shape.

```json
{
  "status": "error",
  "error": {
    "code": "INVALID_QUERY",
    "message": "Field 'cancer_type' is not available in dataset 'toil'.",
    "details": {
      "available_fields": ["cancer", "tissue", "group"]
    }
  }
}
```

Recommended error codes:

```text
DATASET_NOT_FOUND
VERSION_NOT_FOUND
FIELD_NOT_FOUND
FEATURE_NOT_FOUND
INVALID_QUERY
UNSUPPORTED_OPERATION
QUERY_TOO_LARGE
BACKEND_ERROR
PERMISSION_DENIED
JOB_NOT_FOUND
ARTIFACT_NOT_FOUND
```

---

## 27. Security and Permissions

Minimum permission levels:

```text
public_reader
private_reader
project_member
dataset_admin
system_admin
agent
```

Permission rules:

- Public datasets can be queried anonymously if enabled.
- Private datasets require authentication.
- Large exports require authenticated users.
- Ingestion requires dataset_admin or system_admin.
- Agent calls must be permission-scoped.

---

## 28. Performance Rules

### 28.1 Synchronous query limits

Default limits:

```text
max_rows_json: 100000
max_features_sync: 200
max_cells_sync: 100000
max_runtime_sync_seconds: 30
```

If exceeded, return:

```json
{
  "status": "accepted",
  "job_id": "job_xxx",
  "message": "Query is too large for synchronous execution and was submitted as a job."
}
```

---

### 28.2 Return formats

Small results:

```text
json
```

Medium results:

```text
arrow
parquet
```

Large results:

```text
artifact download
```

---

## 29. Caching

Cache keys should hash:

```text
dataset
version
assay
data_model
select
layer
measure
return shape
```

Cacheable tasks:

- single gene expression query
- single gene survival query
- common pan-cancer expression query
- small eQTL query
- catalog schema/capability

---

## 30. MVP Development Plan

### Phase 1: Core server

- FastAPI app
- PostgreSQL metadata registry
- `/v1/catalog`
- `/v1/query`
- QuerySpec / ComputeSpec Pydantic models
- Mock backend
- Docker Compose

### Phase 2: Bulk data

- ClickHouse backend
- Toil bulk expression ingestion
- Bulk QuerySpec support
- R client compatibility

### Phase 3: Single-cell

- TileDB-SOMA backend
- H5AD to SOMA ingestion
- obs filtering
- gene selection
- Arrow return

### Phase 4: Compute

- survival
- correlation
- signature score
- pseudobulk
- differential expression as async job

### Phase 5: AI agent support

- `/v1/agent/tools`
- `/v1/agent/call`
- schema-based validation
- job-aware agent workflow

### Phase 6: Spatial and eQTL

- spatial query support
- QTL ClickHouse schema
- eQTL query support

---

## 31. Codex Implementation Instruction

Build this system according to this SPEC.

The first implementation should prioritize:

1. General API design
2. QuerySpec and ComputeSpec
3. Catalog registry
4. Pluggable backend interface
5. Mock backend tests
6. ClickHouse bulk backend
7. Docker Compose

Do not implement fragmented endpoints as the primary API.

Convenience aliases may be added later, but the core API must be:

```text
/v1/catalog
/v1/query
/v1/compute
/v1/jobs
/v1/artifacts
/v1/agent
```

---

## 32. Final Architectural Rule

```text
The stable abstraction is not expression, single-cell, spatial, or eQTL.
The stable abstraction is:

Dataset + QuerySpec + ComputeSpec + Capability Registry.
```
