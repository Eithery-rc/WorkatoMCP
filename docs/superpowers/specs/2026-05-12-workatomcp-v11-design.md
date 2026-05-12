# WorkatoMCP — v1.1 design

**Date:** 2026-05-12
**Status:** Draft, awaiting user review
**Repo:** `C:\Work\Personal\WorkatoMCP` (commit base: `4fb476f` on `master`)
**Companion docs:**

- v1 design: `2026-05-11-workatomcp-design.md`
- v1 plan: `2026-05-11-workatomcp-v1.md`
- v1.1 endpoint research: `2026-05-12-v11-discovery-endpoints.md` — source of truth for every URL/param/response shape

## 1. Goal

Close the agent autonomy loop. Today agents need recipe IDs and job IDs handed to them by humans; v1.1 lets agents discover those IDs themselves.

Four new read-only MCP tools on top of v1's `workato_pull_recipe` + `workato_job_trace`:

| Tool                         | Use case                                                          |
| ---------------------------- | ----------------------------------------------------------------- |
| `workato_search_recipes`     | "Find the integration that does X."                               |
| `workato_search_connections` | "What's hooked up to Salesforce in this workspace?"               |
| `workato_get_connection`     | "What's the authorization status / instance URL of connection N?" |
| `workato_list_jobs`          | "Walk recent jobs for recipe N; show me the failed ones."         |

Combined with v1's pull + trace, agents can now run a complete loop unaided: search → list jobs → trace failure → pull recipe → propose fix.

## 2. Scope

**In v1.1:**

- 4 new tools (all read-only, all GET).
- Two new pure helpers: `buildSlimRecipe` / `buildSlimConnection` (response shaping), and `stripConnectionSecrets` (allowlist+denylist auth-material strip).
- Unit tests for both pure helpers.
- README update + manual smoke checklist update.

**Out of v1.1** (captured as `.stub.ts` documentation files, mirroring v1's approach):

- Write tools: `workato_push_recipe`, `workato_run_soql`, `workato_schema_derive`, `workato_create_connection`.
- Per-provider typed config schemas for `get_connection` (denylist suffices for v1.1).
- Project / folder listing tools (`workato_list_projects`, `workato_list_folders`).
- Server-side state/provider filters (Workato doesn't expose them — agents filter client-side on returned fields).

## 3. Architecture

No new infrastructure. Every new tool reuses v1's primitives:

- `findWorkatoTab()` + `runInWorkatoTab()` from `tab-dispatch.ts` (auto-find Workato tab, dispatch in-page function).
- `WorkatoDispatchError` for typed error codes (`TabNotFound`, `MultipleWorkatoHosts`, `ScriptExecutionFailed`, `UnexpectedShape`).
- In-page functions are **plain `function`s returning `Promise.then()` chains** — NEVER `async`/`await`. WXT/Vite rewrites async function declarations into a sync wrapper that calls a hoisted `_<name>` helper; the wrapper survives serialization but the helper does not, causing `ReferenceError: _<name> is not defined` in the page. See [`reference_v1_pitfalls_resolved.md`](../../../C--Work-Personal-WorkatoMCP/memory/reference_v1_pitfalls_resolved.md).
- Tool classes extend `BaseBrowserToolExecutor`, registered in `app/chrome-extension/entrypoints/background/tools/workato/index.ts` (the upstream tool registry already spreads `...workatoTools`).
- Bridge changes: none. Same singleton-fix from v1 (`createMcpServer()` factory) handles concurrent sessions.

## 4. Tool surfaces

All tools accept `full?: boolean` (default `false`). Slim shape is the default contract; `full: true` returns the raw response. Every tool runs the dispatch error → MCP error mapping from v1 (`TabNotFound` → `createErrorResponse('TabNotFound: ...')`, etc.).

### 4.1 `workato_search_recipes`

```ts
input: {
  text?: string,            // name substring search; omit/empty = all
  folder_id?: number,       // scope to one folder
  page?: number,            // 1-based, default 1
  sort?: 'latest_activity' | 'name' | 'updated_at' | 'created_at',  // default 'latest_activity'
  full?: boolean,
}
output (slim): {
  count: number,            // total matches across all pages
  page: number,
  per_page: 20,
  recipes: Array<{
    id: number,
    name: string,
    folder_id: number,
    project_id: number,
    running: boolean,
    state: string,
    last_run_at: string | null,
    job_succeeded_count: number,
    job_failed_count: number,
    trigger_application: string,
    trigger_business_object: string,
    action_applications: string[],
  }>,
}
```

**HTTP:** `GET /web_api/mixed_assets.json?asset_type=recipe&text=<>&folder_id=<>&page=<>&sort_term=<>` with `credentials: 'include'`, `accept: application/json`, `x-requested-with: XMLHttpRequest`.

**Important:** `asset_type=recipe` is **always** passed by the tool, even when omitted from the input. Without it, sort terms like `updated_at` surface connections first. The tool's job is to return recipes, so this is non-negotiable.

`per_page` is NOT exposed as an input — Workato caps server-side at 20.

### 4.2 `workato_search_connections`

```ts
input: {
  text?: string,
  folder_id?: number,
  page?: number,
  sort?: 'latest_activity' | 'name' | 'updated_at',
  full?: boolean,
}
output (slim): {
  count: number,
  page: number,
  per_page: 20,
  connections: Array<{
    id: number,
    name: string,
    provider: string,                       // adapter type, e.g. 'salesforce'
    folder_id: number,
    project_id: number,
    recipe_count: number,                   // recipes that reference this connection
    authorization_status: string,
    authorized_at: string | null,
    connection_lost_at: string | null,
    connection_lost_reason: string | null,
    updated_at: string,
  }>,
}
```

**HTTP:** same endpoint as search_recipes, with `asset_type=connection` (again always forced by the tool).

**`text=` matches connection NAMES, not the `provider` field.** Agents wanting "all my Salesforce connections" should either:

- Use `text=salesforce` if names follow a convention like `[SFDC] CONN | ...`, or
- Page through all 172, filter client-side on `provider === 'salesforce'`.

This is a known limitation — Workato exposes no server-side provider filter at this endpoint.

### 4.3 `workato_get_connection`

```ts
input: {
  connection_id: number,
  full?: boolean,
}
output (slim):
{
  id: number,
  name: string,
  provider: string,
  folder_id: number,
  project_id: number,
  recipe_count: number,
  authorization_status: string,
  authorized_at: string | null,
  connection_lost_at: string | null,
  connection_lost_reason: string | null,
  created_at: string,
  updated_at: string,
  config: Record<string, unknown>,  // per-provider, with secret-shaped keys stripped
}
```

**HTTP:** `GET /connections/<id>.json` — **legacy route, NOT under `/web_api/`.** `/web_api/connections/<id>.json` returns 404 (`WebApi::SharedAccountsController` doesn't expose `show`). Use the unprefixed path.

`full: true` returns the raw `result` object **with the same secret-strip applied**. There is no escape hatch for secrets — even raw mode strips known auth material. Agents that need a token to make their own API calls must reuse the user's existing session (cookies travel naturally), not extract one from this tool.

See §6 for the strip rules.

### 4.4 `workato_list_jobs`

```ts
input: {
  recipe_id: number,
  limit?: number,                   // 1..100, default 25; tool auto-walks cursor up to this
  status?: 'failed' | 'succeeded' | 'pending' | string,  // singular
  query?: string,                   // full-text against job title + error message
  started_at?: '7.days' | '30.days' | 'all',
  group_by_master_job?: boolean,
  cursor?: string,                  // job id to resume from; for paging past `limit`
  full?: boolean,
}
output (slim): {
  total: number,                    // job_count from response (unfiltered lifetime)
  scope: number,                    // job_scope_count (matches current filter)
  succeeded: number,                // lifetime job_succeeded_count
  failed: number,                   // lifetime job_failed_count
  next_cursor?: string,             // present when scope > items returned
  jobs: Array<{
    id: string,
    status: string,
    started_at: string,
    completed_at: string,
    duration_ms: number,            // computed
    error_summary?: string,         // error.message when failed
    error_line_number?: number,
    title: string,
    report: { col_0: string, col_1: string, col_2: string },
  }>,
}
```

**HTTP:** `GET /web_api/recipes/<recipe_id>/jobs.json?per_page=25&offset_job_id=<>&prev=false&status=<>&query=<>&started_at=<>&group_by_master_job=<>`.

**Pagination algorithm (inside the tool):**

1. Fetch page with `per_page=25`. Append to results.
2. If `results.length >= limit` → stop, set `next_cursor` to last returned job id.
3. If returned page < 25 → stop (end of history), no `next_cursor`.
4. Else take last job's id, refetch with `offset_job_id=<that>&prev=false`. Goto 2.
5. Cap at 100 internally even if `limit` is higher.

**Why `status` is singular:** Workato accepts `status=failed` but silently ignores `statuses[]=failed`, `job_status=failed`. Verified in endpoint research.

## 5. Pagination model

Two distinct contracts, dictated by what Workato actually supports:

| Tool                         | Pagination                                         | Why                                                                                                                   |
| ---------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `workato_search_recipes`     | Numeric `page=N`, server-capped at 20/page         | Workato endpoint supports `page=`; cursor params silently ignored. Agents step through.                               |
| `workato_search_connections` | Same as above                                      | Same endpoint.                                                                                                        |
| `workato_get_connection`     | n/a                                                | Single-record fetch.                                                                                                  |
| `workato_list_jobs`          | Cursor (`offset_job_id`) + auto-walk up to `limit` | Workato endpoint silently ignores `page=` / `offset=` for jobs. Tool hides cursor mechanics behind a numeric `limit`. |

We deliberately do NOT pretend the two paginations are the same shape. Each tool stays true to its endpoint, with clear documentation. Agents learn one contract per tool.

**Workspace-size sanity:** the test workspace has 2044 recipes + 172 connections + 52 jobs on the test recipe. Per-tool defaults:

- Searches return `count` so an agent can decide whether to advance pages.
- `list_jobs` defaults to `limit: 25` (one page). The agent asks for more explicitly.

## 6. Secret denylist for `workato_get_connection`

A pure helper `stripConnectionSecrets(value)` walks the response recursively. Applied to BOTH slim and full output paths.

### Rules (case-insensitive, applied to object keys at every depth)

```
EXACT MATCH — remove the key entirely:
  auth_token, refresh_token, access_token, oauth_token, id_token,
  client_secret, client_id, api_key, api_secret, private_key,
  password, passphrase, secret, signature, signing_key, jwt,
  bearer, session_token, certificate, cert, encrypted_data,
  ssh_key, totp_secret, mfa_secret

SUFFIX MATCH — remove when key ends with (case-insensitive):
  _token, _secret, _key, _password, _signature,
  _credential, _credentials, _passphrase, _cert, _certificate,
  _jwt, _bearer, _hash

PREFIX MATCH — remove when key starts with (case-insensitive):
  encrypted_, hashed_

VALUE-SHAPE GUARD — even if the key looks innocent, strip the value when it is a string matching any of:
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/   (JWT shape)
  /^[A-Fa-f0-9]{40,}$/                                     (40+ hex chars)
  /^[A-Za-z0-9_+/=]{60,}$/                                 (60+ base64-ish chars with no spaces)
```

Stripped fields are **removed** (not nulled, not redacted to `"***"`) — easier for agents to test `key in obj`.

**False-positive risk: `signing_key_algorithm`** would over-strip if we applied suffix match without context. The suffix rule matches on the full key (`*_key` matches `signing_key_algorithm`? Actually no — `endsWith('_key')` is false for `signing_key_algorithm`). Verify with test cases in `strip-secrets.test.ts`:

- `signing_key_algorithm: "RS256"` → kept (does not end in `_key`).
- `signing_key: "..."` → stripped (ends in `_key`).

**Verification gate before merge:** run `workato_get_connection` against one connection per provider type in the test workspace (10 observed types) and audit the output. If any token-shaped value reaches the slim payload, add a rule.

## 7. Repo layout

```
packages/shared/src/tools.ts
  + TOOL_NAMES.WORKATO.SEARCH_RECIPES = 'workato_search_recipes'
  + TOOL_NAMES.WORKATO.SEARCH_CONNECTIONS = 'workato_search_connections'
  + TOOL_NAMES.WORKATO.GET_CONNECTION = 'workato_get_connection'
  + TOOL_NAMES.WORKATO.LIST_JOBS = 'workato_list_jobs'
  + 4 TOOL_SCHEMAS entries

app/chrome-extension/entrypoints/background/tools/workato/
  search-recipes.ts        NEW  — class + searchRecipesInPage()
  search-connections.ts    NEW  — class + searchConnectionsInPage()
  get-connection.ts        NEW  — class + getConnectionInPage()
  list-jobs.ts             NEW  — class + listJobsInPage() (handles cursor walk)
  slim-asset.ts            NEW  — pure: buildSlimRecipe(), buildSlimConnection()
  strip-secrets.ts         NEW  — pure: stripConnectionSecrets(value)
  index.ts                 MODIFY — re-export 4 new tool singletons
  (existing v1 files untouched)

  Future-tool stubs added in same dir:
  create-connection.stub.ts  NEW  — documentation only, not registered

app/chrome-extension/tests/workato/
  slim-asset.test.ts       NEW  — fixture-driven, pure-fn tests
  strip-secrets.test.ts    NEW  — table-driven, covers all rule classes
```

**Files modified outside the `workato/` subfolder:** exactly two (same as v1):

1. `packages/shared/src/tools.ts` — append entries.
2. `app/chrome-extension/entrypoints/background/tools/workato/index.ts` — re-export. The upstream registry's `...workatoTools` spread picks them up automatically.

No manifest changes (still `<all_urls>` from v1), no bridge changes, no upstream-file edits beyond those two.

## 8. Error handling

Same typed-error surface as v1 (§8 of v1 design):

| Code                   | When                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| `TabNotFound`          | No `*.workato.com`/`*.workato.is` tab open                       |
| `MultipleWorkatoHosts` | Tabs span >1 distinct Workato host                               |
| `WorkatoApiError`      | 4xx/5xx from Workato (returns `stage`, `status`, `body_excerpt`) |
| `UnexpectedShape`      | 2xx response but expected keys missing                           |
| `BridgeUnavailable`    | Extension service worker not responding                          |

Per-tool `failure.stage` values:

- search_recipes / search_connections: `'search'` | `'shape'`
- get_connection: `'fetch'` | `'shape'`
- list_jobs: `'meta'` | `'page'` | `'shape'`

## 9. Tests

**Unit (Vitest):**

`strip-secrets.test.ts` — 12-15 cases:

- Exact key match (`auth_token`, `password`, `client_secret`)
- Suffix match (`api_secret_key`, `webhook_signature`)
- Prefix match (`encrypted_blob`, `hashed_password`)
- Negative: `signing_key_algorithm` is kept
- Negative: `recipe_count` (numeric field with non-secret name) is kept
- Nested object recursion (secret inside `auth.tokens.access_token`)
- Arrays of objects
- Value-shape guard: a JWT string under an innocuous key is stripped
- Value-shape guard: a long hex string is stripped
- Value-shape guard: an ordinary URL string is kept (e.g. `instance_url: 'https://...'`)

`slim-asset.test.ts` — fixture-based:

- `buildSlimRecipe` given a real recipe item from `/web_api/mixed_assets.json`
- `buildSlimConnection` given a real connection item
- Missing optional fields (e.g. `last_run_at: null`) default sensibly
- Per-item numeric/string/boolean coercions match v1's pattern

No unit tests for tool `execute()` methods — same call as v1. Mocking the dispatch chain adds little when the logic lives in pure helpers that ARE tested.

**Manual smoke test gate** (documented in README; run before declaring v1.1 done):

1. `workato_search_recipes({ text: "<known recipe name>" })` → count matches, slim shape includes the recipe.
2. `workato_search_recipes({})` → first 20 recipes, `count` reflects workspace total.
3. `workato_search_recipes({ page: 2 })` → distinct items from page 1.
4. `workato_search_connections({ text: "salesforce" })` → matches restricted by connection name.
5. `workato_get_connection({ connection_id: <known id> })` → `provider` correct, `config` present, **zero secret-shaped values** (grep output for entries matching the denylist patterns).
6. `workato_get_connection({ connection_id: <id>, full: true })` → still no secrets reach the response.
7. `workato_list_jobs({ recipe_id: <id>, limit: 50 })` → 50 jobs returned (auto-walked 2 pages), `next_cursor` set if more exist.
8. `workato_list_jobs({ recipe_id: <id>, status: 'failed' })` → `scope` < `total`, only failed jobs returned.
9. `workato_list_jobs({ recipe_id: <id>, cursor: <prev_next_cursor> })` → resumes from cursor.
10. Provider audit: for each adapter type in the workspace (salesforce, netsuite, sftp, sap, pgp, rest, onprem_files, azure_blob_storage, steelbrick, workato_app), call get_connection and confirm strip catches all sensitive values.

## 10. Non-goals

- Write tools (push, soql, schema-derive, create-connection) — captured as `.stub.ts` documentation.
- Server-side state filter for recipes (running vs stopped) — Workato doesn't expose it; agents filter client-side on per-item `running:boolean`.
- Server-side provider filter for connections — same; filter client-side on `provider`.
- Per-provider typed config schemas for `get_connection` — denylist is the v1.1 approach; per-provider safety is a v1.2+ concern.
- Project / folder listing tools — adjacent but not on the v1.1 critical path. Captured as a future-tool stub.
- Multi-region tab disambiguation, caching, tab manipulation — same non-goals as v1.
- Auto-walk on searches — agents step through `page=` explicitly. Auto-walk only for jobs because cursor pagination is genuinely awkward.

## 11. Open questions to resolve during implementation

1. The exact set of provider-specific secret key names beyond the denylist. Probe `/connections/<id>.json` for each provider type and audit.
2. Whether `started_at` window filter on jobs actually fires when the dataset spans the window boundary. The test recipe's jobs all fit in the smallest window; needs a recipe with older history.
3. Whether `query=` on jobs matches title only, error message only, or both. Substring or token? Useful for documenting the tool input precisely.
4. Whether Workato returns provider-specific fields under a stable `input` key, or scattered at top level. Affects how the slim `config` field is composed.

None of these block v1.1 shipping — they're refinements after.
