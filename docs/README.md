# Documentation

This index separates current operational documentation from historical design
material. Runtime behavior is defined by the checked-in code and
`openapi/shennongdb.json`; archived prompts are context, not instructions.

## V1 start here

- [Repository README](../README.md) — current headless boundary, API overview,
  standalone development, and verification.
- [Architecture and design contract](architecture.md) — current component and
  state ownership, effective API, data lifecycle, trust boundary, cross-service
  contracts, failure recovery, and non-goals.
- [Production topology](production-compose.md) — V1 headless service boundary,
  unified-stack ownership, persistence, and rollback inputs.
- [Production hardening](production-hardening.md) — regression baseline and
  headless/legacy compatibility verification commands.
- [OpenAPI contract](../openapi/shennongdb.json) — V1 internal data-plane API.

Shennong OS owns the production WebUI, identity, Project RBAC, Chat, Memory,
providers, and Skills. The following documents are migration references for the
retired 0.8 standalone product and are not V1 deployment instructions:

- [Legacy product core](product-core.md)
- [Legacy 0.8 user guide](guide.md)
- [Legacy WebUI source](../webui/README.md)
- [Legacy Pi runtime source](../agent-runtime/README.md)
- [Archived v0.6.0 WebUI](../web-archive/README.md) — frozen,
  excluded from builds, and retained only for historical reference.
- [Legacy WebUI API boundaries](web-api-boundaries.md)

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

- [Historical architecture specification](reference/architecture-spec.md) —
  v0.1 rewrite target; not a current API or deployment contract.
- [TileDB backend ADR](adr/0002-tiledb-backend.md)
- [WebUI visual QA](screenshots/webui/README.md)

## Archive

- [Unreleased 0.7.0 and 0.8.0 milestones](archive/development-milestones.md) —
  historical standalone-product work, never published as SemVer releases.
- [Production hardening implementation prompt](archive/CODEX_PRODUCTION_HARDENING_PROMPT.md)
- [WebUI implementation brief](archive/SHENNONGDB_WEBUI_BUILD_PROMPT.md)

Archived documents preserve project history. Do not use their task lists as
current work instructions without first validating them against the code,
changelog, and current API contract.
