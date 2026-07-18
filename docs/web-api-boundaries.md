# Legacy 0.8 WebUI API boundaries

> Migration reference only. Shennong OS owns the V1 browser/BFF boundary;
> ShennongDB exposes only the authenticated headless data-plane allowlist.

The production WebUI has no runtime mock or fallback data path. The Rust API owns resources, artifacts, relations, providers, users, grants, audit events, authentication, personal tokens, uploads, collections, favorites, usage, settings, backups, sessions, login history, and queries.

Durable product state is stored in PostgreSQL. Uploaded objects and metadata backups are streamed to the configured local or S3-compatible object store. Usage and monitoring views are aggregated from request events recorded by middleware. Security settings enforce session lifetime, password length, and administrator 2FA policy; retention settings delete expired audit, usage, and login records.

Password reset delivery requires `SHENNONG_PASSWORD_RESET_WEBHOOK_URL`. `SHENNONG_PASSWORD_RESET_EXPOSE_TOKEN` exists only for isolated development and integration testing and must not be enabled in production.

Current explicit boundary: metadata backup and restore cover Resource, Artifact, and Relation catalog records. Full object-payload backup is rejected instead of being represented as successful.
