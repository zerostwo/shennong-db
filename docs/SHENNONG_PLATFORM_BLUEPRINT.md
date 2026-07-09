# Shennong Platform Technical Blueprint

## Product Thesis

Shennong is an AI-agent-first bioinformatics data platform. It should serve two
use cases at the same time:

1. A general data infrastructure framework for labs and teams that need to
   store, version, publish, query, and visualize their own biomedical datasets.
2. A discovery workspace where researchers can ask biological questions through
   a web interface, R client, and eventually Python client, while AI agents call
   controlled data and analysis tools instead of guessing.

The platform is not a monolithic database and not just a static dataset portal.
It is a modular data operating layer:

```text
Web UI / R client / Python client / AI agent
        |
FastAPI gateway
        |
Auth, dataset registry, query planner, agent tool router, job manager
        |
Pluggable storage and compute backends
```

## Product Pillars

### 1. Universal Bioinformatics Data Server

Shennong Data Server is the foundation. It stores registry metadata in
PostgreSQL, routes analytical reads to the right backend, enforces versioning and
permissions, and returns bounded lazy query pages.

Primary data types:

- Bulk expression
- Survival and clinical tables
- Single-cell expression
- Spatial expression
- eQTL and sQTL summary statistics
- Future extensions: mutation, CNV, ATAC, proteomics, pathway scores, knowledge
  bases, embeddings

### 2. Dataset Publishing Platform

Any lab should be able to create and publish a dataset such as a pan-cancer
T-cell atlas. A dataset release must have a durable landing page, schema,
version, citation, visibility, and examples for Web, R, and API access.

Publishing must support:

- Private draft dataset
- Internal lab sharing
- Public release
- Versioned updates
- Release validation reports
- Dataset-level AI chat
- Export and download policies

### 3. Interactive Scientific Workspace

The Web UI should combine a dataset catalog, cell explorer, gene expression
viewer, survival viewer, and analysis workspace. The visual direction should
borrow the dense scientific browsing affordances of CELLxGENE and the clean
conversation/workbench model of ChatGPT and Codex.

The first screen is the product workspace, not a marketing landing page.

### 4. Agent-First Discovery

Agents must never directly manipulate storage backends. They call versioned,
schema-defined tools:

- list datasets
- inspect schema
- query expression
- query survival
- query single-cell slices
- query spatial regions
- query eQTL
- run differential expression
- run survival association
- run cell type abundance association
- generate plots
- create reproducible analysis artifacts

Every agent answer must expose provenance:

- Dataset id and version
- Tool calls used
- Query filters
- Number of rows/cells/samples
- Statistical method
- Generated chart or table
- Reproducible R/API code
- Caveats

## System Components

### Shennong Data Server

Status: active priority.

Responsibilities:

- FastAPI public and admin API
- Dataset registry and versioning
- Backend routing
- Lazy query and pagination
- Query cache
- Admin ingestion endpoints
- AI tool schemas
- Job and artifact API
- Security boundary for public deployments

Current backend design:

```text
BackendRouter
  |-- PostgreSQL registry: dataset metadata and versions
  |-- Redis: query cache and future session/cache state
  |-- ClickHouse: bulk expression, survival, eQTL
  |-- TileDB-SOMA: single-cell and spatial sparse arrays
  |-- 10x H5: lightweight single-cell examples
  |-- Xena/local matrix: curated public matrix examples
```

### Shennong Web

Status: next active priority.

Responsibilities:

- Dataset catalog
- Dataset detail and release page
- Explorer workspace
- Gene expression and survival viewers
- Single-cell and spatial visualization panels
- AI chat panel with dataset context
- Admin publishing and ingestion console
- User/project/workspace navigation

### Multi-User Management

Status: active priority after Web shell.

Responsibilities:

- Users
- Organizations or labs
- Projects
- Dataset ownership
- Roles: owner, admin, curator, analyst, viewer
- API tokens
- Public/private visibility
- Audit events

This must live mainly in PostgreSQL and API middleware. It should not be
implemented as ad hoc flags in dataset metadata.

### R Client

Status: client priority before Python.

Responsibilities:

- `library(ShennongData)`
- `sn_load_data("dataset")` returns a lazy remote table
- dplyr-style filtering
- Bounded collection with `sn_collect()`
- Plot helpers such as `sn_plot_box()`
- Admin publishing helpers with explicit token use
- No full matrix load unless explicitly requested

### Python Client

Status: later priority.

Responsibilities:

- Lazy query object
- Pandas and AnnData export
- Async API support
- Notebook-friendly visual helpers

### Agent Server

Status: after stable API and Web shell.

Initial implementation can live inside Data Server. It should later become its
own service if code execution, provider credentials, conversation storage, and
sandboxing become complex.

Responsibilities:

- Provider configuration: OpenAI, Anthropic, local models
- Tool calling
- Dataset context selection
- Tool result summarization
- Conversation history
- Reproducible analysis plans
- Code execution sandbox integration

### Ingestion and Publishing Tools

Status: active priority after server API hardening.

Responsibilities:

- Dataset manifest validation
- Bulk import to ClickHouse
- Single-cell and spatial registration
- Metadata harmonization
- Release summary generation
- Version publishing
- Admin Web UI integration

## Canonical Data Model

```text
Organization
  |
Project
  |
Dataset
  |
DatasetVersion
  |-- Assay
  |-- Feature axis: gene, peak, variant, pathway
  |-- Observation axis: sample, cell, spot, patient
  |-- Metadata fields
  |-- Layers
  |-- Embeddings
  |-- Clinical tables
  |-- Survival endpoints
  |-- Analysis artifacts
```

Dataset versions are immutable after release. New data, changed annotations, or
schema changes must create a new version.

## API Layers

### Public Read APIs

- `GET /v1/catalog/datasets`
- `GET /v1/catalog/datasets/{dataset_id}`
- `GET /v1/catalog/datasets/{dataset_id}/schema`
- `GET /v1/catalog/datasets/{dataset_id}/capabilities`
- `GET /v1/catalog/datasets/{dataset_id}/fields`
- `GET /v1/catalog/datasets/{dataset_id}/values/{field}`
- `POST /v1/query`
- Legacy compatibility query endpoints during migration

### Admin APIs

- `POST /v1/datasets`
- `POST /v1/ingest/validate`
- `POST /v1/ingest/upload/validate`
- `POST /v1/ingest`
- `POST /v1/ingest/upload`
- `POST /v1/compute`
- `POST /v1/jobs`
- `GET /v1/jobs/{job_id}`
- `DELETE /v1/jobs/{job_id}`
- `GET /v1/artifacts/{artifact_id}`

### Future User and Project APIs

- `POST /v1/auth/login`
- `GET /v1/me`
- `GET /v1/orgs`
- `POST /v1/projects`
- `GET /v1/projects/{project_id}/datasets`
- `POST /v1/api-tokens`
- `GET /v1/audit/events`

## Web IA

The Web UI has five main work areas:

1. Catalog: browse datasets and releases.
2. Dataset: schema, metadata, API examples, and publication status.
3. Explore: UMAP/spatial/gene/survival panels with filters.
4. Agent: dataset-aware conversation and tool trace.
5. Publish: upload, validate, register, release, and manage permissions.

## Reliability and Safety Principles

- Public deployments must expose only the reverse proxy, not storage backend
  ports.
- Query APIs must be bounded and paginated by default.
- Admin APIs require explicit credentials.
- Agents use tools and schemas, not raw database access.
- Query responses include dataset version and provenance.
- Dataset storage paths are server-side and constrained to the configured data
  root.
- Jobs and artifacts need durable storage before production compute is enabled.

## Near-Term Definition of Done

The platform becomes a coherent MVP when these are true:

- Data Server has stable registry, catalog, query, ingestion, and admin
  boundaries.
- Web UI can browse datasets, query gene expression, show survival and
  single-cell views, and open dataset-aware chat.
- R client supports lazy tidyverse workflows against the deployed API.
- Multi-user model supports at least one organization, projects, dataset
  visibility, and API tokens.
- Agent tools can answer grounded expression and survival questions with
  visible tool traces.
- Publishing flow can register and release a lab-owned dataset version.
