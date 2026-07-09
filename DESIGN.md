# Shennong Data Server (SPEC v1.0)

## 0. Overview

Shennong Data Server is an AI-agent-native biomedical data infrastructure system designed to unify access to:

- Bulk RNA-seq (TCGA / GTEx / Toil)
- Survival analysis data
- Single-cell RNA-seq (TileDB-SOMA)
- Spatial transcriptomics
- eQTL / sQTL summary statistics
- Curated biological knowledge

It provides unified semantic query API for:
- R / Python users
- AI agents (tool calling)

## 1. Architecture

R Client → FastAPI → Backend Router → ClickHouse / TileDB-SOMA / PostgreSQL

## 2. Backends

- ClickHouse: bulk + survival + eQTL
- TileDB-SOMA: single-cell + spatial
- PostgreSQL: metadata registry
- File storage: local/S3

## 3. Core APIs

- /v1/expression/query
- /v1/survival/query
- /v1/singlecell/query
- /v1/spatial/query
- /v1/eqtl/query
- /v1/datasets

## 4. Data Model

dataset(id, type, backend, version, citation)
gene(gene_id, symbol)
sample(sample_id, cancer, tissue, group)
cell(cell_id, dataset, type)

## 5. ClickHouse Schema

expression_bulk(
 dataset, version, sample_id,
 gene_symbol, cancer, group_name, value
)

ORDER BY (dataset, version, gene_symbol, cancer, sample_id)

## 6. TileDB-SOMA

obs / var / X / obsm / layers

## 7. AI Agent Tools

- query_expression
- query_survival
- query_singlecell
- query_eqtl
- list_datasets

## 8. Design Rules

- No monolithic DB
- Backend pluggable
- Semantic query layer mandatory

