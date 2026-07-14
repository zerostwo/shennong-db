# MCP and agent Skill installation

ShennongDB provides a read-only Model Context Protocol server and a versioned
Codex Skill. The MCP server supplies live tools; the Skill teaches the agent how
to select Resources, validate analysis readiness, preserve gene-identifier
provenance, and report bounded results safely.

The integration never connects directly to PostgreSQL, ClickHouse, TileDB, or
object storage. It calls the normal permission-filtered HTTP API.

## 1. Prerequisites

Verify the target ShennongDB instance first:

```bash
curl -fsS http://127.0.0.1:18080/healthz
curl -fsS http://127.0.0.1:18080/.well-known/shennong-agent.json | jq
```

Public Resource discovery works without a token. Private Resources and Projects
require a personal access token with the necessary Resource grant and scopes.
Create one in **Console → API access** and store it in a secret manager or the
parent process environment.

## 2. Install the MCP executable

From a source checkout with a current Rust toolchain:

```bash
cd /absolute/path/to/shennong-db
cargo install --path crates/shennong-mcp --locked
command -v shennong-mcp
```

This installs the executable under Cargo's binary directory, normally
`$HOME/.cargo/bin/shennong-mcp`. To keep it inside the checkout instead:

```bash
cargo build --release -p shennong-mcp
```

The executable is then `target/release/shennong-mcp`. Release container images
also contain `/usr/local/bin/shennong-mcp`, which is useful for container-based
smoke tests; a locally installed executable is simpler for desktop MCP clients.

The MCP process accepts:

| Variable | Default | Purpose |
|---|---|---|
| `SHENNONG_URL` | `http://127.0.0.1:8000` | ShennongDB Web/API base URL |
| `SHENNONG_TOKEN` | unset | Bearer token for private Resources and Projects |
| `SHENNONG_MCP_TIMEOUT_SECS` | `30` | Upstream request timeout in seconds |

`shennong-mcp` is a stdio server. An MCP client must spawn it and keep stdin
and stdout attached; launching it in a terminal appears to wait silently because
it is waiting for JSON-RPC messages.

## 3. Add the MCP server to Codex

Codex CLI, the IDE extension, and the desktop app share MCP configuration. Add
a public/local instance from the command line:

```bash
codex mcp add shennong-db \
  --env SHENNONG_URL=http://127.0.0.1:18080 \
  -- "$HOME/.cargo/bin/shennong-mcp"
codex mcp list
```

For private access, prefer inheriting the token from the environment instead of
writing its value into a command or checked-in file:

```bash
export SHENNONG_TOKEN='<personal-access-token>'
```

Then configure `~/.codex/config.toml` for a user-wide installation, or
`.codex/config.toml` in a trusted repository for project-only use:

```toml
[mcp_servers.shennong-db]
command = "/home/USER/.cargo/bin/shennong-mcp"
startup_timeout_sec = 10
tool_timeout_sec = 60
required = true
env_vars = ["SHENNONG_TOKEN"]

[mcp_servers.shennong-db.env]
SHENNONG_URL = "http://127.0.0.1:18080"
SHENNONG_MCP_TIMEOUT_SECS = "30"
```

Use an absolute executable path. If the server is optional for a repository,
set `required = false`. After configuration, restart the Codex app or extension,
open the `/mcp` command, and confirm that `shennong-db` is connected with six
tools.

For an MCP client that uses JSON configuration rather than TOML:

```json
{
  "mcpServers": {
    "shennong-db": {
      "command": "/home/USER/.cargo/bin/shennong-mcp",
      "env": {
        "SHENNONG_URL": "http://127.0.0.1:18080"
      }
    }
  }
}
```

Add the token with that client's protected environment or secret mechanism.
Never commit it in JSON or TOML.

## 4. Install the Codex Skill

The repository copy is located at:

```text
.agents/skills/shennong-db/
├── SKILL.md
├── agents/openai.yaml
└── references/mcp-tools.md
```

When Codex is opened in this repository, it automatically discovers the Skill;
no copy is required. To make it available in every repository for the current
user:

```bash
mkdir -p "$HOME/.agents/skills"
cp -R .agents/skills/shennong-db "$HOME/.agents/skills/"
```

To track updates from a source checkout, a symlink is also acceptable:

```bash
mkdir -p "$HOME/.agents/skills"
ln -s /absolute/path/to/shennong-db/.agents/skills/shennong-db \
  "$HOME/.agents/skills/shennong-db"
```

Restart Codex after installing or updating a Skill. Use `/skills` to inspect
available Skills, or explicitly invoke this one with `$shennong-db`. Codex may
also select it automatically when a request matches its description.

## 5. Verify MCP and Skill together

In Codex, confirm the MCP connection with `/mcp`, then try:

```text
Use $shennong-db to list the readable Resources. For each candidate, report
organism, assay, analysis-ready operations, and missing annotations. Do not run
a query yet.
```

Then run a bounded query:

```text
Use $shennong-db to resolve YTHDF2 across toil and pbmc-3k, inspect both
Resources, and query no more than 20 rows from each only if expression analysis
is declared ready. Preserve the annotation release and original feature IDs.
```

For a Project:

```text
Use $shennong-db to load the Context Pack for project melanoma-targets, search
its Research Graph for YTHDF2, and distinguish recorded evidence from proposed
hypotheses. Report any truncation or access boundary.
```

A correct run begins with discovery and inspection, uses exact declared context
labels, stays within the requested limit, and reports Resource IDs, identifier
mapping, filters, provenance, missing inputs, and truncation.

## 6. Available tools

| Tool | Purpose | Bound |
|---|---|---|
| `discover_resources` | List or text-search readable Resources | search text up to 256 characters |
| `inspect_resource` | Read dimensions, identifiers, readiness, Artifacts, relations, and examples | call before querying |
| `resolve_gene` | Coordinate symbols and Ensembl IDs across Resources | query up to 128 characters |
| `query_resource` | Execute a declared read-only Resource operation | 1 to 1,000 rows |
| `search_graph` | Search permission-filtered Research Graph entities | 1 to 100 results |
| `get_project_context` | Read a bounded Project Context Pack | Project access required |

The server deliberately exposes no administration, provider installation,
upload, grant, token, settings, backup, or mutation tool.

## 7. Troubleshooting

| Symptom | Resolution |
|---|---|
| Server exits during startup | Run the absolute executable path and check `SHENNONG_MCP_TIMEOUT_SECS` is numeric |
| `/mcp` shows disconnected | Restart Codex, verify the path, and run `codex mcp list` |
| Tools return connection errors | Check `SHENNONG_URL` and the instance `/healthz` endpoint |
| `401` | Supply an active personal token through the MCP environment |
| `403` | Add the required scope or Resource/Project grant; do not broaden credentials silently |
| `404` | The object is absent or intentionally undisclosed; do not infer private existence |
| `422` | Re-run discovery and inspection, then use declared operations and exact labels |
| `429` | Wait, lower concurrency, and reduce calls; do not split requests to bypass limits |
| Tool output is truncated or capped | Narrow the query and report the cap; do not loop to evade it |

For protocol-level checks, run the MCP Inspector against the local executable.
The server must identify itself as `shennong-mcp`, list six tools, and return the
live instance catalog from `discover_resources`.

The implementation uses the [official Rust MCP SDK](https://github.com/modelcontextprotocol/rust-sdk).
Codex discovery and configuration follow the current
[Codex Skills guide](https://learn.chatgpt.com/docs/build-skills.md) and
[Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp.md). General MCP
transport behavior is documented in the
[official MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server).
