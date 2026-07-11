# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-11

### Added

- Rust Resource, Artifact, Relation, access-grant, audit, provider, and query APIs.
- PostgreSQL metadata, local artifact storage, and Docker Hub publishing.

### Changed

- Production deployment now uses one Docker image and one Compose service.

### Removed

- Removed the early Python/SQLite runtime, migration tooling, compatibility APIs,
  duplicate deployment files, and obsolete documentation.

[0.1.0]: https://github.com/zerostwo/shennong-db/releases/tag/v0.1.0
