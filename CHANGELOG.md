# Changelog

All notable changes to this project are documented in this file. This project
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.7.0] - 2026-07-15

### Added

- Add an Agent-first ChatGPT-style WebUI with persistent conversations, centered workspace Search, Resources, Projects, My Data, Settings, and a five-destination administrator center with first-class User Management.
- Add ordinary user registration controlled by the instance registration policy while retaining first-run administrator setup and existing sign-in and 2FA flows.
- Add encrypted per-user OpenAI, DeepSeek, Ollama, and OpenAI-compatible model connections with connection testing, model discovery, rate limits, concurrency limits, and an explicit public-only or private-data policy.
- Add permission-checked Agent tools for Resource discovery, inspection, bounded queries, gene resolution, citations, uploaded-file metadata inspection, private raw Resource registration, and administrator-approved curated Provider installation.
- Add PostgreSQL-backed chat threads, messages, tool events, model-provider records, and a durable upload staging area.

### Changed

- Make Agent Chat the default product screen and rename the catalog-facing navigation to Resources while preserving the existing governed Resource and Project workflows.
- Archive the exact v0.6.0 WebUI under `web-archive/v0.6.0` and move the active application to the independent `webui` source tree.
- Reduce the normal deployment configuration to the image, data path, bind address, port, and optional outbound proxy; generate runtime secrets inside the persistent data volume on first start.
- Treat uploaded Agent attachments as metadata-and-raw-registration inputs only; scientific normalization and arbitrary model-directed downloads remain outside this release boundary.

### Fixed

- Prevent private Resource metadata and attachments from reaching external models unless the user explicitly enables private-data access for that model connection.
- Restrict local Ollama connections to the expected local endpoint, reject unsafe remote provider addresses, redact sensitive tool-result fields, and keep Agent runs outside the short ordinary-request timeout.
- Keep anonymous Search limited to public Resources and prevent ordinary registration from creating privileged roles.

## [0.6.0] - 2026-07-15

### Added

- Add a PostgreSQL-backed Research Graph/BioGraph for Projects, Studies, typed Entities, Activities with explicit inputs, outputs, and actors, immutable Resource revisions, scoped Associations, Evidence, and Resource bindings.
- Add permission-filtered Project, Graph, and Context Pack APIs with bounded four-level Agent discovery across catalog, graph, evidence, and project context.
- Add live WebUI Projects, project-bound uploads, structured Observation capture with Activity I/O, and an evidence-aware BioGraph explorer.
- Add reproducible HTTP concurrency, data-access, and browser performance benchmarks with raw results and production/publication measurement guidance.
- Add a read-only Rust MCP server and versioned ShennongDB skill for agent Resource discovery, gene resolution, bounded queries, Project Context Packs, and Research Graph search.
- Add a complete current user guide covering first-run setup, WebUI workflows, authentication, data access, uploads, Projects, administration, recovery, and troubleshooting.
- Add a README architecture diagram covering the public gateway, Rust application layers, agent and operator entry points, query engines, and persistent data paths.
- Add a Docker Hub-specific README and an automated description-sync workflow so the image page always includes tags, deployment, persistence, health-check, and supply-chain guidance.

### Changed

- Organize repository navigation around a CodeGraph index and dependency-aware source map.
- Group current guides, architecture references, and completed implementation prompts under a documentation index.
- Replace the obsolete Vite application scaffold with a focused Vitest configuration for the active Next.js WebUI.
- Align default and production Compose configuration with the all-in-one image, port `18080`, `.env` substitution, and the optional standalone WebUI development profile.
- Replace obsolete multi-service production and backup instructions with the current single-volume topology and a consistent full-data restore workflow.
- Move the ShennongDB Skill to `.agents/skills/shennong-db` for repository-level Codex discovery and document current Codex MCP/Skill installation and use.
- Generate Docker image tags and OCI labels with Docker Metadata Action: stable releases now publish `MAJOR.MINOR.PATCH`, `latest`, `stable`, and immutable `sha-COMMIT` tags from the same digest.
- Strip debug and symbol tables from bundled ClickHouse, SeaweedFS, Node.js, and ShennongDB runtime binaries in a disposable build stage to reduce the final image without removing runtime features.

### Fixed

- Proxy `/metrics` and `/version` through the public WebUI gateway so the documented all-in-one endpoint exposes monitoring and release metadata.
- Raise the `rmcp` dependency floor to `1.4.0` and refresh the lockfile to a patched 1.x release, resolving the high-severity `RUSTSEC-2026-0189` DNS rebinding advisory reported by `cargo audit`.
- Validate semantic-version release tags and verify every expected Docker Hub tag after publishing, preventing manual-dispatch ref names or incomplete tag sets from masquerading as successful releases.

### Removed

- Remove the unreferenced `web/src` component duplicate, Vite entry page, and Vite-only development dependencies.

## [0.5.2] - 2026-07-12

### Fixed

- Preserve administrator settings panels while live data refreshes so successful saves retain visible confirmation instead of briefly unmounting the UI.
- Wait for the persisted personal-token inventory before browser mutation assertions, eliminating races with the initial authenticated API load.

## [0.5.1] - 2026-07-12

### Fixed

- Keep revocable browser sessions out of personal and administrator API-token inventories while preserving shared revocation enforcement.
- Align live-browser sign-in and mutation checks with the real authenticated choice screen and verify reversible favorites, collections, tokens, settings, and backups.

## [0.5.0] - 2026-07-12

### Added

- Add PostgreSQL-backed collections, favorites, uploads, user preferences, settings, metadata backups, login history, revocable web sessions, password resets, TOTP enrollment, recovery codes, and request-usage events.
- Add permission-checked Rust APIs for every WebUI product surface, streaming uploads with SHA-256 verification, atomic upload-to-Resource registration, real monitoring aggregates, and object-storage metadata backup/restore with a pre-restore safety snapshot.
- Add live public instance configuration and capabilities views for the Support and Docs pages.

### Changed

- Drive Catalog, resource details, API access, usage, uploads, ingestion, account security, administrator tables, monitoring, storage, settings, and backups exclusively from persisted API records.
- Enforce persisted session lifetime, password length, administrator 2FA, public-catalog, storage-prefix, and retention settings in the Rust service.
- Record successful and failed authentication, request latency, response bytes, errors, rate limiting, and per-resource traffic for real dashboards.

### Removed

- Remove the MSW dependency and worker, demo roles, runtime fallback resources, hard-coded notifications, fabricated metrics, fake table mutations, and the complete WebUI mock dataset.

## [0.4.3] - 2026-07-12

### Fixed

- Decode source text metadata lossily so isolated non-UTF-8 bytes in the verified UCSC Toil phenotype file do not break context-filtered and survival queries.

## [0.4.2] - 2026-07-12

### Fixed

- Verify the complete Toil expression archive with its measured SHA-256 checksum instead of requiring the unverified-provider compatibility switch.
- Give synchronous Provider installation its own four-hour timeout while retaining the short default timeout for ordinary API requests.

## [0.4.1] - 2026-07-12

### Fixed

- Fill every non-final S3 multipart upload part across fragmented async reads so SeaweedFS accepts large Provider Artifacts.

## [0.4.0] - 2026-07-12

### Added

- Add the complete Next.js WebUI for the public catalog, role-aware user console, six-step uploads, API tokens and usage, authentication, and administrator operations.
- Add browser and Node MSW contracts, Vitest component coverage, desktop/mobile Playwright flows, OpenAPI documentation, and committed visual QA references.
- Add a standalone non-root WebUI image and hardened two-service Compose deployment.

### Changed

- Route browser API traffic through a bounded BFF with HttpOnly session authentication, explicit security headers, strict role-aware middleware, and private-resource non-disclosure.
- Replace static placeholder controls and charts with stateful dialogs, drawers, forms, tables, URL filters, ECharts, and destructive confirmations.

### Fixed

- Prevent mobile table and full-screen Drawer overflow, keep Drawer close controls reachable, and preserve catalog filters when opening or closing a Resource.

## [0.3.0] - 2026-07-12

### Added

- Serve the Next.js Web UI from the all-in-one image, including first-run administrator setup and provider installation controls.
- Bundle SeaweedFS in the ShennongDB image and start it with PostgreSQL and ClickHouse.
- Persist generated first-run admin and JWT secrets under `/data/.shennong-secrets`.

### Changed

- Use pure S3 provider storage and a single `/data` mount with service-specific subdirectories.
- Reduce the default and production Compose deployments to one service with one bind mount.
- Publish release images with an additional `latest` tag.

### Fixed

- Replace WebUI catalog and token mock data with live API calls, expose authentication, and make sidebar navigation collapsible and route-aware.
- Include endpoint ports in S3 signatures and remove provider staging data after publication.
- Fetch full Git history for the GitHub Actions secret scan so gitleaks can resolve push ranges.

## [0.2.0] - 2026-07-11

### Added

- Streaming S3-compatible storage with Range GET, multipart upload, presigning,
  SeaweedFS profile, and immutable production release workflows.
- Artifact lifecycle metadata, content-addressed raw objects, lineage, bounded
  ClickHouse cache controls, persistent TileDB worker, and backup/restore tools.
- Revocable scoped tokens, secret-file loading, key rotation, Prometheus cache
  metrics, production service separation, SBOM, signing, and provenance checks.

## [0.1.0] - 2026-07-11

### Added

- Rust Resource, Artifact, Relation, access-grant, audit, provider, and query APIs.
- PostgreSQL metadata, local artifact storage, and Docker Hub publishing.
- Embedded TileDB sparse arrays and gene-expression queries for PBMC datasets.
- An internal ClickHouse cache for bulk Toil expression queries.
- Machine-readable agent discovery with dataset dimensions, fields, identifiers,
  operations, artifacts, and query examples.
- Administrator-managed users, roles, status, JWT issuance, and immediate access
  revocation for disabled users.
- Two-level agent discovery with a small Resource catalog and per-Resource
  analysis-readiness details.
- Standard Docker installation, API usage, and measured performance guides.
- A resumable multi-file UCSC Xena Toil provider with expression, phenotype,
  category, survival, and GENCODE v23 mapping Artifacts.
- Release-aware gene resolution using stable Ensembl gene IDs while preserving
  original versioned identifiers and annotation provenance.

### Changed

- Production deployment now uses one Docker image and one Compose service for
  the API, PostgreSQL, ClickHouse, and TileDB.
- Context filters now fail explicitly when required cohort, clinical, or
  cell-type annotations are unavailable.
- Toil expression queries can use installed phenotype filters and attach TCGA
  survival endpoints.

### Removed

- Removed the early Python/SQLite runtime, migration tooling, compatibility APIs,
  duplicate deployment files, and obsolete documentation.

[0.1.0]: https://github.com/zerostwo/shennong-db/releases/tag/v0.1.0
[0.2.0]: https://github.com/zerostwo/shennong-db/releases/tag/v0.2.0
[0.3.0]: https://github.com/zerostwo/shennong-db/releases/tag/v0.3.0
[0.4.0]: https://github.com/zerostwo/shennong-db/releases/tag/v0.4.0
[0.4.1]: https://github.com/zerostwo/shennong-db/releases/tag/v0.4.1
[0.4.2]: https://github.com/zerostwo/shennong-db/releases/tag/v0.4.2
[0.4.3]: https://github.com/zerostwo/shennong-db/releases/tag/v0.4.3
[0.5.0]: https://github.com/zerostwo/shennong-db/releases/tag/v0.5.0
[0.5.1]: https://github.com/zerostwo/shennong-db/releases/tag/v0.5.1
[0.5.2]: https://github.com/zerostwo/shennong-db/releases/tag/v0.5.2
[0.6.0]: https://github.com/zerostwo/shennong-db/releases/tag/v0.6.0
[0.7.0]: https://github.com/zerostwo/shennong-db/releases/tag/v0.7.0
[Unreleased]: https://github.com/zerostwo/shennong-db/compare/v0.7.0...HEAD
