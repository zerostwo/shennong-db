# Shennong Implementation Roadmap

This roadmap turns the platform blueprint into implementable work. The order is
intentional: stabilize the data server first, then ship Web, then add multi-user
control, publishing workflows, and richer agent analysis.

## Phase 0: Current Baseline

Current implemented foundations:

- FastAPI app with modular route files
- PostgreSQL dataset registry option
- Redis query cache option
- ClickHouse backend for expression, survival, and eQTL tables
- Xena/local matrix backend for curated public expression examples
- 10x H5 backend for lightweight single-cell examples
- TileDB-SOMA adapter scaffold
- Admin token for write, ingest, compute, and job endpoints
- Docker Compose deployment with local-only backend port bindings
- R package with lazy loading and admin token support

Known gaps:

- Jobs are in memory and not durable.
- Compute endpoints queue placeholder jobs but do not run real analysis.
- Multi-user auth and project ownership are not implemented.
- Web UI is not yet integrated as a production service.
- Dataset publishing workflow is not complete.
- Python client is not a priority yet.

## Phase 1: Shennong Data Server Hardening

Goal: make the API the reliable platform contract.

Tasks:

- Normalize all API response envelopes and error shapes.
- Add durable job table and artifact table in PostgreSQL.
- Add dataset visibility and release status columns.
- Add dataset schema validation for each modality.
- Add stronger registry constraints for dataset id, version, and backend.
- Add admin audit events for writes and ingestion.
- Add integration tests for PostgreSQL, Redis, and ClickHouse compose stack.
- Add OpenAPI export for docs generation even when public docs are disabled.
- Add rate limit hooks for public query endpoints.
- Add query provenance fields for every response.

Acceptance:

- Public read APIs work without admin token.
- Admin APIs require token or future user role.
- Query responses are bounded, cached, and versioned.
- Restarting the service does not lose jobs or artifacts.

## Phase 2: Shennong Web MVP

Goal: researchers can browse and explore datasets without code.

Tasks:

- Create React/Vite Web app.
- Add dataset catalog with modality, tissue, organism, backend, and visibility
  filters.
- Extend `/datasets/:dataset_id` release pages with route-level version selection
  and shareable analysis state.
- Add explorer workspace with gene search, metadata filters, expression preview,
  survival preview, and single-cell visual panel.
- Add dataset-aware chat panel with visible tool trace.
- Add admin/publish console skeleton for uploading manifests and files.
- Add API client with mock fallback for local development.
- Add Docker Compose service or static build path for deployment.

Acceptance:

- `npm run build` succeeds.
- Web can use live `/v1/catalog/datasets` when API is available.
- Web remains usable with mock data when API is unavailable.
- UI is dense, work-focused, and suitable for repeated scientific analysis.

## Phase 3: Multi-User and Project System

Goal: labs can manage private and public data safely.

Tasks:

- Add user, organization, project, membership, role, API token, and audit tables.
- Add auth middleware and current-user dependency.
- Replace single admin token with scoped API tokens while preserving admin token
  compatibility for local deployments.
- Add dataset owner and project ownership.
- Add visibility states: private, lab, link, public.
- Add route guards for dataset reads and writes.
- Add Web account/project switcher.
- Add admin pages for token creation and role assignment.

Acceptance:

- Public datasets are readable without login.
- Private datasets require membership.
- Curators can publish dataset versions.
- Viewers cannot mutate datasets.
- API tokens are scoped and revocable.

## Phase 4: R Client First-Class Workflow

Goal: professional analysts can work from R without downloading whole datasets.

Tasks:

- Stabilize `library(ShennongData)` exports.
- Add lazy select, filter, group, collect, and pagination helpers.
- Add `sn_query()`, `sn_collect()`, `sn_plot_box()`, `sn_plot_survival()`.
- Add single-cell helper functions for gene expression and metadata filters.
- Add admin publishing functions that require explicit token.
- Add vignettes for Toil, survival, and single-cell examples.
- Add CI check for R CMD check.

Acceptance:

- `sn_load_data()` never downloads full data by default.
- Tidyverse-style expression queries work against deployed API.
- Plot helpers retrieve only needed rows.
- Admin helpers cannot run without a token.

## Phase 5: Agent Tools v1

Goal: agent answers are grounded in dataset tools.

Tasks:

- Finalize JSON schema tools for catalog, expression, survival, single-cell, and
  eQTL.
- Add tool execution logs.
- Add dataset context pack for each dataset version.
- Add Web chat provider settings for OpenAI, Anthropic, and local endpoints.
- Add agent answer provenance panel.
- Add prompt templates for biological QA.
- Add deterministic non-LLM fallback mode for local development.

Acceptance:

- Agent can list datasets, inspect schema, query expression, query survival, and
  summarize results.
- Every answer shows tool calls and dataset version.
- Tool errors are shown as recoverable messages.

## Phase 6: Ingestion and Publishing Workflow

Goal: labs can publish their own dataset through CLI and Web.

Tasks:

- Define dataset manifest v1.
- Add manifest validation CLI.
- Extend upload staging beyond `/v1/ingest/upload/validate` into durable staged
  releases and cleanup policies.
- Add background ingestion job workers.
- Add ClickHouse loaders for expression, survival, and eQTL.
- Add SOMA/AnnData registration flow.
- Extend the initial `/v1/ingest/validate` modality checks beyond header/sample
  validation into deeper file statistics and worker dry-runs.
- Add Web publishing wizard.

Acceptance:

- A curator can upload or point to data, validate it, register it, and publish a
  version.
- Published datasets appear in catalog and are queryable.
- Failed ingestion jobs expose actionable validation errors.

## Phase 7: Analysis Engine

Goal: Shennong becomes a discovery platform, not just a query portal.

Tasks:

- Add differential expression jobs.
- Add survival association jobs.
- Add cell type abundance vs survival association.
- Add correlation and target prioritization workflows.
- Add pathway enrichment.
- Add cross-dataset validation.
- Store analysis artifacts and reproducible code.

Acceptance:

- Agent and Web can start analyses asynchronously.
- Results persist as artifacts.
- Results can be cited, downloaded, and reproduced.

## Deferred: Python Client

Python client starts after R and Web are stable.

Planned features:

- Lazy query object
- Pandas output
- AnnData output
- Async client
- Notebook helpers

## Immediate Next Sprint

1. Land Web app scaffold and build pipeline.
2. Add Web API client and dataset catalog against current `/v1/catalog`.
3. Add explorer workspace with Toil and pbmc3k examples.
4. Add agent chat UI with deterministic tool-call simulation.
5. Add PostgreSQL schema plan for users, projects, roles, tokens, jobs, and
   artifacts.
6. Add server-side auth design doc before implementing multi-user tables.
