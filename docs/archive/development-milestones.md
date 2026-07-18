# Unreleased 0.7.0 and 0.8.0 development milestones

These snapshots were never published as releases. They are retained to
preserve development history and are not part of the SemVer release sequence.
Their WebUI, identity, Chat, Memory, and Pi runtime design was superseded by the
headless ShennongDB V1 boundary described in `docs/architecture.md`.

## 0.8.0 - 2026-07-15

### Added

- Added the bundled Pi Agent runtime as a loopback-only all-in-one service. It
  received ephemeral provider credentials from the Rust authorization boundary,
  exposed no host port, had no shell or file-system tools, and sent governed
  data operations back through ShennongDB.
- Added provider connection discovery for DeepSeek, OpenAI, Ollama, and
  OpenAI-compatible endpoints.
- Added persisted reasoning content, aggregate token usage, reasoning-effort
  controls, and rendered GitHub-flavored Markdown in Chat.
- Added built-in, user-authored, and generated Agent Skills with immutable
  revisions and explicit per-thread activation.
- Added per-user global Memory and Project-scoped Memory with immutable
  revisions, plus Project-bound Chat context.
- Added a governed `compare_expression` tool with exact gene resolution,
  descriptive summaries, citations, and an explicit no-significance-test
  boundary.
- Added optional systemd socket-proxy units for a loopback-only host Ollama
  service.

### Changed

- Routed Agent model execution through the Pi SDK runtime while the Rust service
  retained authorization, tool budgets, writes, and audit ownership.
- Expanded governed tools with declared operations, exact feature identifiers,
  retained diagnostic events, and bounded final-answer recovery.
- Opened Settings through hash routes while preserving the active workspace.
- Treated Resources as the public database layer and Projects as the isolated
  research layer.

### Fixed

- Fixed the YTHDF2 colon-cancer path that could exhaust the Agent step limit.
- Preserved DeepSeek reasoning across tool rounds and aggregated token usage.
- Restricted Ollama discovery and exposed actual tool/thinking capabilities.
- Isolated Pi from administrator, JWT, database, object-storage, and encryption
  secrets through short-lived, replay-resistant run capabilities.
- Failed closed after ambiguous write-enabled Pi transport failures and pinned
  provider connections to freshly validated public addresses.
- Locked tools during final-answer recovery and removed residual tool markup.

## 0.7.0 - 2026-07-15

### Added

- Added an Agent-first WebUI with persistent conversations, Search, Resources,
  Projects, My Data, Settings, and administrator User Management.
- Added controlled ordinary-user registration and sign-in/2FA flows.
- Added encrypted per-user model connections with discovery and limits.
- Added permission-checked Agent discovery, query, upload, and provider tools.
- Added PostgreSQL-backed chat, tool-event, provider, and upload-staging records.

### Changed

- Made Agent Chat the default product screen and renamed catalog navigation to
  Resources.
- Archived the v0.6.0 WebUI and moved the active app to `webui`.
- Reduced standalone deployment configuration and generated runtime secrets in
  the persistent data volume.
- Limited uploads to metadata/raw registration rather than model-directed
  scientific normalization or arbitrary downloads.

### Fixed

- Prevented private Resource metadata and attachments from reaching external
  models without explicit user opt-in.
- Restricted local Ollama, rejected unsafe provider addresses, redacted tool
  results, and separated Agent timeouts from ordinary request timeouts.
- Kept anonymous Search public-only and prevented registration from creating
  privileged roles.
