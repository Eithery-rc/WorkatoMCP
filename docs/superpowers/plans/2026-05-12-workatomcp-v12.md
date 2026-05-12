# WorkatoMCP v1.2 Implementation Plan

> **For agentic workers:** Plan is being executed inline by the same session that wrote it. No subagent dispatch — user requested fully autonomous completion.

**Goal:** Add `workato_run_query` (SOQL / SuiteQL / SQL via `/utils/sample_to_schema.json`) and `workato_call_action` (universal connector-action runner via `/connections/<id>/test_action.json`) with a default write-safety gate.

**Architecture:** Same v1/v1.1 pattern — tools extend `BaseBrowserToolExecutor`, dispatch via `findWorkatoTab` + `runInWorkatoTab`, in-page functions are plain `function`s returning `.then()` chains. POST endpoints, so CSRF read from `document.cookie` inside each in-page function.

**Spec:** `docs/superpowers/specs/2026-05-12-workatomcp-v12-design.md`.

---

## Task 1 — design doc + plan committed

Already complete by the time this plan is being written. Spec at `docs/superpowers/specs/2026-05-12-workatomcp-v12-design.md`; this plan at `docs/superpowers/plans/2026-05-12-workatomcp-v12.md`. Commit both before moving on.

## Task 2 — shared schemas

Modify `packages/shared/src/tools.ts`:

1. Add two entries to `TOOL_NAMES.WORKATO`:
   - `RUN_QUERY: 'workato_run_query'`
   - `CALL_ACTION: 'workato_call_action'`

2. Append two `TOOL_SCHEMAS` entries with these input shapes:
   - **run_query:** required `connection_id` (number), `query` (string), `type` (enum `soql`/`suiteql`/`sql`). Optional `schema_only` (boolean, default false), `full` (boolean, default false). Mention `count` in slim shape, 100-row server cap, and SOQL-LIMIT-stripping in description.
   - **call_action:** required `connection_id` (number), `action_name` (string), `input` (object). Optional `allow_writes` (boolean, default false), `full` (boolean, default false). Description loudly explains the safety gate and that this is the most powerful tool in the kit.

3. `pnpm build:shared` + `pnpm --filter chrome-mcp-shared exec tsc --noEmit` clean. Commit.

## Task 3 — implement `run-query.ts`

New file at `app/chrome-extension/entrypoints/background/tools/workato/run-query.ts`. Structure:

- Plain `function runQueryInPage(query: string, type: string, connectionId: number): Promise<InPageResult>` that:
  - Reads CSRF inline (4-line block, not imported)
  - Strips trailing `/\s+LIMIT\s+\d+\s*$/i` from `query` ONLY when `type === 'soql'`
  - POSTs `{sample: <stripped query>, type, shared_account_id: connectionId}` to `/utils/sample_to_schema.json`
  - Distinguishes three branches: non-2xx (HTTP error), 2xx + `error` key (connector error), 2xx + `result.{schema,sample}` (success)
- Class `WorkatoRunQueryTool extends BaseBrowserToolExecutor` with `name = TOOL_NAMES.WORKATO.RUN_QUERY` and `execute(args)`:
  - Validate `connection_id` (finite number), `query` (non-empty string), `type` (`'soql' | 'suiteql' | 'sql'`).
  - Map `connectorError` to `createErrorResponse('WorkatoConnectorError: <msg>')`.
  - Slim shape: `{ type, count, truncated_to_100, schema, rows? }` (omit `rows` when `schema_only: true`).
  - Full mode: pass through `raw.result`.
- Export `workatoRunQueryTool` singleton.

Targeted typecheck clean, commit.

## Task 4 — implement `call-action.ts`

New file at `app/chrome-extension/entrypoints/background/tools/workato/call-action.ts`. Structure:

- Module-scope pure function `isReadActionName(name: string, input: Record<string, unknown>): boolean` (defined at module scope — runs in the background, never in-page, so module-scope is fine):
  - `true` if `name` matches `/^(search_|get_|list_|query_|find_|describe_|read_|fetch_)/i`
  - `true` if `name === 'execute_suiteql'`
  - `true` if `name === '__adhoc_http_action'` AND `String(input.verb ?? input.method ?? '').toLowerCase()` is `'get' | 'head' | 'options'`
  - `false` otherwise
- Plain `function callActionInPage(connectionId, actionName, input)`:
  - Reads CSRF inline
  - POSTs `{name: actionName, input}` to `/connections/${connectionId}/test_action.json`
  - Same three-branch error handling as `run-query.ts`
- Class `WorkatoCallActionTool` with `execute(args)`:
  - Validate `connection_id`, `action_name` (non-empty string), `input` (object).
  - Apply safety gate: if `!isReadActionName(...)` AND `!allow_writes`, return `createErrorResponse('WorkatoUnsafeAction: ...')`.
  - Slim shape: `{action_name, result}` (the `result` key only).
  - Full mode: pass through the entire response envelope.
- Export `workatoCallActionTool` singleton.

Targeted typecheck clean, commit.

## Task 5 — register + bundler verify

Modify `app/chrome-extension/entrypoints/background/tools/workato/index.ts` to add two `export { ... }` lines for the new tools.

Then: `pnpm build:shared && pnpm build:extension`. Verify dist:

- `Select-String -Path .../background.js -Pattern "_runQueryInPage|_callActionInPage"` → **zero matches** (would mean async-function transpilation pitfall).
- `Select-String -Path .../background.js -Pattern "function runQueryInPage|function callActionInPage"` → **2 matches**.

Commit.

## Task 6 — README v1.2 section + smoke checklist

Modify `README.md`:

1. Add `## v1.2 tools (shipped)` section after the existing v1.1 section, with subsections for `workato_run_query` and `workato_call_action` documenting input shapes, slim output, the LIMIT-stripping quirk, the write-safety gate.
2. Extend the `## Manual smoke test` section with new steps:
   - Step 17: `run_query({type:'soql', query:'SELECT Id, Name FROM Account', connection_id: <SFDC>})` → verify schema + rows
   - Step 18: `run_query({type:'suiteql', query:'SELECT id, tranid FROM transaction WHERE rownum<3', connection_id: <NS>})` → verify
   - Step 19: `call_action({action_name:'execute_suiteql', input:{query:'...'}, connection_id: <NS>})` → verify
   - Step 20: `call_action({action_name:'add_record', input:{...}, connection_id: <NS>})` WITHOUT allow_writes → expect `WorkatoUnsafeAction`
   - Step 21: Same call WITH `allow_writes:true` → expect Workato to actually attempt (and probably succeed in test sandbox; user judges)

Commit.

## Task 7 — smoke test + tag

Steps:

1. `pnpm clean:dist && pnpm build`
2. User reloads the extension in `chrome://extensions/`, restarts MCP client to pick up the two new tool schemas
3. Execute steps 17-20 of the README checklist live against the user's Workato workspace (I drive)
4. If all pass, restore the page interceptor (uninstall `__workatoCaptured`/`__origFetch`/`__OrigXHR` patches we left behind during recon), tag `v1.2.0`, push, update memory.

If smoke test fails at any step, do NOT tag. Diagnose, fix, recommit, re-smoke.

---

## Out of scope (don't add to v1.2)

- `workato_describe_action` — defer until we understand extended_schema reliability
- Provider-specific helpers (workato_soql, etc.) — generic `run_query` covers both
- Action discovery / catalog — agents use existing `pull_recipe` to learn action names
- Pagination beyond Workato's 100-row server cap on `sample_to_schema.json`
- Per-provider write allowlists (the universal heuristic is sufficient for v1.2)
- Tests for the two new tools (matches v1's call on tool `execute()` methods)
