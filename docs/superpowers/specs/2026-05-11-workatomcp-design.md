# WorkatoMCP — v1 design

**Date:** 2026-05-11
**Status:** Draft, awaiting user review
**Repo:** `C:\Work\Personal\WorkatoMCP`

## 1. Goal

Expose Workato recipe operations to AI agents as typed MCP tools, backed by a Chrome extension that piggybacks on the user's already-authenticated Workato browser session.

Replaces the current workflow in the `workato-recipe` skill (which drives Workato via `chrome-devtools` MCP `evaluate_script`). That approach has three concrete pain points this project removes:

1. `evaluate_script` return value capped at ~25K tokens, forcing a `curl + cookies.txt` fallback for any recipe >~30KB code.
2. User must keep a specific Workato tab open and visible.
3. Cookies.txt export is a manual one-time-per-session step.

## 2. v1 scope

Two read-only tools:

- **`workato_pull_recipe`** — fetch a recipe's `code` tree + metadata.
- **`workato_job_trace`** — fetch a job's per-step execution trace.

**Explicitly out of v1** (captured in §9, stubbed in code):

- `workato_push_recipe` — recipe write
- `workato_run_soql` — SOQL passthrough via `/utils/sample_to_schema.json`
- `workato_schema_derive` — schema derivation (same endpoint as SOQL)
- `workato_job_list` — list jobs for a recipe

Read-only v1 deliberately avoids the entire push-safety surface: pull-before-push, `last_version_no` optimistic locking, "never push while `/edit` is open" tab-state checks.

## 3. Architecture

Hard fork of [`hangwin/mcp-chrome`](https://github.com/hangwin/mcp-chrome), vendored into this repo. We inherit:

- MV3 Chrome extension
- Local HTTP bridge at `http://127.0.0.1:12306/mcp` (Streamable HTTP transport; stdio fallback)
- MCP protocol plumbing
- Tab-scoped script injection patterns

We add:

- Two new MCP tools in the bridge's tool registry
- Workato dispatch + CSRF helpers in the extension
- `*.workato.com` and `*.workato.is` in `host_permissions` (covers US, EU, APAC, and any future regional subdomains)

```
MCP client (Claude Code, Claude Desktop, etc.)
    │  MCP over HTTP
    ▼
Bridge (127.0.0.1:12306)
    │  chrome.runtime messaging
    ▼
Extension service worker
    │  chrome.scripting.executeScript (world: MAIN)
    ▼
Workato page (cookies + CSRF auto-attached)
    │  fetch()
    ▼
Workato API
```

## 4. Repo layout

```
WorkatoMCP/
├── app/
│   ├── chrome-extension/             # forked MV3 extension
│   │   ├── manifest.json             # patched: host_permissions
│   │   ├── background/               # upstream (touched only if necessary)
│   │   └── workato/                  # NEW — Workato-specific extension code
│   │       ├── tab-dispatch.ts       # find Workato tab, run fetch in MAIN world
│   │       ├── csrf.ts               # decode XSRF-TOKEN-V2 cookie → header
│   │       ├── pull-recipe.ts        # build + execute the two pull fetches
│   │       └── job-trace.ts          # build + execute the two trace fetches
│   └── native-server/                # forked bridge
│       └── tools/
│           ├── workato_pull_recipe.ts   # NEW — MCP tool handler
│           ├── workato_job_trace.ts     # NEW — MCP tool handler
│           └── workato/                  # NEW — shared types, future-tool stubs
├── docs/superpowers/specs/2026-05-11-workatomcp-design.md
├── README.md                          # rewritten for WorkatoMCP install + tools
└── package.json                       # renamed to workato-mcp
```

**Boundary discipline:** every Workato-specific change lives under a `workato/` directory. Upstream files we patch are limited to (a) `manifest.json` for `host_permissions`, and (b) the bridge's tool registry (one import + one register call per tool). This keeps "rebase from upstream" a clear, reviewable diff.

## 5. Tool specs

All endpoint shapes below are copied verbatim from `C:\Users\Kiba0\.claude\skills\workato-recipe\SKILL.md` — single source of truth, do not re-derive.

### 5.1 `workato_pull_recipe`

**Input:**
```ts
{ recipe_id: number }
```

**Underlying HTTP calls** (both run in the Workato tab via `fetch()` with `credentials: 'include'`):

| # | Method | URL | Notes |
|---|--------|-----|-------|
| 1 | GET | `/recipes/<id>/code.json?mode=view&hideHeader=false&noBorderRadius=false&banHotkeys=false` | Returns `{result: "<stringified JSON of code tree>"}` |
| 2 | GET | `/recipes/<id>.json?error_format=json` | Returns recipe meta including `result.recipe_data.flow.version_no` |

**Output:**
```ts
{
  recipe_id: number,
  code: <parsed JSON of code tree>,        // from call 1, JSON.parse'd
  version: {
    version_no: number,                    // for future push as last_version_no
    name: string,
    folder_id: number,
    config: string,                        // stringified connector accounts
    visibility_private: boolean,
    description: string,
    worker_concurrency: number,
    job_data_retention_policy: string,
  },
}
```

Notes:
- We do **not** return the raw `code_str` — agents work with the parsed tree. (If push needs the stringified form, that tool will re-stringify before sending; the round trip is deterministic.)
- `version.config` is returned as a string so a future `workato_push_recipe` can pass it through unchanged (per safety rule "never modify `flow.config` unless asked").

### 5.2 `workato_job_trace`

**Input:**
```ts
{
  job_id: string | number,
  recipe_id: number,              // required — the trace endpoint is recipe-scoped
  full?: boolean,                  // default false; true returns raw responses
}
```

**Underlying HTTP calls:**

| # | Method | URL | Notes |
|---|--------|-----|-------|
| 1 | GET | `/web_api/recipes/<recipe_id>/jobs/<job_id>` | Job + recipe metadata. No CSRF for GET. |
| 2 | GET | `/web_api/recipes/<recipe_id>/jobs/<job_id>/line_details?stringify_big_numbers=true` | Per-step inputs/outputs |

Both with `accept: application/json` and `x-requested-with: XMLHttpRequest`.

**Output (slim — default):**
```ts
{
  job_id: string | number,
  recipe: { id: number, name: string, version_no: number },
  status: "succeeded" | "failed" | string,
  started_at: string,
  completed_at: string,
  duration_ms: number,
  error?: {
    message: string,
    error_type: string,
    line_number: number,
    adapter: string,
    action: string,
  },
  steps: Array<{
    recipe_line_number: number,           // 0-indexed; UI step = this + 1
    adapter_name: string,                 // e.g. "salesforce", "netsuite"
    adapter_operation: string,            // e.g. "search_sobjects_soql_v2"
    input_summary: string,                // truncated stringified input
    output_summary: string,               // truncated stringified output
  }>,
  lines_truncated: boolean,               // server-side truncation flag
  kms_error: boolean,
}
```

**Output (full=true):**
```ts
{
  job_id,
  meta: <raw response from call #1>,
  line_details: <raw response from call #2>,
}
```

Slim shape derivation rules:
- `input_summary` / `output_summary`: stringified JSON, truncated to 500 chars with `...` suffix if longer. Preserves shape ("Object with keys: …") for huge payloads.
- Slim output stays well under typical MCP per-tool response budgets even for jobs with hundreds of steps. Agents that need raw payloads ask for `full: true`.

## 6. Tab dispatch

Both tools share a single dispatch path in `app/chrome-extension/workato/tab-dispatch.ts`.

**Selection algorithm:**
1. `chrome.tabs.query({ url: ["*://*.workato.com/*", "*://*.workato.is/*"] })`
2. If `tabs.length === 0` → return `TabNotFound` error.
3. Group tabs by `new URL(tab.url).host`. If >1 distinct host → return `MultipleWorkatoHosts` error with the host list.
4. Otherwise pick `tabs[0]`.

**Execution:**
- Use `chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: <fetch wrapper>, args: [...] })`.
- `world: 'MAIN'` is required so the page's session cookies attach (`credentials: 'include'` is default for same-origin).
- The fetch wrapper itself is a small inline function (no imports) that runs the GETs sequentially and returns `{ ok, status, json }` per call.

**Why not content scripts:** `executeScript` with `world: MAIN` is more direct, has no message-passing hop, and avoids polluting the page's content-script global namespace. It also matches the pattern mcp-chrome already uses for its `inject_script` tool.

## 7. CSRF handling

Not needed for v1 — both pull and trace endpoints are GETs, and Workato's CSRF policy applies to mutating verbs (POST/PUT/DELETE) only.

A `csrf.ts` helper is still included in the extension code because (a) future tools (push, SOQL) need it and (b) it's a tiny function, easier to land now than as a churn in a later PR. Implementation:

```ts
function readCsrfFromCookie(): string {
  const raw = document.cookie
    .split("; ")
    .find(c => c.startsWith("XSRF-TOKEN-V2="))
    ?.split("=").slice(1).join("=") ?? "";
  return decodeURIComponent(raw);
}
```

v1 tools do not call this. v1.x push/SOQL tools will.

## 8. Error handling

All errors returned as MCP errors with a typed `code` and a human-readable `message`. No silent fallbacks; every failure mode is distinct.

| Code | Trigger | Suggested agent action |
|------|---------|------------------------|
| `TabNotFound` | `chrome.tabs.query` returned empty | Tell user to open Workato in a tab |
| `MultipleWorkatoHosts` | Tabs span >1 host (e.g. US + EU) | Tell user to close one, or specify (future arg) |
| `WorkatoApiError` | Workato returned non-2xx | Inspect `status` + `body_excerpt` (truncated 1KB); surface to user |
| `BridgeUnavailable` | Extension service worker not responding to bridge | Reload extension at `chrome://extensions` |
| `UnexpectedShape` | Workato response missing expected keys (`result.recipe_data.flow.version_no`, `line_details[]`, etc.) | Likely upstream API drift; file an issue |

For `WorkatoApiError`, the bridge includes the first 1KB of the response body for diagnosis without flooding agent context.

## 9. Future tools (captured, stubbed, not v1)

Each future tool gets a handler file in `app/native-server/tools/` whose body is `throw new NotImplementedError("v1 read-only — push/SOQL/schema are planned for v1.1+")`. They are **not registered** with the MCP tool list, so agents can't see or call them. Files exist purely so the next iteration has the endpoint research in source control.

### 9.1 `workato_push_recipe` (planned, v1.1)

Endpoint: `PUT /recipes/<id>.json`
Body shape (top-level keys are exactly `flow` / `client_uuid` / `error_format` — **not** `{recipe: ...}`):

```json
{
  "flow": {
    "name", "description", "visibility_private", "curated",
    "last_version_no": <int — must equal current server version>,
    "code":   "<stringified JSON of code tree>",
    "config": "<stringified JSON of connector accounts — usually unchanged>",
    "copy_in_progress": false,
    "worker_concurrency": 1,
    "folder_id": <int>,
    "job_data_retention_policy": "default"
  },
  "client_uuid": "<uuid v4>",
  "error_format": "json"
}
```

Headers: `content-type: application/json; charset=utf-8`, `x-csrf-token: <decoded XSRF-TOKEN-V2>`, `x-requested-with: XMLHttpRequest`. **Do not gzip the body** — Workato accepts uncompressed.

Safety rules (must be enforced in code, not just docs):
1. **Pull-before-push** — tool requires the caller to pass a recent `version.version_no` (e.g. obtained from `workato_pull_recipe`). Stale `last_version_no` → 409.
2. **Backup-before-push** — bridge writes the pre-push state to `.workato/<id>.before.<timestamp>.json` in the workspace (or a configured path).
3. **Reject pushes while `/edit` is open** — `chrome.tabs.query` for the recipe's edit URL; if found, refuse with `RecipeOpenInEditMode`. (Editor caches the recipe in memory; saving in the UI after a programmatic push will silently overwrite our edits — server `version_no` advances but field changes disappear.)
4. **No `flow.config` mutation** — strip incoming `config` and use the value from the most recent pull, unless the caller passes `allow_config_changes: true`.
5. **No mutation of `flow.id` / `version_no` outside the documented role.**

Failure modes:
- 409 → version mismatch; re-pull, re-apply edits, retry once.
- 401/403 → session expired; user must re-auth.
- 200 with non-empty `result.flow.code_errors` or `result.flow.requirements_errors` → semantic rejection; surface the errors.

### 9.2 `workato_run_soql` (planned, v1.1)

Endpoint: `POST /utils/sample_to_schema.json`
Headers: `content-type: application/json`, `x-csrf-token: <…>`, `x-requested-with: XMLHttpRequest`.
Body: `{ sample: "<SOQL>", type: "soql", shared_account_id: <int> }`.

Capped at ~100-150 rows server-side. Bridge surfaces this in the response. `422` almost always means stale CSRF — re-read and retry once before failing.

### 9.3 `workato_schema_derive` (planned, v1.1)

Same endpoint as `workato_run_soql`. The endpoint returns both `result.sample` (rows) and `result.schema` (field definitions in the same shape Workato writes into `extended_output_schema`). This tool is a re-shape of the same call that returns only the schema, useful for "what does an SObject's schema look like" without dumping all rows.

### 9.4 `workato_job_list` (planned, v1.2)

Listing endpoint not yet reverse-engineered in the skill. Capture is deferred to whoever implements it (likely a UI watch of the jobs panel).

## 10. Testing

**Unit tests** (in `app/chrome-extension/workato/*.test.ts` and `app/native-server/tools/workato/*.test.ts`):
- Tab-selection: zero tabs, one tab, many tabs same host, many tabs across hosts.
- CSRF cookie decoding (URL-encoded values, missing cookie).
- Job-trace slim transform: full trace fixture → expected slim shape; truncation of large input/output strings.
- Error mapping: simulated non-2xx → correct `code`.

Mocks: `chrome.tabs.query`, `chrome.scripting.executeScript`, `document.cookie`, `fetch`.

**Integration smoke test** (manual, documented in README):
1. Open a known Workato recipe in a tab.
2. From MCP client, call `workato_pull_recipe(<id>)` — confirm `code` parses and `version.version_no` is a positive int.
3. Pick a known job for that recipe; call `workato_job_trace(<job_id>, <recipe_id>)` — confirm `steps[]` non-empty and `status` is set.
4. Repeat with `full: true` — confirm raw shape returned.

No automated test against live Workato — fragile, requires creds we don't want in CI.

## 11. Install / dev

Inherit mcp-chrome's flow, no shortcuts:

1. `pnpm install`
2. `pnpm build`
3. Chrome → `chrome://extensions/` → Developer mode → Load unpacked → select `app/chrome-extension/dist`
4. `pnpm bridge:start` (bridge listens on `http://127.0.0.1:12306/mcp`)
5. Register the bridge URL in the MCP client config (Claude Desktop / Claude Code).

README also documents:
- How to find a tenant's region (just look at the open tab's host).
- How to verify the extension is talking to the bridge (the extension's service worker logs).
- How to recover from a stale service worker (extension reload).

pnpm v7+ users may need to enable pre/post scripts (`enable-pre-post-scripts=true` in `.npmrc`) — call this out in the README; it's the only known install footgun we inherit from upstream.

## 12. Non-goals

- **Chrome Web Store listing.** Personal-use project; load-unpacked is fine.
- **Multi-region tab disambiguation.** If a user has US + EU open simultaneously, the tool errors out. No "pick region" arg in v1.
- **Auth handling beyond the existing browser session.** No API token support, no service-account flow. The entire premise is "use the browser session you already have."
- **Caching of recipe state.** Each tool call hits Workato fresh. No write-through cache, no ETag handling.
- **Tab manipulation.** v1 does not open tabs, navigate, or focus them. If the right tab isn't open, the tool returns `TabNotFound` and stops.
- **Recipe diffing / merging.** Returning the raw code tree is the contract. Agents that need diffs compute them client-side.

## 13. Open questions to resolve during implementation

1. Exact upstream mcp-chrome paths for the bridge tool registry and the extension service worker entry — confirm during step 1 of implementation (vendor + rename).
2. Whether to use a single shared dispatch function across both tools or have each tool own its dispatch — likely shared, defer until both handlers exist.
3. Whether the bridge needs a config file or if env vars are enough — defer; v1 has no configurable knobs.
