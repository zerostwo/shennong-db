# Changelog

## [Unreleased]

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

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

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
[Unreleased]: https://github.com/zerostwo/shennong-db/compare/v0.4.3...HEAD
