# WebUI API gaps

The WebUI uses the live Rust API for resources, artifacts, relations, providers, users, grants, audit events, authentication, personal tokens, and queries.

The following product surfaces remain adapter-backed until server contracts exist:

- usage aggregation and rate-limit history;
- multipart upload orchestration and ingestion progress;
- system settings and security-policy persistence;
- backup scheduling and restore jobs;
- monitoring time-series aggregation;
- collection CRUD and favorites;
- password reset, 2FA enrollment, recovery codes, sessions, and login history.

The WebUI does not infer permissions for these operations. Production mutations must return `not_supported` until the Rust API owns and enforces the corresponding contract.
