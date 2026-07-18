# V1 production hardening and verification

Run the Rust quality gates from the repository root:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

## Headless production contract

The required V1 integration gate builds or uses a candidate image, starts an
isolated Compose project with temporary data, and verifies the headless service
boundary:

```bash
./scripts/test-headless-platform.sh
```

To test an already built candidate without rebuilding:

```bash
SHENNONG_TEST_IMAGE=shennong-db:ci \
  ./scripts/test-headless-platform.sh
```

The headless gate must cover service-key success and denial, the explicit
path/method allowlist, 404 responses for retired identity/Chat/Memory/provider
and legacy Project routes, Project-shadow idempotency, Resource/revision and
provenance operations, health/version readiness, restart persistence, and
cleanup of its isolated containers and volumes. It must never mount the live
`/srv/shennong.one/data/db` directory.

When Docker requires elevation, preserve only the named image variable rather
than the complete calling environment:

```bash
SHENNONG_TEST_IMAGE=shennong-db:ci \
COMPOSE_COMMAND='sudo --preserve-env=SHENNONG_TEST_IMAGE docker compose' \
DOCKER_COMMAND='sudo docker' \
  ./scripts/test-headless-platform.sh
```

## Legacy compatibility gate

The former application contract remains testable only as a rollback guard. It
is not a production acceptance substitute:

```bash
SHENNONG_TEST_DB_PROFILE=legacy \
SHENNONG_TEST_ALLOW_LEGACY_PROFILE=1 \
  ./scripts/test-platform.sh
```

Production must not set `SHENNONG_TEST_ALLOW_LEGACY_PROFILE` or enable the
legacy profile. The V1 image/default Compose path remains headless.

## Live unified-stack acceptance

After repository tests pass, verify the deployed private service through
Shennong OS:

- all trusted-stack containers are healthy and ShennongDB reports version
  `1.0.0`;
- unauthenticated direct data-plane calls fail while the OS service client
  succeeds;
- creating a Project in OS creates or repairs the idempotent DB shadow;
- Resource create/read/revision/provenance flows work through OS;
- a second user without Project membership cannot enumerate or mutate the
  first user's Project data;
- DB-local authentication, Chat, Memory, provider and legacy Project paths
  remain unavailable;
- restart persistence and a backup/restore drill succeed without exposing the
  service key.

Record command exit codes and non-secret response status/IDs. Do not include
cookies, bearer tokens, service keys, database URLs, or secret-file contents in
release artifacts.
