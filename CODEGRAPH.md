# CodeGraph

CodeGraph is initialized for this repository. Its local database lives in
`.codegraph/codegraph.db`; only `.codegraph/.gitignore` is committed because the
database is machine-specific and can always be rebuilt.

## Verify and refresh

Run from the repository root:

```bash
rtk codegraph status
rtk codegraph sync .
```

If status reports `Not initialized`, run `rtk codegraph init` before syncing.
Use `rtk codegraph index .` only when a full rebuild is needed. A healthy index
reports the current file, node, and edge counts and says `Index is up to date`.

## Fast navigation

Prefer graph queries before broad file reads:

```bash
rtk codegraph explore "headless catalog request flow"
rtk codegraph node list_resources
rtk codegraph callers list_resources
rtk codegraph impact list_resources
rtk codegraph affected crates/shennong-server/src/main.rs
rtk codegraph files --filter crates --max-depth 3
```

`explore` returns the relevant source plus caller/callee paths in one response;
`node --symbols-only` is the smallest useful view for a known file. This is the
main token-saving path for future repository work.

## Runtime graph

```text
Shennong OS (user auth + Project RBAC)
  -> private service-authenticated HTTP
  -> crates/shennong-server/src/main.rs
       -> headless path/method allowlist
       -> shennong-auth     service-key and compatibility auth primitives
       -> shennong-core     catalog, migrations, ingestion, graph, provenance
       -> shennong-schema   shared API and domain types
       -> shennong-storage  local and S3-compatible object storage
       -> shennong-query    bounded file, TileDB, and cache-backed queries
  -> PostgreSQL / SeaweedFS S3 / TileDB / ClickHouse cache
```

The CLI in `crates/shennong-cli` is a separate operator entry point over the
same domain and service boundaries. `crates/shennong-mcp` is a read-only HTTP
adapter. `webui/`, `web-archive/`, and `agent-runtime/` are migration or
rollback references and are not part of the production image.

## Repository boundaries

- `crates/` — authoritative Rust application source.
- `docker/`, `docker-compose*.yml`, `Dockerfile` — build and deployment wiring.
- `providers/`, `seed/`, `tests/fixtures/` — versioned input definitions and
  test data; these are not runtime output.
- `docs/architecture.md`, `README.md`, and `openapi/` — current design and API
  guidance; `docs/reference/architecture-spec.md` is historical.
- `webui/`, `web-archive/`, and `agent-runtime/` — retained compatibility and
  migration references; do not infer the production boundary from them.
- `data/`, `target/`, `webui/.next/`, `webui/dist/`, `webui/node_modules/`, caches,
  and `.codegraph/codegraph.db` — generated or machine-local; never treat these
  as source.

## Maintenance rule

After moving or deleting source files, run `rtk codegraph sync .`, inspect
`rtk codegraph status`, and use one representative `explore` or `node` query.
Commit the source and documentation changes, not the generated graph database.
