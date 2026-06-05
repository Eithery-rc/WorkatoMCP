# WorkatoMCP

A Chrome extension + local MCP bridge that exposes typed Workato recipe operations to AI agents (Claude Code, Claude Desktop, etc.) by piggybacking on the user's already-authenticated Workato browser session.

Forked from [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome) — see `README.upstream.md` for the parent project, and `LICENSE.upstream` for its MIT license.

## v1 tools (shipped)

Both are read-only and require an open Workato tab.

### `workato_pull_recipe`

```
input:  { recipe_id: number }
output: { recipe_id, code: <parsed flow tree>, version: { version_no, name, folder_id, ... } }
```

### `workato_job_trace`

```
input:  { recipe_id: number, job_id: string|number, full?: boolean }
output (default): { job_id, recipe, status, started_at, completed_at, duration_ms, error?, steps[], lines_truncated, kms_error }
output (full=true): { job_id, meta: <raw>, line_details: <raw> }
```

Per-step `input_summary` / `output_summary` are truncated to 500 chars. Pass `full: true` for the raw responses.

## v1.1 tools (shipped)

All four are read-only, all return a slim shape by default with `full: true` for raw, all require an open Workato tab.

### `workato_search_recipes`

```
input:  { text?, folder_id?, page?, sort?, full? }
output: { count, page, per_page: 20, recipes: [{ id, name, folder_id, project_id, running, state, last_run_at, job_succeeded_count, job_failed_count, trigger_application, trigger_business_object, action_applications }] }
```

Workato caps pagination at 20 items/page server-side. Step through with `page: N`.

### `workato_search_connections`

```
input:  { text?, folder_id?, page?, sort?, full? }
output: { count, page, per_page: 20, connections: [{ id, name, provider, folder_id, project_id, recipe_count, authorization_status, authorized_at, connection_lost_at, connection_lost_reason, updated_at }] }
```

`text=` matches connection NAMES, not the `provider` field. For "all my Salesforce connections" search by name pattern (e.g. "SFDC") or page through and filter client-side.

### `workato_get_connection`

```
input:  { connection_id, full? }
output: { id, name, provider, folder_id, project_id, recipe_count, authorization_status, authorized_at, connection_lost_at, connection_lost_reason, created_at, updated_at, config: <per-provider config with secret-shaped keys stripped> }
```

**Auth material is always stripped, including under `full: true`.** Agents that need a token must reuse the user's existing session (in-tab fetch via this MCP), not extract one from this tool.

### `workato_list_jobs`

```
input:  { recipe_id, limit?, status?, query?, started_at?, group_by_master_job?, cursor?, full? }
output: { total, scope, succeeded, failed, next_cursor?, jobs: [{ id, status, started_at, completed_at, duration_ms, error_summary?, error_line_number?, title, report: { col_0, col_1, col_2 } }] }
```

Tool auto-walks Workato's cursor pagination under the hood up to `limit` (default 25, max 100). For more results, pass `cursor: <prev next_cursor>`. Server-side filters: singular `status` (`failed`/`succeeded`/etc.), `query` (full-text against title and error), `started_at` window, `group_by_master_job`.

## v1.2 tools (shipped)

Two more read tools — and one **gated** universal action runner — that close the loop on agent-driven SaaS access via your Workato connections. No separate API tokens. Both require an open Workato tab.

### `workato_run_query`

```
input:  { connection_id, query, type: 'soql' | 'suiteql' | 'sql', schema_only?, full? }
output: { type, count, truncated_to_100, schema: [{ name, label, type, control_type }], rows?: [{...}] }
```

Runs a SQL-style query against any connection backed by an adapter that supports the chosen dialect. Returns a consistent `{schema, rows}` shape regardless of SaaS. **Hard-capped at ~100 rows server-side** — narrow via WHERE clause for more.

- **SOQL:** any trailing `LIMIT N` clause is automatically stripped before sending (Workato auto-appends `LIMIT 100`; user-supplied `LIMIT` would collide).
- **SuiteQL:** works against both NS REST and NS SOAP connections.
- **SQL:** depends on adapter — some support, some don't. Tool surfaces "Connector doesn't support SQL to schema" via `WorkatoConnectorError` if not.
- `schema_only: true` returns only field metadata, no rows.
- `full: true` returns the raw Workato `result` envelope.

### `workato_call_action`

```
input:  { connection_id, action_name, input, allow_writes?, full? }
output (slim): { action_name, result: <native SaaS response shape> }
output (full=true): the entire {result|error} envelope
```

**MOST POWERFUL TOOL IN THE KIT — CAN MUTATE SAAS DATA.** Backed by `POST /connections/<id>/test_action.json` — the same endpoint the recipe editor's Test button uses. With the right `action_name` and `input`, this can invoke any connector action, including writes.

**Safety gate.** By default, only read-shaped actions are allowed. An action is considered read-only if any of:

- `action_name` starts with `search_`, `get_`, `list_`, `query_`, `find_`, `describe_`, `read_`, `fetch_`
- `action_name` is exactly `execute_suiteql`
- `action_name` is exactly `__adhoc_http_action` AND `input.verb` is `get`, `head`, or `options`

Anything else (e.g. `add_record`, `upsert_record`, `delete_record`, `__adhoc_http_action` with `verb: 'post'`) is rejected with `WorkatoUnsafeAction` unless caller explicitly passes `allow_writes: true`. The override exists for legitimate write use cases — use it deliberately; it can create, modify, or delete real production records.

**Discovering `action_name` values.** Every step in a recipe has a `name` field that's a valid `action_name`. Pull a representative recipe with `workato_pull_recipe` and read its step structure. Common confirmed names:

- `__adhoc_http_action` — arbitrary HTTP via any HTTP-capable connector (SFDC, NS REST, SAP, etc.). Input: `{mnemonic, verb, path, response_type, inspect, request_headers?}`. **Both `mnemonic: "Custom action"` and `inspect: true` are required** — Workato rejects with `WorkatoConnectorError: 'Action name' must be present` if either is missing.
- `execute_suiteql` — SuiteQL query on NetSuite. Input: `{query}`.
- `search_sobjects_soql_v2` — SOQL search on Salesforce. Input: `{query, output_schema, ...}`.

## Recipe control and metadata tools

These tools mutate recipe state or metadata through the user's authenticated Workato browser session. They require an open Workato tab.

### `workato_rename_recipe`

```
input:  { recipe_id: number, name: string }
output: { recipe_id, name, version_no, updated_at, folders, code_errors, job_report_config_errors, requirements_errors }
```

Renames a recipe with `PUT /recipes/<id>.json` and `{ flow: { name } }`. It does not pull or replace the recipe code tree.

### `workato_start_recipe`

```
input:  { recipe_id: number }
output: { recipe_id, action: "start", status }
```

Starts a recipe with `POST /web_api/recipes/<id>/start.json`.

### `workato_stop_recipe`

```
input:  { recipe_id: number, force?: boolean }
output: { recipe_id, action: "stop", status, force }
```

Stops a recipe with `POST /web_api/recipes/<id>/stop.json`. Pass `force: true` when Workato reports active dependent recipes and you still want to enqueue the stop.

## Install

You build the Chrome extension from this repository, then install the local bridge from npm.

### Prerequisites

- Node.js 20+
- pnpm 8+
- Google Chrome or Chromium
- An active Workato account session in the browser

### 1. Build the extension

```bash
git clone https://github.com/Eithery-rc/WorkatoMCP
cd WorkatoMCP
pnpm install
pnpm build:shared
pnpm build:extension
```

This creates the unpacked Chrome extension at:

```text
app/chrome-extension/.output/chrome-mv3
```

The extension's RSA public key is pinned in `app/chrome-extension/wxt.config.ts`, so every clone builds to the same deterministic extension ID:

```text
bpjpdgkeelhkijkllcmogemkmndgeana
```

The npm bridge package already allows that extension ID for native messaging.

### 2. Load the extension in Chrome

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select `app/chrome-extension/.output/chrome-mv3`
5. Confirm Chrome shows extension ID `bpjpdgkeelhkijkllcmogemkmndgeana`

If Chrome shows a different ID, delete `app/chrome-extension/.output/` and `app/chrome-extension/.wxt/`, then rebuild. Also check that `CHROME_EXTENSION_KEY` is not overriding the default key.

### 3. Install the bridge from npm

Install the native bridge globally:

```bash
npm install -g workatomcp-bridge
```

The npm package runs a postinstall step that attempts user-level native-messaging registration for detected browsers. If you need to rerun registration manually:

```bash
workatomcp-bridge register --detect
```

Check the installation:

```bash
workatomcp-bridge doctor
```

If doctor reports fixable issues:

```bash
workatomcp-bridge doctor --fix
```

The older `mcp-chrome-bridge` command remains available as a compatibility alias, but new installs should use `workatomcp-bridge`.

### 4. Configure your MCP client

WorkatoMCP exposes the MCP server over local HTTP once the Chrome extension launches the bridge:

For Claude Desktop and similar clients that launch MCP servers with `command` / `args`, use `mcp-remote`:

```json
{
  "mcpServers": {
    "workato": {
      "command": "npx",
      "args": ["mcp-remote", "http://127.0.0.1:12306/mcp", "--allow-http"]
    }
  }
}
```

For clients that support streamable HTTP directly, you can use the local URL without `mcp-remote`:

```json
{
  "mcpServers": {
    "workato": {
      "transport": "http",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

Restart your MCP client after changing its config.

### 5. Use it

1. Open `https://app.workato.com` or your Workato region URL in Chrome.
2. Sign in.
3. Keep at least one Workato tab open.
4. Call a WorkatoMCP tool from your MCP client.

The bridge auto-launches through Chrome native messaging on the first MCP call. If a tool returns `WorkatoTabNotFound`, open a signed-in Workato tab and retry.

### Troubleshooting

If the extension popup says "Service Not Started" or your MCP client gets `ConnectionRefused`, run:

```bash
workatomcp-bridge doctor --fix
```

Then reload the unpacked extension in `chrome://extensions/` and restart your MCP client.

## Tab selection

The tools auto-discover a Workato tab (`*.workato.com` or `*.workato.is`).

- Zero matching tabs → `TabNotFound` (open Workato first).
- Tabs across multiple distinct hosts (e.g. US + EU at the same time) → `MultipleWorkatoHosts` (close one).
- One or more tabs on the same host → uses the first.

## Planned v1.3+

Documented as stub files under `app/chrome-extension/entrypoints/background/tools/workato/*.stub.ts`:

- `workato_push_recipe` — recipe write (with pull-before-push, last_version_no lock, /edit-tab refusal).
- `workato_create_connection` — new connection creation (with secret strip + provider allowlist).
- `workato_describe_action` — once the `extended_schema.json` endpoint's reliability is understood (it returned empty for `execute_suiteql` during v1.2 recon).

**Note:** v1's `workato_run_soql` and `workato_schema_derive` stubs are superseded by v1.2's `workato_run_query` (generic across SOQL, SuiteQL, and SQL). The stubs remain in the source tree for historical reference.

Full design rationale per release:

- v1: `docs/superpowers/specs/2026-05-11-workatomcp-design.md`
- v1.1: `docs/superpowers/specs/2026-05-12-workatomcp-v11-design.md`
- v1.2: `docs/superpowers/specs/2026-05-12-workatomcp-v12-design.md`

## Repo layout

```
WorkatoMCP/
├── app/
│   ├── chrome-extension/                              # MV3 extension (WXT)
│   │   └── entrypoints/background/tools/
│   │       ├── browser/      (upstream)
│   │       ├── record-replay/(upstream)
│   │       └── workato/      (THIS FORK — pull, trace, csrf, tab-dispatch)
│   └── native-server/                                  # local bridge :12306
├── packages/
│   ├── shared/        (TOOL_NAMES.WORKATO + TOOL_SCHEMAS additions live here)
│   └── wasm-simd/     (upstream)
├── docs/superpowers/
│   ├── specs/2026-05-11-workatomcp-design.md
│   └── plans/2026-05-11-workatomcp-v1.md
└── README.upstream.md  / LICENSE.upstream             (parent project)
```

## License

MIT. See `LICENSE` (this fork) and `LICENSE.upstream` (parent project, mcp-chrome).
