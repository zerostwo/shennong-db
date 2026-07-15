# CodeGraph

CodeGraph is initialized for this repository. Its local database lives in
`.codegraph/codegraph.db`; only `.codegraph/.gitignore` is committed because the
database is machine-specific and can always be rebuilt.

## Verify and refresh

Run from the repository root:

```bash
codegraph status .
codegraph sync .
```

Use `codegraph index .` only when a full rebuild is needed. A healthy index
reports the current file, node, and edge counts and says `Index is up to date`.

## Fast navigation

Prefer graph queries before broad file reads:

```bash
codegraph explore -p . "catalog resources live API"
codegraph node -p . listResources
codegraph callers -p . listResources
codegraph impact -p . listResources
codegraph affected -p . webui/lib/api/adapter.ts
codegraph files -p . --filter crates --max-depth 3
```

`explore` returns the relevant source plus caller/callee paths in one response;
`node --symbols-only` is the smallest useful view for a known file. This is the
main token-saving path for future repository work.

## Runtime graph

```text
Browser
  -> webui/app + webui/components
  -> webui/lib/api/adapter.ts
  -> webui/app/api/v1/[...path]/route.ts
  -> crates/shennong-server/src/main.rs
       -> shennong-auth     authentication and token primitives
       -> shennong-core     metadata, migrations, and product persistence
       -> shennong-schema   shared API and domain types
       -> shennong-storage  local and S3-compatible object storage
       -> shennong-query    bounded data-query execution
  -> PostgreSQL / object storage / TileDB / ClickHouse cache
```

The CLI in `crates/shennong-cli` is a separate operator entry point over the
same domain and service boundaries.

## Repository boundaries

- `crates/` — authoritative Rust application source.
- `webui/app`, `webui/components`, `webui/features`, `webui/lib` — authoritative WebUI
  source. There is no second Vite application tree.
- `docker/`, `docker-compose*.yml`, `Dockerfile` — build and deployment wiring.
- `providers/`, `seed/`, `tests/fixtures/` — versioned input definitions and
  test data; these are not runtime output.
- `docs/` and `openapi/` — human guidance, design history, evidence, and the API
  contract.
- `data/`, `target/`, `webui/.next/`, `webui/dist/`, `webui/node_modules/`, caches,
  and `.codegraph/codegraph.db` — generated or machine-local; never treat these
  as source.

## Maintenance rule

After moving or deleting source files, run `codegraph sync .`, inspect
`codegraph status .`, and use one representative `explore` or `node` query.
Commit the source and documentation changes, not the generated graph database.
