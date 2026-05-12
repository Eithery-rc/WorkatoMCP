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

## Install (dev)

1. `pnpm install`
2. `pnpm build:shared && pnpm build:extension`
3. Chrome → `chrome://extensions/` → enable Developer mode → "Load unpacked" → select `app/chrome-extension/.output/chrome-mv3` (confirm the exact folder name from `app/chrome-extension/.output/`).
4. Start the bridge: `pnpm dev:native` (or the production equivalent; see `app/native-server/package.json`). The bridge listens on `http://127.0.0.1:12306/mcp`.
5. Register in your MCP client. Example for Claude Code (`~/.claude/mcp.json` or equivalent):

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

If pnpm v7+ skips postinstall scripts, add to `.npmrc`:

```
enable-pre-post-scripts=true
```

## Manual smoke test

After loading the extension and starting the bridge:

1. Open Chrome and sign in to Workato (`https://app.workato.com` or your region).
2. Open any recipe — note its numeric id from the URL.
3. From an MCP client, call `workato_pull_recipe({ recipe_id: <id> })`. Verify `version.version_no` is a positive integer and `code` is an object.
4. Pick a recent job for that recipe. Call `workato_job_trace({ recipe_id: <id>, job_id: <jid> })`. Verify `steps[]` is non-empty (or that `error` is set if the job failed).
5. Repeat with `full: true` — verify `meta` and `line_details` keys are populated with raw responses.

### v1.1 smoke test additions

Run after the v1 smoke test passes:

7. **search_recipes by name** — `workato_search_recipes({ text: "<a known recipe name>" })` → verify `count >= 1`, slim shape includes the recipe id you expected.
8. **search_recipes pagination** — `workato_search_recipes({})` then `workato_search_recipes({ page: 2 })` → verify the two pages have distinct first ids.
9. **search_connections** — `workato_search_connections({ text: "salesforce" })` → verify all matches have `provider === 'salesforce'` OR a name containing "salesforce"/"sfdc" (text matches the name, not the provider).
10. **get_connection metadata** — `workato_get_connection({ connection_id: <known id> })` → verify slim shape has the documented metadata fields plus `config`. Critically, **grep the output for any value matching `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`** (JWT shape), `^[A-Fa-f0-9]{40,}$` (long hex), or `^[A-Za-z0-9_+/=]{60,}$` (long opaque base64). **Expected: zero matches.**
11. **get_connection with full=true** — `workato_get_connection({ connection_id: <known id>, full: true })` → repeat the secret-shaped-value grep. Still zero matches. The strip applies in full mode.
12. **list_jobs default** — `workato_list_jobs({ recipe_id: <known id> })` → verify returns up to 25 jobs, `total` matches lifetime count, `next_cursor` set if more remain.
13. **list_jobs auto-walk** — `workato_list_jobs({ recipe_id: <known id>, limit: 50 })` → verify exactly 50 jobs returned (tool walked 2 internal pages of 25).
14. **list_jobs status filter** — `workato_list_jobs({ recipe_id: <known id>, status: "failed" })` → verify `scope < total` and only `status: "failed"` jobs returned.
15. **list_jobs cursor resume** — call `workato_list_jobs({ recipe_id, limit: 25 })`, take its `next_cursor`, then `workato_list_jobs({ recipe_id, limit: 25, cursor: <that> })` → verify the second call returns the next 25 jobs (distinct ids from the first call).
16. **Provider denylist audit** — for each adapter present in your workspace (run `workato_search_connections({ sort: 'updated_at' })` and collect distinct `provider` values), call `workato_get_connection({ connection_id: <one id per provider> })` and run the secret-shape grep from step 10. Zero matches across all providers.

## Tab selection

The tools auto-discover a Workato tab (`*.workato.com` or `*.workato.is`).

- Zero matching tabs → `TabNotFound` (open Workato first).
- Tabs across multiple distinct hosts (e.g. US + EU at the same time) → `MultipleWorkatoHosts` (close one).
- One or more tabs on the same host → uses the first.

## Planned v1.1+

Documented as stub files under `app/chrome-extension/entrypoints/background/tools/workato/*.stub.ts`:

- `workato_push_recipe` — recipe write (with pull-before-push, last_version_no lock, /edit-tab refusal).
- `workato_run_soql` — SOQL passthrough via the schema-derivation endpoint.
- `workato_schema_derive` — schema-only result from the same endpoint.

Full design rationale: `docs/superpowers/specs/2026-05-11-workatomcp-design.md`.

## Upstream typecheck baseline

`pnpm typecheck` at the root surfaces ~115 pre-existing TypeScript errors in upstream files (`gif-recorder.ts`, `network-capture-web-request.ts`, sidepanel composables, and some `record-replay-v3` test fixtures). These are inherited from `hangwin/mcp-chrome@f48e717` and are not specific to our Workato additions. Our own files (`packages/shared/src/tools.ts`, everything under `app/chrome-extension/entrypoints/background/tools/workato/`) typecheck cleanly. For Workato-only verification use:

```powershell
pnpm --filter chrome-mcp-shared exec tsc --noEmit
pnpm --filter chrome-mcp-server exec tsc --noEmit 2>&1 | Select-String "workato"
```

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
