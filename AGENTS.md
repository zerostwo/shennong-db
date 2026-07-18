# Repository agent guide

This repository is the Shennong V1 biomedical data plane. Work from the
current checkout, preserve user changes, and treat code plus tests as the source
of truth when documentation and implementation differ.

## Shell and CodeGraph first

- Prefix shell commands with `rtk` in this workspace.
- A tracked `.codegraph/.gitignore` means the repository is CodeGraph-enabled.
  Run `rtk codegraph status` first. If the worktree has not been initialized,
  run `rtk codegraph init`, then `rtk codegraph index .`.
- Use `rtk codegraph explore "<question or symbols>"` before `rg`, broad file
  listing, or manual source reads when locating or understanding code.
- After source moves or meaningful edits, run `rtk codegraph sync .`, inspect
  `rtk codegraph status`, and repeat one representative exploration.
- Never commit `.codegraph/codegraph.db`, WAL/SHM files, sockets, logs, or daemon
  state. Only `.codegraph/.gitignore` is versioned.

## Current architecture invariants

- `SHENNONG_DB_PROFILE=headless` is the V1 production default. The effective
  API is the intersection of the Axum router and `headless_endpoint_allowed`.
- Shennong OS owns the WebUI, users, sessions, Project membership/RBAC, Chat,
  Memory, model providers, Agent Skills, and orchestration. DB Research Projects
  are opaque graph/provenance shadows, never an authorization source.
- Shennong Runtime owns isolated jobs and IDE execution. DB must not gain a
  Docker socket, shell, arbitrary-code path, Runtime control secret, arbitrary
  image, or host-mount contract.
- The production image contains the Rust API/CLI/MCP plus bundled data engines;
  it does not build or start `webui/` or `agent-runtime/`. Those trees and
  `web-archive/` are migration/rollback references.
- All headless data API calls require the dedicated DB service key. Browser
  cookies and user tokens are not the service boundary. Production secrets are
  at least 32 bytes and must not appear in Git, logs, fixtures, or commands.
- Resource revisions are append-only linear chains. Raw immutable Artifact
  content, checksums, lineage, schema, and provenance must remain fail-closed.
- PostgreSQL metadata and BlobStore raw/canonical bytes are authoritative.
  TileDB is derived state; ClickHouse is a replaceable cache and must never
  become the only query source.
- `/data` is the DB persistence boundary. Do not delete, rewrite, migrate, or
  restore real data as a side effect of tests or documentation work.

## Repository map

- `crates/shennong-server` — Axum API, headless gate, request policy, uploads,
  query and download handlers.
- `crates/shennong-core` — PostgreSQL repository, migrations, provider
  ingestion, Research Graph, and provenance.
- `crates/shennong-schema` — shared domain/API types.
- `crates/shennong-storage` — local and S3-compatible BlobStore backends.
- `crates/shennong-query` — bounded file, TileDB, and cache-aware queries.
- `crates/shennong-auth`, `shennong-cli`, `shennong-mcp` — authentication
  primitives, operator tooling, and the read-only MCP adapter.
- `docker/`, `Dockerfile`, `docker-compose*.yml` — image and deployment wiring.
- `providers/`, `seed/`, `tests/fixtures/` — versioned definitions and fixtures,
  never runtime output.
- `README.md`, `docs/architecture.md`, `docs/README.md`, and `openapi/` — current
  reader-facing design/API material. Historical docs must say they are
  historical at the top.

## Change discipline

- Inspect the working tree before editing. Do not overwrite unrelated or
  uncommitted work from another agent or the user.
- Database migrations are append-only. Never edit an applied migration; add a
  new numbered migration with forward and recovery reasoning.
- Keep router, headless allowlist, OpenAPI, security tests, README endpoint
  summaries, and `docs/architecture.md` consistent in the same change.
- Boundary changes require a threat-model note, explicit OS/Runtime contract,
  state ownership, failure/recovery behavior, migration/rollback plan, and
  positive plus negative headless tests.
- Keep generated outputs (`target/`, `.next/`, data directories, caches,
  CodeGraph DB) out of commits.

## Documentation and changelog

- README architecture diagrams use portable Mermaid syntax and must show the
  OS authorization boundary, private service credential, authoritative stores,
  replaceable cache, and absence of direct browser/Runtime control access.
- Detailed design belongs in `docs/architecture.md`; link it from both README
  files. Mark compatibility and historical material explicitly.
- `CHANGELOG.md` follows Keep a Changelog 1.1.0 and Semantic Versioning. Add
  user-visible changes under `[Unreleased]` using only `Added`, `Changed`,
  `Deprecated`, `Removed`, `Fixed`, or `Security`; do not invent a release date
  or describe uncommitted functionality as released.
- Release links use GitHub compare URLs between SemVer tags; `[Unreleased]`
  compares the latest tag with `HEAD`.

## Validation

For documentation-only work, at minimum run:

```bash
rtk codegraph sync .
rtk codegraph status
rtk git diff --check
rtk docker compose config --quiet
```

For Rust, API, storage, security, or deployment changes, also run:

```bash
rtk cargo fmt --all --check
rtk cargo clippy --workspace --all-targets -- -D warnings
rtk cargo test --workspace
rtk ./scripts/test-headless-platform.sh
```

Run legacy compatibility coverage only when the change intentionally touches
that surface:

```bash
rtk env SHENNONG_TEST_DB_PROFILE=legacy \
  SHENNONG_TEST_ALLOW_LEGACY_PROFILE=1 \
  ./scripts/test-platform.sh
```

Report commands actually run, skipped checks, and any environment-dependent
failure. Never claim a live deployment or restore was verified from static
configuration alone.
