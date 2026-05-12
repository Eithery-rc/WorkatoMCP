# WorkatoMCP

A Chrome extension + local MCP bridge that exposes typed Workato recipe operations to AI agents (Claude Code, Claude Desktop, etc.) by piggybacking on the user's already-authenticated Workato browser session.

Forked from [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome) — see `README.upstream.md` for the parent project, and `LICENSE.upstream` for its MIT license.

## v1 tools

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
