# WorkatoMCP — v1.2 design

**Date:** 2026-05-12
**Status:** Draft (autonomous implementation requested by user)
**Repo:** `C:\Work\Personal\WorkatoMCP` (commit base: v1.1.0 tag at `5039b88`)
**Companion docs:**

- v1 design: `2026-05-11-workatomcp-design.md`
- v1.1 design: `2026-05-12-workatomcp-v11-design.md`
- v1.1 endpoint research: `2026-05-12-v11-discovery-endpoints.md`

## 1. Goal

Give agents two complementary tools that together unlock arbitrary read (and gated write) access to any SaaS connected to Workato — using the user's existing Workato session, no separate API tokens, no Workato official-API limits.

| Tool                  | Backed by                                 | What it does                                                                                                           |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `workato_run_query`   | `POST /utils/sample_to_schema.json`       | Run SOQL / SuiteQL / SQL against any connection; get back rows + field schema in a consistent shape                    |
| `workato_call_action` | `POST /connections/<id>/test_action.json` | Invoke any named action on any connector (HTTP custom action, native search, native upsert, etc.) with arbitrary input |

`workato_run_query` is a narrow, agent-friendly wrapper that returns a predictable `{schema, rows}` shape regardless of SaaS. `workato_call_action` is the universal escape hatch — any action that the recipe editor can run, this tool can run. The two are complementary, not redundant: one optimises for ergonomics on the most common case (read a SQL query), the other optimises for reach (run anything).

## 2. Endpoints, verified live

### 2.1 `POST /utils/sample_to_schema.json` — schema-derivation passthrough

Captured live during recipe-editor SuiteQL Test:

**Request body:**

```json
{
  "sample": "SELECT email, COUNT(*) as count FROM transaction GROUP BY email",
  "type": "suiteql",
  "shared_account_id": 784927
}
```

**Response (success):**

```json
{
  "result": {
    "schema": [
      { "control_type": "text", "label": "Email", "type": "string", "name": "email" },
      { "control_type": "text", "label": "Count", "type": "string", "name": "count" }
    ],
    "sample": [
      { "email": "...", "count": "32" },
      ...   // up to ~100 rows, server-capped
    ]
  }
}
```

**Response (connector error):** HTTP 200 with `{"error": "<message>"}`. SOQL parser errors, NetSuite query errors, auth failures, etc. all surface here.

**Known quirks:**

- Server auto-appends `LIMIT 100` to SOQL queries. User-supplied `LIMIT N` in a SOQL query collides → `LIMIT N LIMIT 100` → Salesforce parser error. Tool MUST strip user-supplied `LIMIT` clauses from SOQL queries before submitting.
- `type` values observed: `soql`, `suiteql`, `sql` (only some adapters), `csv`/`xml`/`json` (sample-parsing modes, not connector-driven — out of scope here).
- CSRF required. Use the decoded `XSRF-TOKEN-V2` cookie value via the existing `csrf.ts` helper pattern.
- Workato logs every call. Document; don't loop tight.

### 2.2 `POST /connections/<id>/test_action.json` — universal action runner

Captured live for two action types:

**HTTP custom action on Salesforce (connection 14474811):**

```json
{
  "name": "__adhoc_http_action",
  "input": {
    "mnemonic": "Custom action",
    "response_type": "json",
    "verb": "get",
    "path": "services/data",
    "inspect": true
  }
}
```

Response: real Salesforce API response wrapped in `{"result": {...}}`. 3,439 bytes returned in the test.

**Native SuiteQL action on NetSuite (connection 784927):**

```json
{
  "name": "execute_suiteql",
  "input": {
    "query": "SELECT id, tranid FROM transaction WHERE rownum < 3"
  }
}
```

Response:

```json
{
  "result": {
    "links": { "self": "https://6403833-sb2.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=100&offset=0" },
    "count": 2,
    "hasMore": false,
    "items": [ { "id": "1556856", "tranid": "CM-IE-3384" }, ... ],
    "totalResults": 2
  }
}
```

**Known facts:**

- Body shape is universal: `{name, input}`. `name` is the action identifier; `input` is action-specific JSON.
- Response wrapper is `{result: <native shape>}` on success, `{error: <message>}` on failure (HTTP 200 either way).
- Action names are discoverable via existing v1 `workato_pull_recipe` — every recipe step's `name` field is a valid action_name.
- CSRF required.
- Power level: this endpoint can do anything a recipe step can do, including writes. `add_record`, `upsert_record`, `delete_record`, custom HTTP verbs like `POST`/`PUT`/`DELETE` — all reachable. Safety gating mandatory.

## 3. Tool surfaces

### 3.1 `workato_run_query`

```ts
input: {
  connection_id: number,        // shared_account_id (from search_connections or recipe.version.config)
  query: string,                // SOQL, SuiteQL, or SQL — depends on connection adapter
  type: 'soql' | 'suiteql' | 'sql',
  schema_only?: boolean,        // drop the rows array, keep only schema (default false)
  full?: boolean,               // raw {result: {...}} instead of slim (default false)
}

output (slim, default): {
  type: string,                 // echo of input type
  count: number,                // rows.length (≤ 100 due to server cap)
  truncated_to_100: boolean,    // count === 100 → likely truncated; agent should narrow
  schema: Array<{
    name: string,
    label: string,
    type: string,               // 'string' | 'integer' | 'boolean' | ...
    control_type: string,       // UI hint
  }>,
  rows?: Array<Record<string, unknown>>,   // omitted when schema_only=true
}

output (full=true): the raw `result` object from sample_to_schema.json
```

**SOQL LIMIT-stripping:** Before sending, the tool removes any trailing `LIMIT N` clause (case-insensitive, allows whitespace) from the query. Reason: Workato auto-appends `LIMIT 100`, and a user-supplied `LIMIT 5` collides → `LIMIT 5 LIMIT 100` → Salesforce 422. SuiteQL and SQL queries are passed through unmodified.

**Error mapping** (slim shape; errors are MCP errors, not embedded in output):

- HTTP non-2xx → `WorkatoApiError` with status + body excerpt
- HTTP 200 + `{error: "..."}` in body → `WorkatoConnectorError: <message>` (clearly distinguishes server-side query/auth errors from tool/transport errors)
- HTTP 200 + missing `result.schema` or `result.sample` → `UnexpectedShape`

### 3.2 `workato_call_action`

```ts
input: {
  connection_id: number,
  action_name: string,          // e.g. '__adhoc_http_action', 'execute_suiteql', 'search_sobjects_soql_v2'
  input: Record<string, unknown>,
  allow_writes?: boolean,       // default false; required to bypass the safety gate
  full?: boolean,               // raw response shape vs. unwrapped result; default false
}

output (slim, default): {
  action_name: string,
  result: unknown,              // the `result` key of the Workato response — native SaaS shape
}

output (full=true): the entire response envelope including {result} or {error}
```

**Safety gate.** The tool refuses by default any action that looks like a write, unless caller explicitly passes `allow_writes: true`.

Action is considered a **read** (allowed by default) when ALL of:

- `action_name` starts with one of: `search_`, `get_`, `list_`, `query_`, `find_`, `describe_`, `read_`, `fetch_`
- OR `action_name` is exactly `execute_suiteql`
- OR `action_name` is exactly `__adhoc_http_action` AND `input.verb?.toLowerCase()` is `get`, `head`, or `options`

Anything else (`add_record`, `update_record`, `upsert_record`, `delete_record`, `create_*`, `set_*`, `__adhoc_http_action` with `verb=post`, etc.) is considered a write and rejected with `WorkatoUnsafeAction: action_name='<x>' looks like a write; pass allow_writes:true to proceed`.

This is deliberately a denylist-by-default approach. False positives (over-rejecting a safe action) are recoverable via `allow_writes: true`. False negatives (allowing a write through) are not — they could mutate production data.

**Error mapping** (same pattern as run_query):

- HTTP non-2xx → `WorkatoApiError`
- HTTP 200 + `{error: "..."}` → `WorkatoConnectorError`
- Unsafe action without `allow_writes` → `WorkatoUnsafeAction`

## 4. Repo layout

Two new files in the established `workato/` subfolder, two upstream files touched (same as v1/v1.1 pattern):

```
packages/shared/src/tools.ts
  + TOOL_NAMES.WORKATO.RUN_QUERY = 'workato_run_query'
  + TOOL_NAMES.WORKATO.CALL_ACTION = 'workato_call_action'
  + 2 TOOL_SCHEMAS entries

app/chrome-extension/entrypoints/background/tools/workato/
  run-query.ts          NEW — class + runQueryInPage()
  call-action.ts        NEW — class + callActionInPage() + isReadAction()
  index.ts              MODIFY — re-export the two new tool singletons

  (existing files untouched: tab-dispatch.ts, csrf.ts, pull-recipe.ts,
   job-trace.ts, slim-trace.ts, search-recipes.ts, search-connections.ts,
   get-connection.ts, list-jobs.ts, slim-asset.ts, strip-secrets.ts,
   *.stub.ts)
```

No tests in v1.2. The two pure-helper patterns this tool family uses (LIMIT-stripping for SOQL, write-gate predicate for call_action) are small enough to verify by manual smoke + by reading the code. If we discover correctness issues during smoke, we'll add tests in a follow-up — same call as v1's tool execute() methods.

## 5. CSRF handling

Both endpoints are POST → CSRF required. The in-page functions read `XSRF-TOKEN-V2` from `document.cookie`, URL-decode it, send it as `x-csrf-token` header. The existing `csrf.ts` helper (added in v1 Task 5, unused until now) is the model — but the helper is meant to be called by an in-page function, not from background. We'll inline the decode in each new in-page function (4 lines) rather than importing csrf.ts, because in-page functions can't import (they're serialised standalone). This mirrors how the v1 in-page functions handled their own self-contained scope.

## 6. Pitfalls carried over from v1/v1.1

1. **In-page functions MUST be plain `function`s** returning `.then()` chains — never `async function` declarations. WXT/Vite would otherwise emit a sync wrapper calling a hoisted `_<name>` helper that doesn't survive `.toString()` serialisation. Already documented in `reference_v1_pitfalls_resolved.md`.
2. **Module-scope constants referenced inside in-page functions also don't survive serialisation.** Declare any constants the in-page function needs (PER_PAGE, write-action allowlist regex, etc.) INSIDE the function body. Bit v1.1 Task 7; pre-empt here.
3. **Cookies/CSRF must be read inside the in-page function** (it runs in MAIN world via `chrome.scripting.executeScript`, so `document.cookie` is the page's cookie jar). Don't try to pass CSRF from the background; it changes per session.

## 7. Non-goals for v1.2

- **`workato_describe_action`** — tempting (it'd be backed by `extended_schema.json`), but the live capture showed the endpoint is unreliable: returns empty schema for valid action names like `execute_suiteql`. Until we understand when it works, it'd ship more confusion than value. Defer to v1.3.
- **Provider-specific helpers** like `workato_soql(query)` or `workato_suiteql(query)`. The generic `run_query` covers both with one tool surface and consistent ergonomics.
- **Action discovery / catalog tooling.** Action names come from pulling a representative recipe and reading step `.name` fields — that's existing v1 capability and doesn't need a new tool.
- **Pagination over the 100-row cap on `sample_to_schema.json`.** The endpoint is server-capped; agents that need more must narrow via WHERE clauses on Id ranges or date windows. Documented in tool description; not enforced.
- **Per-provider write allowlists.** The safety gate is universal (read-prefix heuristic + HTTP verb check). If specific providers need finer-grained rules in the future, that's a v1.3 concern.

## 8. Open questions, captured for v1.3+

1. Does `extended_schema.json` reliably describe actions for OTHER action names (e.g. `add_record`, `search_records`)? Our SuiteQL probe returned empty; HTTP custom action probe returned a rich schema. Pattern unclear.
2. Is there a way to enumerate the action_names available on a given connection without inspecting a recipe? The closest we've found is `extended_schema.json` per action_name, which only works for the action you already know exists.
3. Does the `sample_to_schema.json` endpoint accept `type: 'sql'` for any database adapters (Postgres, MySQL)? NetSuite SOAP rejected it; needs probing against an actual DB connection.
4. Workato has an "On-behalf-of user email" input field on SFDC HTTP custom action — JWT connections only. Doesn't affect v1.2 but worth a note for any future per-call-impersonation feature.
