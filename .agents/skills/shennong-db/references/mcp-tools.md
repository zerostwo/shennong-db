# ShennongDB MCP reference

## Configuration

Build the versioned stdio server from the ShennongDB repository:

```bash
cargo build --release -p shennong-mcp
```

Configure the MCP client to run `target/release/shennong-mcp` with these environment variables:

| Variable | Required | Meaning |
|---|---:|---|
| `SHENNONG_URL` | No | ShennongDB Web/API base URL; defaults to `http://127.0.0.1:8000` |
| `SHENNONG_TOKEN` | No | Bearer token for private Resources and Projects |
| `SHENNONG_MCP_TIMEOUT_SECS` | No | Upstream request timeout; defaults to 30 seconds |

The server writes only MCP JSON-RPC to stdout. Keep diagnostic output off stdout.

## Tools

| Tool | Use | Important bounds |
|---|---|---|
| `discover_resources` | Inventory or text-search readable Resources | Search text is at most 256 characters |
| `inspect_resource` | Read readiness, dimensions, identifiers, artifacts, relations, and examples | Call before any query |
| `resolve_gene` | Coordinate symbols and Ensembl IDs across Resources | Query is at most 128 characters |
| `query_resource` | Run a declared read-only operation | 1 to 1,000 rows; exact declared context labels |
| `search_graph` | Find permission-filtered Research Graph entities | 1 to 100 results; optional Project scope |
| `get_project_context` | Read bounded Project studies, activities, entities, evidence, associations, and Resources | Requires Project access |

## Error handling

| Signal | Interpretation | Response |
|---|---|---|
| MCP invalid parameters | Local safety or schema violation | Correct the arguments; do not call the API repeatedly |
| HTTP 401 | Missing or invalid authentication | Ask for a properly scoped token without exposing its value |
| HTTP 403 | Authenticated but not authorized | Stop and report the permission boundary |
| HTTP 404 | Absent or intentionally undisclosed | Do not infer private-object existence |
| HTTP 422 | Unsupported operation, context, or identifier | Re-run discovery and inspection |
| HTTP 429 | Rate or concurrency limit | Wait, lower concurrency, and reduce request count |
| HTTP 5xx or timeout | Service/backend failure | Check `/healthz`; retry only bounded, idempotent reads |

## Reporting checklist

Include:

- ShennongDB instance or deployment context;
- Resource ID and title;
- organism, assay, data model, assembly, annotation release, and normalization when relevant;
- operation, exact context filters, feature identifier, and returned row count;
- Project scope and evidence identifiers for graph-backed claims;
- missing annotations, unsupported analyses, permission boundaries, and truncation.
