# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
