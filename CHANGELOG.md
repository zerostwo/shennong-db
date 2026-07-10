# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Removed
- Removed legacy compatibility routes for typed queries, dataset registry, and tool calls; use `/v1/query`, `/v1/ingest`, and `/v1/agent/*`.

### Added
- 待记录：新功能和接口变更会在此预先登记，待发布时移入新版本。

## [0.1.0] - 2026-07-09

### Added
- Implemented core FastAPI service entrypoint and API lifecycle routes.
- Added dataset registry and dataset/version management endpoints.
- Added ingestion validation and dataset registration flows, including upload validation.
- Added semantic query API:
  - `POST /query`
  - `POST /compute`
  - async job/ artifact endpoints (`/jobs`, `/artifacts`)
- Added catalog metadata APIs for dataset schema, capabilities, fields, and field values.
- Added legacy compatibility query routes (`/expression/query`, `/survival/query`, `/singlecell/query`, `/spatial/query`, `/eqtl/query`) and `/datasets`.
- Added AI-agent tools route set (`/agent`, `/tools`).
- Added cursor-based bounded pagination for query responses.
- Added Redis-backed cache path for expression-style queries.
- Added admin APIs for bootstrap, access management, and audit logs.
- Added R client package scaffold under `clients/r/ShennongData`.
- Added initial pytest API suite in `tests/test_api.py`.
- Added deployment and service bootstrap assets (`Dockerfile`, `docker-compose.yml`, docs).

### Changed
- Normalized API surface to the SPEC-v2 semantic structure while keeping legacy compatibility.
- Upgraded response shape conventions to include `status` and `meta` envelopes for query-like flows.

### Fixed
- Baseline stabilization of dataset/route wiring, registry validation checks, and bounded response behavior.

[Unreleased]: https://github.com/zerostwo/shennong-db/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zerostwo/shennong-db/releases/tag/v0.1.0
