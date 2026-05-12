# v1.1 discovery endpoints — reverse-engineering notes

**Date:** 2026-05-12
**Status:** Endpoints captured, ready to brainstorm v1.1 tool surfaces.
**Companion spec:** `2026-05-11-workatomcp-design.md` (v1, shipped).

Three endpoints reverse-engineered for the v1.1 discovery toolset:

- `workato_search_recipes` — `GET /web_api/mixed_assets.json?asset_type=recipe`
- `workato_search_connections` — same endpoint with `asset_type=connection`
- `workato_get_connection` — `GET /connections/<id>.json`
- `workato_list_jobs` — `GET /web_api/recipes/<id>/jobs.json`

Captured live against a real Workato workspace at app.workato.com using the v1 bridge's own `chrome_network_capture` + `chrome_javascript` tools.

---

## 1. Recipe search — `/web_api/mixed_assets.json`

**Method:** `GET`
**Path:** `/web_api/mixed_assets.json`
**Auth:** session cookies (same as v1 tools). No CSRF required for GET.
**Headers:** `accept: application/json`, `x-requested-with: XMLHttpRequest`.

### Query parameters

| Param        | Type   | Behavior                                                                                                                                                                                                               |
| ------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`       | string | Name substring search across the workspace. Empty / omitted returns all. `text=Roman` → 1 hit; `text=zzzqqq` → 0 hits.                                                                                                 |
| `folder_id`  | number | Scope results to one folder. Omit for workspace-wide.                                                                                                                                                                  |
| `asset_type` | string | **Singular.** `asset_type=recipe` → 2044 recipes; `asset_type=connection` → 172 connections. Omitting yields the mixed total (2216). Without this filter, sort terms like `updated_at` surface non-recipes first.      |
| `page`       | number | 1-based pagination. Verified `page=1/2/3` return distinct items. **Use this — cursor params don't work here.**                                                                                                         |
| `sort_term`  | string | `latest_activity` (default), `name` (alphabetical, verified — first item changes to `[1a] MeteorMulticash Cloud`), `updated_at`, `created_at`, `failed_count`. The last three look like aliases for the same ordering. |
| `per_page`   | number | **Accepted but silently ignored** — server always returns 20. Advance `page=` to paginate.                                                                                                                             |

**Silently ignored params** (all return HTTP 200 but don't change results — do not use):
`offset_id`, `offset_asset_id`, `type`, `kind`, `asset_types` (no `[]`), `asset_types[]` (the bracketed form was a guess that doesn't work — singular `asset_type` is the live name), `q[asset_type]`, `state`, `states[]`, `q[state]`, `recipe_state`, `recipe_status`, `running`, `is_running`, `enabled`, `active`, `started`, `flow_state`, `status`, `trigger_application`, `q[trigger_application]`.

**No server-side state filter is exposed.** The response includes `running: boolean` per item, so agents that need only-running or only-stopped recipes must filter client-side after fetching. Verified: in a default page of 20 recipes, 9 were running and 11 were not.

### Response shape

```json
{
  "result": {
    "items": [ {<asset>}, ... ],
    "count": <total matches across all pages>,
    "page": <current page>,
    "per_page": 20
  }
}
```

### Per-item (`asset`) shape — 24 keys

| Key                                                                                 | Type          | Notes                                                                       |
| ----------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------- |
| `id`                                                                                | number        | Recipe id (use with `workato_pull_recipe` / `workato_list_jobs`).           |
| `name`                                                                              | string        | Recipe name (what we search by).                                            |
| `folder_id`                                                                         | number        | Folder it lives in.                                                         |
| `project_id`                                                                        | number        | Parent project.                                                             |
| `asset_type`                                                                        | string        | `"recipe"` for our case; folders/projects can hold other types.             |
| `state`                                                                             | string        | Recipe lifecycle state.                                                     |
| `running`                                                                           | boolean       | Is the recipe started/active?                                               |
| `last_run_at`                                                                       | ISO timestamp | Last execution.                                                             |
| `stopped_at`                                                                        | ISO timestamp | When it was last stopped, if applicable.                                    |
| `created_at`, `updated_at`                                                          | ISO           | Self-explanatory.                                                           |
| `job_succeeded_count`, `job_failed_count`                                           | number        | Lifetime counts.                                                            |
| `trigger_application`                                                               | string        | E.g. `salesforce`.                                                          |
| `trigger_business_object`                                                           | string        | E.g. `new_custom_object`.                                                   |
| `action_applications`                                                               | string[]      | Adapters used in action steps.                                              |
| `tags`                                                                              | array         | Tag refs.                                                                   |
| `to_param`                                                                          | string        | Slug used in `/recipes/<id>-<to_param>` URLs.                               |
| `allowed_operations`                                                                | array         | Permissions hint for UI; not load-bearing for our tool.                     |
| `latest_activity`                                                                   | object        | Recent activity feed entry.                                                 |
| `deleted_at`, `deleted_by_name`, `permanently_deleted_at`, `deleted_from_folder_id` | mixed         | Soft-delete metadata.                                                       |
| `highlights`                                                                        | array         | **Only present when `text=` is set** — match snippets for the UI to render. |

### Example slim shape for `workato_search_recipes`

Most agent use cases need a small subset. Recommended slim shape:

```ts
{
  count: number,                                   // total across all pages
  page: number,
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
  }>
}
```

Pass `full: true` for the raw `result` object including all 24 per-item keys.

### Open questions to resolve during v1.1 brainstorm

- Does `sort_term` accept `name`, `created_at`, `failed_count`? Probe before settling on a tool surface.
- Is there a `status_filter` (running vs stopped vs failing)? Not probed.
- Workspace size matters — this user has 2216 assets. Pagination ergonomics: agents will mostly want `count` + first page, not 100+ page deep dives.

---

## 2. Job listing — `/web_api/recipes/<recipe_id>/jobs.json`

**Method:** `GET`
**Path:** `/web_api/recipes/<recipe_id>/jobs.json`
**Auth:** session cookies. No CSRF for GET.
**Headers:** `accept: application/json`, `x-requested-with: XMLHttpRequest`.

### Query parameters

| Param                                                    | Type    | Behavior                                                                                                                                                                             |
| -------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `per_page`                                               | number  | Default 25. Verified `per_page=3` → returned 3.                                                                                                                                      |
| `offset_job_id`                                          | string  | **Cursor pagination.** Pass the `id` of the last job in the previous page. Server returns the next slice (older jobs). Pair with `prev=false` (forward) or `prev=true` (backward).   |
| `prev`                                                   | boolean | Direction for `offset_job_id`. `prev=false` advances forward (older jobs), `prev=true` backward (newer).                                                                             |
| `status`                                                 | string  | **Singular.** `status=failed` → returns only failed jobs, with `job_scope_count` reflecting the filtered total (e.g. 2 of 52). `statuses[]=` and `job_status=` are silently ignored. |
| `group_by_master_job`                                    | boolean | Collapse retry chains under their master job when `true`. UI default is `false`.                                                                                                     |
| `started_at`                                             | string  | Time window. UI sends `30.days`; `7.days` and `all` also accepted. Filter not yet observed firing (test dataset was within the smallest window).                                     |
| `query`                                                  | string  | Full-text search against job title/error. Empty is a no-op; `query=anything` returned `scope=0`, confirming the filter is live. Match semantics not yet characterized.               |
| `offset`, `page`, `since_id`, `statuses[]`, `job_status` | —       | **Accepted but silently ignored.** Use the params above instead.                                                                                                                     |

**Pagination algorithm:** request `?per_page=25`, read `jobs[]`. If `jobs.length < per_page`, you've reached the end. Otherwise take the last job's `id` and re-fetch with `?per_page=25&offset_job_id=<that_id>&prev=false`. Repeat. `job_count` is the total (unfiltered) and `job_scope_count` is the total under the current filter — use the latter to compute total pages. Verified end-to-end against a 52-job recipe: 25 + 25 + 2 = 52 ✓.

### Response shape

```json
{
  "job_count": <total>,
  "job_scope_count": <same as job_count when no filter>,
  "job_succeeded_count": <lifetime>,
  "job_failed_count": <lifetime>,
  "job_offset_count": <offset of returned slice>,
  "job_per_page": <returned slice size>,
  "jobs": [ {<job>}, ... ]
}
```

### Per-job shape — 21 keys

| Key                                   | Type           | Notes                                                                                                                                                       |
| ------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                  | string         | Job id (use with `workato_job_trace`). Format `j-XxXxXx-XxXxXx-CD`.                                                                                         |
| `master_job_id`                       | string \| null | Set when a job is a retry of an earlier one.                                                                                                                |
| `recipe_id`                           | number         | Echo of the recipe id.                                                                                                                                      |
| `title`                               | string         | Human title (e.g. "Salesforce: new asset: Asset Name=...").                                                                                                 |
| `status`                              | string         | `"succeeded"` \| `"failed"` \| etc.                                                                                                                         |
| `started_at`                          | ISO            | When the run began.                                                                                                                                         |
| `completed_at`                        | ISO            | When it finished.                                                                                                                                           |
| `repeat_count`                        | number         | Retry count.                                                                                                                                                |
| `is_repeat`                           | boolean        | Is this a retry of a prior job?                                                                                                                             |
| `is_repeatable`                       | boolean        | Can a user retry from the UI?                                                                                                                               |
| `is_cancellable`                      | boolean        | Can a running job be cancelled?                                                                                                                             |
| `is_test`, `is_test_case_job`         | boolean        | Test-job flags.                                                                                                                                             |
| `error`                               | object \| null | When `status === "failed"`, contains `message`, `error_type`, `line_number`, `adapter`, `action`, `error_at`, `error_id`, `inner_message`, `http_response`. |
| `report.custom_column_0/1/2`          | string         | Recipe-defined trace columns (UI-configurable).                                                                                                             |
| `calling_job_id`, `calling_recipe_id` | string \| null | If invoked by another recipe.                                                                                                                               |
| `root_job_id`, `root_recipe_id`       | string \| null | Top of the call chain.                                                                                                                                      |
| `erased`                              | boolean        | Has the job's data been erased (retention policy)?                                                                                                          |
| `zero_retention`                      | boolean        | Was the job run with zero data retention?                                                                                                                   |

### Example slim shape for `workato_list_jobs`

```ts
{
  total: number,
  succeeded: number,
  failed: number,
  jobs: Array<{
    id: string,
    status: string,
    started_at: string,
    completed_at: string,
    duration_ms: number,                      // computed
    error_summary?: string,                   // error.message if failed
    title: string,
    report: { col_0: string, col_1: string, col_2: string },  // renamed for clarity
  }>
}
```

Pass `full: true` for the raw response.

### Open questions

- `started_at` window filter behavior — need a recipe with old jobs to confirm it actually narrows.
- `query=` match semantics — does it match title only, error message only, or both? Substring or token?

---

## 3. Connections — list, search, and get single

Connections use **the same endpoint as recipes** for listing/searching, plus a separate legacy route for fetching a single connection.

### 3.1 List / search connections — `/web_api/mixed_assets.json?asset_type=connection`

Same endpoint, same params, same response envelope as recipe search. Override the type with `asset_type=connection`. Verified: 172 connections in the test workspace.

- `text=salesforce` → 14 hits (matches connection NAMES, not provider field).
- `provider=`, `adapter=`, `provider_name=` are all silently ignored — there is no server-side filter by adapter. Filter client-side on the response's `provider` field.

### Connection per-item shape — 18 keys

| Key                                              | Type        | Notes                                                                                                                                                                                             |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                             | number      | Connection id (use with `workato_get_connection`).                                                                                                                                                |
| `name`                                           | string      | Display name.                                                                                                                                                                                     |
| `provider`                                       | string      | Adapter type. Observed in this workspace: `salesforce`, `netsuite`, `sftp`, `sap`, `pgp`, `rest`, `onprem_files`, `azure_blob_storage`, `steelbrick`, `workato_app`. Many more exist server-wide. |
| `folder_id`, `project_id`                        | number      | Containing folder + project.                                                                                                                                                                      |
| `asset_type`                                     | string      | Always `"connection"` for items returned with `asset_type=connection`.                                                                                                                            |
| `updated_at`                                     | ISO         | Last modification.                                                                                                                                                                                |
| `authorization_status`                           | string      | Auth state (e.g. `"success"`, `"failed"`).                                                                                                                                                        |
| `authorized_at`                                  | ISO \| null | When auth was last refreshed.                                                                                                                                                                     |
| `recipe_count`                                   | number      | How many recipes reference this connection. Useful for impact analysis before disabling.                                                                                                          |
| `connection_lost_at`, `connection_lost_reason`   | mixed       | Set when the connection becomes invalid.                                                                                                                                                          |
| `genie_count`, `proxy_api_endpoints_count`       | number      | Counts of dependent assets (AI agents, API proxies).                                                                                                                                              |
| `alr_connection`, `traffic_mirroring_connection` | boolean     | Feature flags — usually false. Not load-bearing for v1.1.                                                                                                                                         |
| `tags`                                           | array       | Tag refs.                                                                                                                                                                                         |
| `latest_activity`                                | object      | `{event_type, timestamp, user_name}`. Useful for "who touched this last".                                                                                                                         |

### 3.2 Get single connection — `/connections/<id>.json`

```
GET /connections/<id>.json
```

**Important — legacy route, not under `/web_api/`.** `/web_api/connections/<id>.json` returns `404 "The action 'show' could not be found for WebApi::SharedAccountsController"`. Use the unprefixed `/connections/<id>.json`.

Auth: session cookies. No CSRF for GET. Headers: `accept: application/json`, `x-requested-with: XMLHttpRequest`.

Response envelope: `{result: {<connection>}}` — the connection object is significantly richer than the list shape. Confirmed keys include `id`, `name`, `provider`, `created_at`, `authorized_at`, `authorization_status` (and presumably the full auth/config payload). Don't return `input` (credentials) verbatim — see safety note below.

### Example slim shape for `workato_search_connections`

```ts
{
  count: number,
  page: number,
  connections: Array<{
    id: number,
    name: string,
    provider: string,                   // adapter type
    folder_id: number,
    project_id: number,
    recipe_count: number,               // dependency impact
    authorization_status: string,
    authorized_at: string | null,
    connection_lost_at: string | null,
    updated_at: string,
  }>
}
```

Pass `full: true` for the 18-key per-item shape.

### Example slim shape for `workato_get_connection`

```ts
{
  id: number,
  name: string,
  provider: string,
  created_at: string,
  authorized_at: string | null,
  authorization_status: string,
  folder_id: number,
  project_id: number,
  recipe_count: number,
  // Connection-config fields (per-provider; e.g. salesforce host, netsuite account_id).
  // Stripped of secrets — see safety note.
}
```

### Safety: connection secrets

Connection records contain authentication material (OAuth tokens, API keys, signed JWTs). The Workato UI hides them, but the JSON response may surface them under keys like `auth_token`, `client_secret`, `password`, `refresh_token`, etc. **The `workato_get_connection` tool MUST strip these before returning to the agent.** Recommended allowlist approach: only emit the keys listed in the slim shape above; everything else discarded by default. `full: true` should still strip secret-shaped keys — never trust an agent to handle them.

### Open questions for v1.1 brainstorm

- Should we have one combined `workato_search_assets({ asset_type, ... })` tool, or split into `workato_search_recipes` + `workato_search_connections`? Splitting gives narrower typed shapes per tool.
- For `workato_get_connection`, what's the right secret allowlist? Probe `/connections/<id>.json` for a salesforce + netsuite connection and audit the response keys.

---

## 4. Notes for tool implementations

Both endpoints follow v1's "fetch in MAIN-world of an open Workato tab" pattern. The in-page functions for `workato_search_recipes` and `workato_list_jobs` should:

- **Not use `async`/`await`** (see [v1 pitfalls memory](../../../C--Work-Personal-WorkatoMCP/memory/reference_v1_pitfalls_resolved.md)). Plain functions returning `.then()` chains only.
- Reuse the `findWorkatoTab` + `runInWorkatoTab` helpers from `tab-dispatch.ts`.
- Follow the same `{ok, code/version/etc, failure: {stage, status, body_excerpt, message}}` in-page result shape as v1 tools.
- Be GET-only — no CSRF needed.

## 4. What to brainstorm

Before writing v1.1's plan:

1. **Tool surface for `workato_search_recipes`** — minimum useful arg set. Recommended: `{ query?, folder_id?, page? }` + `full?: boolean`.
2. **Tool surface for `workato_list_jobs`** — recommended: `{ recipe_id, per_page? }` + `full?: boolean`. Maybe a `failed_only?: boolean` once we figure out the filter param.
3. **Whether to bundle a "find a recipe by exact name and return its id" helper** as a separate tool, or punt and let agents call search → pick first match → call other tools.
4. **Pagination ergonomics** — `per_page` doesn't work for either endpoint. Agents will mostly want "first page + total count" — page navigation is a v1.2 concern.
