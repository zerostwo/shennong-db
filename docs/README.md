# Documentation

This index separates current operational documentation from historical design
material. Runtime behavior is defined by the checked-in code and
`openapi/shennongdb.json`; archived prompts are context, not instructions.

## Start here

- [Complete user guide](guide.md) — installation, first-run setup, WebUI, API,
  data access, Projects, administration, and troubleshooting.
- [Production topology](production-compose.md) — container and persistence
  boundaries.
- [Production hardening](production-hardening.md) — regression baseline and
  verification commands.
- [WebUI](../web/README.md) — active Next.js application and frontend checks.
- [WebUI API boundaries](web-api-boundaries.md) — persisted product surfaces
  and the explicit backup boundary.

## Storage and data

- [S3-compatible storage](s3-storage.md)
- [Artifact lifecycle](storage-lifecycle.md)
- [Backup and recovery](backup-recovery.md)
- [ClickHouse cache lifecycle](clickhouse-cache.md)
- [Gene identifiers](gene-identifiers.md)
- [Performance and analysis readiness](performance.md)
- [Benchmark results and performance plan](benchmark-results.md)
- [Agent integrations: MCP and Skill](agent-integrations.md) — Codex and generic
  MCP installation, verification, prompts, and troubleshooting.
- [Resource providers](../providers/README.md)

## Design records and evidence

- [Architecture specification](reference/architecture-spec.md) — historical
  v0.1 rewrite target; not a current API contract.
- [TileDB backend ADR](adr/0002-tiledb-backend.md)
- [WebUI visual QA](screenshots/webui/README.md)
- [OpenAPI contract](../openapi/shennongdb.json)

## Archive

- [Production hardening implementation prompt](archive/CODEX_PRODUCTION_HARDENING_PROMPT.md)
- [WebUI implementation brief](archive/SHENNONGDB_WEBUI_BUILD_PROMPT.md)

Archived documents preserve project history. Do not use their task lists as
current work instructions without first validating them against the code,
changelog, and current API contract.
