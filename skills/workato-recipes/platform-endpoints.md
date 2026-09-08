# Workato platform endpoints (live-verified)

Captured live on **2026-09-07** in a **Development environment** workspace, by four probe agents driving a logged-in browser session. Every request and response shape below was observed, not inferred from documentation. Workato publishes no contract for these routes; treat this file as the record of what the web app actually does, and re-probe before relying on anything marked unverified.

**How to use it.** Most of these endpoints already have a tool, named in each section. Reach for `workato_api_request` only for the ones that do not. It is same-origin (a `path` on the Workato host, never a URL elsewhere), it sends `x-requested-with: XMLHttpRequest` on every call, and it attaches `x-csrf-token` from the `XSRF-TOKEN-V2` cookie on writes. Anything other than GET or HEAD needs `allow_writes: true`, and a non-GET call verifies the pinned workspace first.

Arguments: `method`, `path`, `query`, `body`, `headers`, `allow_writes`, `out_file`, `max_bytes`, `tabId`, `timeout_ms`.

Two path shapes coexist. `/web_api/...` is the app's own JSON API; a 404 there usually means the tab is in the wrong workspace or environment, not that the object is missing. A handful of routes (`/recipes/...`, `/connections/...`, `/dependency_graphs/...`) sit at the top level instead. Both are given verbatim below.

- [Jobs](#jobs)
- [Job detail and trace](#job-detail-and-trace)
- [Dependency graphs: callers, callees, assets](#dependency-graphs-callers-callees-assets)
- [Asset search](#asset-search)
- [Recipe metadata, code, status and state](#recipe-metadata-code-status-and-state)
- [Start and stop](#start-and-stop)
- [Test execution](#test-execution)
- [Connections](#connections)
- [Event Streams (pub/sub) topics](#event-streams-pubsub-topics)
- [Account and project properties](#account-and-project-properties)
- [Activity and queue](#activity-and-queue)
- [Routes that do not exist](#routes-that-do-not-exist)

---

## Jobs

**What it is for.** Every job list in the product: the recipe Jobs page, its search box, the period presets, the custom date range and the status filter all call this one endpoint.

**Request**

```
GET /web_api/recipes/<recipe_id>/jobs.json
```

Required header: `x-requested-with: XMLHttpRequest`.

| Param                                                  | Behaviour                                                                                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `per_page`                                             | Integer, clamped server-side to a **maximum of 25**                                                                                                                                 |
| `offset_job_id` + `prev`                               | The cursor. `prev=false` walks older, `prev=true` walks newer                                                                                                                       |
| `offset_count=true`                                    | Adds `job_offset_count`, the position of `offset_job_id`                                                                                                                            |
| `status`                                               | Singular: `succeeded`, `failed`, `pending`, and so on                                                                                                                               |
| `query`                                                | **Contiguous case-insensitive SUBSTRING over the job id and custom report column values only.** Not the error text, not the job title in any observed case, and never an erased job |
| `started_at`                                           | Only `1.hour`, `24.hours`, `7.days`, `30.days`, `all`. **Any other value is silently ignored** and the unfiltered scope comes back, which reads as "no such jobs"                   |
| `started_at_from` / `started_at_to`                    | The custom range. ISO-8601 with an offset, `Z`, or a bare `YYYY-MM-DD`. Each filters server-side and each works alone                                                               |
| `group_by_master_job`                                  | Boolean                                                                                                                                                                             |
| `test_jobs_only`, `reruns_only`, `test_case_jobs_only` | Booleans behind the UI's "All types" filter                                                                                                                                         |

**Response**

```
{ job_count, job_scope_count, job_offset_count, job_per_page,
  job_succeeded_count, job_failed_count,
  jobs: [ { id, master_job_id, recipe_id, calling_job_id, calling_recipe_id,
            root_job_id, root_recipe_id, title, status, is_repeat,
            zero_retention, is_test, is_test_case_job,
            started_at, completed_at, repeat_count,
            erased, is_repeatable, is_cancellable,
            report, error? } ] }
```

`job_count` is every job; `job_scope_count` is the filtered count. `report` is `{}`, `{custom_column_N: value}`, or `null` when erased. `error` (`{error_id, error_type, error_type_id, error_at, adapter, action, line_number, message, inner_message, http_response}`) appears only on kept failed jobs.

**Erased semantics.** A job swept by data retention stays in the list with `erased: true`, `report: null`, `title: ""` and **no `error` key even when it failed**. So unavailable data and empty data look identical unless the caller reads `erased`. The sweep is **workspace-wide and monotonic**: everything older than the boundary is erased too, verified across five recipes. Scanning past three consecutive erased jobs spends pages for nothing.

**The boundary MOVES. Do not cache it as a date.** The sweep is periodic, not continuous, and it advances between reads. The first capture on 2026-09-07 put the boundary around Jul 16 to Jul 20 despite a 30-day retention setting; by 19:45 UTC the same day, a job from **2026-08-03** on recipe 72988590 was already erased. Any date derived from a scan is a fact about that scan, not about the workspace, and must be reported that way rather than reused later.

**Report columns.** Keys are `custom_column_0` to `custom_column_9`. The labels are not in the job payload: they live on the **trigger node of the recipe code**, as `job_report_schema: [{name, label}]` and `job_report_config: {custom_column_N: "text or #{_dp(...)}"}`. Read them from the recipe version the jobs ran under.

**Tool.** `workato_list_jobs` wraps all of it: `query` for the server search, `match` for a local scan over id, title, error and report columns, `started_from` / `started_to` / `timezone` for the range, `scan_budget` for the walk, `fields` for a projection, and `coverage` for what was actually looked at.

## Job detail and trace

**What it is for.** One job's own record, and the per-step trace behind it.

```
GET /web_api/recipes/<recipe_id>/jobs/<job_id>
```

Response: `{result: {job: {id, master_job_id, title, status, is_test, started_at, completed_at, erased, debug_trace, is_cancellable, is_repeatable, has_history, stats: {action_count}, dynamic_connections}, recipe: {id, name, applications, code, config, version_no, last_run_at, project_id, ...}, recipe_folders, job_lines_v2_available}}`.

`recipe.code` is the **stringified tree**, including `job_report_schema` and `job_report_config` on the trigger, which makes this a large payload. It works for erased jobs too.

```
GET /web_api/recipes/<recipe_id>/jobs/<job_id>/line_details?stringify_big_numbers=true
```

Response: `{line_details: [...], lines_truncated: bool, kms_error: null}`. **For an erased job `line_details` is `[]`**, which is indistinguishable from a job that genuinely ran nothing unless the job metadata is read first.

**Tool.** `workato_job_trace`. It reads the metadata first, so an erased job returns `{erased: true, zero_retention?, note, recipe, status, started_at, completed_at}` rather than a zero-step trace. `paths`, `empty`, `max_items` and `fields` project the rest.

## Dependency graphs: callers, callees, assets

**What it is for.** THE dependents endpoint. It is what the Operations hub dependency page draws, it is workspace-wide, and it costs one request.

**Request**

```
GET /dependency_graphs/<asset_id>.json?asset_type=recipe
```

Note the top-level path: this is **not** under `/web_api`. `asset_type` accepts `recipe`, `lookup_table`, `connection`, `lcap_page`, `lcap_app`, `account_property`, `provider`.

**Response**

```
{ result: { paths:  [ {from_type, from_id, to_type, to_id} ],
            objects: [ {type, id, name, active, folder_id, parent_id,
                        handle, provider, provider_id, provider_type, root?} ] } }
```

`type` is `Flow`, `LCAP::Models::Page`, `LookupTable` or `SharedAccount`. `active` is `1`, `0` or `null`.

**Callers of recipe X** are the paths with `to_type: "Flow"`, `to_id: X`, `from_type: "Flow"`. The same document also lists callees, connections, lookup tables and workflow-app pages.

**Related routes**

```
GET /dependency_graphs.json?asset_type=recipe&folder_id=<folder_id>
  -> {result: [[id, name], ...]}     folder_id is required; without it: 200 {"error":"Missing folder id"}
                                     This is the ONLY exact folder membership list: mixed_assets
                                     ignores folder_id entirely.

GET /dependency_graphs/types.json
  -> {result: ["provider","account_property","connection","lcap_app","lcap_page","lookup_table","recipe"]}

GET /dependency_graphs/all_flow_and_connection_providers.json
  -> {result: ["salesforce","netsuite_rest_connector_5105163_1745592003"]}
```

**Call steps.** `call_recipe` and `call_recipe_async` store the callee as `input.flow_id`, **a string**, under provider `workato_recipe_function`. That is what a code scan matches, and a `flow_id` built from a datapill or a formula cannot be resolved statically.

**Tool.** `workato_recipe_callers` combines the graph with a paged code scan and, optionally, `calling_recipe_id` from recent jobs.

**No tool** for the lookup-table graph. Paste:

```json
{ "method": "GET", "path": "/dependency_graphs/<lookup_table_id>.json?asset_type=lookup_table" }
```

and the same for `asset_type=connection`, `lcap_page`, `lcap_app`, `account_property`, `provider`.

## Asset search

**What it is for.** The assets page search box and the App filter.

```
GET /web_api/mixed_assets.json
```

| Param                                  | Behaviour                                                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`                                 | **Full text over the name, the description AND the recipe's own action and trigger titles.** This is why `ECO` matches a recipe whose steps say "New/updated records" |
| `page`, `per_page`                     | `per_page` is capped at 20                                                                                                                                            |
| `sort_term`                            | `latest_activity`, `name`, `relevance`, `created_at`, `updated_at`                                                                                                    |
| `asset_type=<t>` / `asset_types[]=<t>` | Asset kind                                                                                                                                                            |
| `adapters=a,b`                         | ANDed. The bracket form `adapters[]=` returns 500                                                                                                                     |
| `tags=<name>`                          | Tag filter                                                                                                                                                            |

**`folder_id` is IGNORED.** Re-probed on 2026-09-07 with four variants (`folder_id`, `folder_ids[]`, `fid`, `project_id`): every one returned the same workspace-wide list, spanning four different folders. This endpoint has no folder filter. An earlier note in this file called it "exact, non-recursive"; that was wrong, and a caller that trusts it will silently scan the whole workspace while believing it scanned one folder.

Also **ignored server-side** (each returns the unfiltered scope, silently): `q`, `name`, `running` / `state` / `status` / `active`, `application(s)` / `app` / `provider(s)`, `trigger_application(s)`, `user_ids` / `users` / `edited_by`, `project_id`, `include_recursive`, and every sort-direction parameter.

**The only exact folder membership list is the dependency-graph listing:**

```
GET /dependency_graphs.json?asset_type=recipe&folder_id=<folder_id>
  -> {result: [[recipe_id, name], ...]}
```

So a folder-scoped scan is: take the membership list from that endpoint (or walk `mixed_assets` and filter client-side on `item.folder_id`), and report which of the two was used. The tools do exactly that: `workato_recipe_step_search(folder_ids)`, `workato_recipe_callers` folder scopes, `workato_search_recipes(folder_id)` and `workato_recipe_save_with_dependents(scan_folder_id)` resolve folder membership through the dependency-graph listing or a client-side `folder_id` filter, and say so in their `coverage` / `scope`. Membership is per folder and exact: a subfolder is a separate folder id, which `workato_list_folders` enumerates.

**Response.** `{result: {items: [{asset_type, id, folder_id, name, updated_at, project_id, job_succeeded_count, job_failed_count, running, last_run_at, stopped_at, action_applications[], trigger_business_object, trigger_application, deleted_at, created_at, to_param, state, allowed_operations{start,stop,delete,restore,edit,clone}, highlights{name, description, actions[], applications[], application_titles}, tags[], latest_activity{user_name, event_type, timestamp}}], count, page, per_page}}`.

`highlights` is what matched, wrapped in `<span class="text-highlight">` markup.

**Tool.** `workato_search_recipes` (client-side `match` modes, `app`, `running`, a bounded page walk with `coverage`, and cleaned `matched` highlights) and `workato_recipe_step_search` (folder and recipe scopes, `input_query`).

## Recipe metadata, code, status and state

```
GET /recipes/<recipe_id>.json          (optionally ?mode=view)
```

Response: `{result: {recipe_data: {flow: {id, name, state, running, runnable, stop_reason, stopped_at, stopped_for_error, version_no, applications[], action_applications[], trigger_application, shared_account_ids[], config, job_report_config_errors[], has_trigger, recipe_type, job_*_count, last_run_at, parent_id, parent_name, root_parent_id, copy_count, trigger_type, worker_concurrency, ...}, allowed_operations, state, runtime_type, requirements_errors[], last_actionable_error, recipe_stop_error, running, testing, folders[], project_id, rtc_url}, workbot_path}}`.

`flow.config` is a **string-encoded JSON array**. **This document records nothing about a failed start.** `/web_api/recipes/<id>.json` is a 404: this route is top-level.

**Tool.** `workato_recipe_status`.

```
GET /recipes/<recipe_id>/code.json?mode=view
GET /recipes/<recipe_id>/code.json?mode=view&version_no=<n>
```

Response: `{result: {code: "<stringified tree>", ...}}`. Passing `version_no` pins the code to the version the metadata reported, so the two halves of a read describe the same snapshot rather than straddling a save.

**Tool.** `workato_pull_recipe`, which fetches the metadata first and then pins the code, and caches the pair by host, recipe and version.

```
GET /recipes/<recipe_id>/status.json
```

Response: `{flow: {id, last_run_at, stopped_at, state, running, testing, last_actionable_error}, allowed_operations{...}, latest_activity{user_name, event_type, timestamp}}`.

The cheap poll the recipe page uses. `flow.testing` is true while a test is pending or waiting. It carries no error detail.

```
GET /web_api/recipes/<recipe_id>/state.json
```

Headers: `x-requested-with: XMLHttpRequest`, `accept: application/json, text/plain, */*`.

Response:

```
{ state: "stopped" | "permanently_stopped" | "activating" | ...,
  error: null
       | {details: {code_errors, config_errors, param_errors, requirements_errors}}
       | {details: {message: "<string>"}} }
```

**This is the only start-failure diagnostic.** It is written by an activation attempt (a recipe that was never started reads `error: null`), it survives a later stop and even later saves, and the editor polls it right after the Start click.

`config_errors` arrives in **two different serializations** and both must be handled:

```
positional, on later reads:      [ [ <line>, [ [ <field>, <value>, <message> ] ] ] ]
object, right after activation:  [ { line_number, errors: [ { field_label, value, message } ] } ]
```

A bogus `account_id` written into `config` is rewritten to `null` on save, so the binding gap surfaces here as `account_id can't be blank` rather than at save time.

**Tool.** `workato_start_recipe` reads it after a non-flip and returns `start_error` with `config_errors` normalized to `[{line_number, field, value, message}]`. `workato_recipe_status` reports the same record as `activation`. `workato_stop_recipe` deliberately never reads it, because a stale start error would otherwise be reported as a stop failure.

## Start and stop

```
POST /web_api/recipes/<recipe_id>/start.json     body {}            -> 202 {"status":"enqueued"}
POST /web_api/recipes/<recipe_id>/stop.json      body {} or {"force":true} -> 202 {"status":"enqueued"}
```

Both need `X-CSRF-TOKEN`. **Start is always 202, even when the recipe cannot start**: the failure is asynchronous and lives only in `state.json`. Stop answers the same way on an already-stopped recipe and does not clear the `state.json` error.

Stopping a recipe that running callers depend on is refused:

```
400 {"error": {"details": {"active_dependent_recipes_count": [3]}}}
```

The count matched the dependency-graph Flow to Flow edge count in the probe. The UI then shows its "Affect N other recipes" confirmation, which is what `force: true` replaces.

**Tool.** `workato_start_recipe` and `workato_stop_recipe`, both reporting `outcome` (`state_reached` | `accepted` | `failed`). `workato_recipe_save_with_dependents` uses the dependent count as a cross-check against the callers it actually discovered, never as a substitute for discovery.

## Test execution

**What it is for.** The editor's Test button: one job through the real steps, without starting the recipe.

```
PUT /recipes/<recipe_id>/test.json
```

Headers: `X-CSRF-TOKEN`, `X-Requested-With: XMLHttpRequest`, `Content-Type: application/json`.

Body, for a `workato_recipe_function` trigger:

```json
{
  "trigger_event": {
    "parameters": { "greeting": "hello" },
    "context": { "calling_job_id": "0", "calling_recipe_id": "0" }
  },
  "error_format": "json"
}
```

Body, for a `clock`, webhook or `workato_pub_sub` trigger:

```json
{ "error_format": "json" }
```

Response: `{"success": true, "flow": {"id": <int>, "last_run_at": "<iso>", "stopped_at": "<iso>|null", "running": false, "testing": true}}`.

**The response carries no job id.** The editor learns it over `wss://rtc.<region>.workato.com/notifications/flow/<id>`. The supported polling path is:

```
GET /web_api/recipes/<recipe_id>/jobs.json?test_jobs_only=true&per_page=5
```

which was empty about a second after the PUT and populated shortly afterwards. Only a `recipe_function` trigger shows an input dialog in the UI; whether `test.json` accepts a synthetic `trigger_event` for webhook or pub/sub triggers was never probed.

```
PUT /recipes/<recipe_id>/stop_test.json     no body   -> {"result": true}
PUT /recipes/<recipe_id>/poll_now.json      {"id": <recipe_id>}  -> {"result": true}
```

`stop_test` is the "Stop test" button for waiting triggers. `poll_now` is the "Check now" button shown while a polling-style trigger test waits for an event.

**Tool.** `workato_test_recipe` (`action: "run" | "stop" | "status"`). `poll_now` has no tool. Paste, with `allow_writes: true` because it is a PUT:

```json
{ "method": "PUT", "path": "/recipes/<recipe_id>/poll_now.json", "body": { "id": <recipe_id> }, "allow_writes": true }
```

### Sample output and connectionless actions

```
POST /connections/<adapter_name>/sample_output.json
```

Body: `{"type": "trigger" | "action", "name": "<operation>", "schema": [<extended_output_schema>], "input": {<step input>}}`.

Response: `{"result": {...sample values keyed by the schema...}}`, for example `{"result": {"parameters": {"greeting": "Sample value"}, "context": {"calling_job_id": "0", "calling_recipe_id": "0"}}}`. A logger action returns `{"result": {}}`.

**Connectionless adapters use the adapter NAME in place of a connection id here.** This is the endpoint behind the "Add trigger data" dialog.

By contrast:

```
POST /connections/logger/test_action.json   -> 404 {"status":404,"message":"Not Found"}
```

**`test_action.json` requires a real connection id.** An adapter name is rejected, so there is no per-step test for a connectionless action; the only way to execute one is to test-run a recipe that contains it.

**No tool** for `sample_output.json`. Paste, with `allow_writes: true` because it is a POST:

```json
{
  "method": "POST",
  "path": "/connections/logger/sample_output.json",
  "body": { "type": "action", "name": "log_message", "schema": [], "input": { "message": "x" } },
  "allow_writes": true
}
```

Also sent by the editor just before `test.json`, and harmless to skip:

```
POST /web_api/recipes/<recipe_id>/collaborators   {"uuid": "<client uuid>"}  -> {"result": "ok"}
GET  /web_api/recipes/<recipe_id>/collaborators   -> {"result": [{user_id, uuid, joined_at, name, avatar_url}]}
```

## Connections

```
GET /connections/<connection_id>.json
```

Header: `x-requested-with: XMLHttpRequest`. Top-level path: `/web_api/connections/<id>.json` and `/web_api/shared_accounts/<id>.json` are both 404.

Response `result` carries, among others:

| Field                                          | Use                                                             |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `authorization_status`                         | The health signal. `success` is the only value observed healthy |
| `authorization_error`                          | Why it is not authorized                                        |
| `authorized_at`                                | When it last authorized                                         |
| `connection_lost_at`, `connection_lost_reason` | Set when Workato noticed the connection break                   |
| `warning`, `clobber_warning`                   | Advisory strings                                                |
| `provider`, `name`, `identity`                 | Identity                                                        |
| `recipe_count`, `running_recipe_count`         | Blast radius                                                    |
| `folder_id`, `project_id`, `folders[]`         | Placement                                                       |
| `input{...}`                                   | **Credential material. Never return it.**                       |

```
GET /connections.json?adapter[]=<provider>
```

Response: `{result: {items: [<same shape as above>, ...]}}`. This is what the recipe page's Connections tab calls, because **there is no per-recipe connection endpoint**. A recipe's bindings have to be read out of its own `config` array first.

**Tool.** `workato_recipe_connections` does exactly that (config bindings, then each bound connection, then `/integrations/meta` for providers with no `account_id`), and returns a `{healthy, blocking, actions}` verdict with credentials stripped. A `config` entry whose provider no step in the recipe uses is reported as `status: "unused"` and does not block anything: it is left-over binding, not a break. `workato_get_connection` and `workato_search_connections` cover the single and list reads, both stripping secrets on every path.

Caveat from the capture: no disconnected connection existed in the probed workspace, so a lost connection's live field values were never observed. The projection treats any `authorization_status` other than `success`, or a non-null `connection_lost_at`, as lost.

## Event Streams (pub/sub) topics

**There is no publish endpoint.** `POST /web_api/pub_sub/topics/<topic_id>/messages.json` is a 404 ("No route matches"), and the topics UI has no publish action. The only supported way to put a message on a topic is to run a recipe step: provider `workato_pub_sub`, action `publish_to_topic` (or `publish_to_topic_batch`), input `{topic_id, message}` plus a matching `extended_input_schema`, executed with `workato_test_recipe`. No `workato_publish_message` tool exists for this reason.

Topic CRUD, all with **no tool**:

```
POST /web_api/pub_sub/topics.json
  body {"name": "<topic name>", "schema": "<string-encoded JSON array of {control_type,label,name,optional,type,parse_output?}>"}
  -> {"result": true}                 the new id is NOT returned; list to find it

GET /web_api/pub_sub/topics.json
  -> {"result": [{"id": 97166, "name", "created_at", "updated_at", "retention": null, "description": null}]}

GET /web_api/pub_sub/topics/<topic_id>.json
  -> {"result": {"id","name","created_at","updated_at","retention":604800,"description",
                 "schema":"<string>","settings":{"retention":{"retention_time":604800}},"flow_count":0}}

GET /web_api/pub_sub/topics/<topic_id>/messages.json?page=1&per_page=25
  -> {"count":1,"items":[{"id":"A11","message":"<JSON string>","published_at",
                          "published_by":{"id","name"},"size":50}],
      "offset":"A12","page":1,"per_page":25}

DELETE /web_api/pub_sub/topics/<topic_id>.json     no body
  -> {"success": true}

GET /web_api/resource_references/flow_count.json?<topic ids>
  -> {"result": {"97166": {"total": 0, "active": 0}}}
```

`message` on a history item is a JSON **string**, and `published_by` names the recipe that published it.

Ready to paste:

```json
{ "method": "GET", "path": "/web_api/pub_sub/topics.json" }
```

```json
{ "method": "GET", "path": "/web_api/pub_sub/topics/97166.json" }
```

```json
{
  "method": "GET",
  "path": "/web_api/pub_sub/topics/97166/messages.json",
  "query": { "page": 1, "per_page": 25 }
}
```

```json
{
  "method": "POST",
  "path": "/web_api/pub_sub/topics.json",
  "body": {
    "name": "mcp probe topic",
    "schema": "[{\"control_type\":\"text\",\"label\":\"Greeting\",\"name\":\"greeting\",\"optional\":true,\"type\":\"string\"}]"
  },
  "allow_writes": true
}
```

```json
{ "method": "DELETE", "path": "/web_api/pub_sub/topics/97166.json", "allow_writes": true }
```

`allow_writes: true` is required on the POST and the DELETE, not on the reads.

## Account and project properties

Captured live **2026-09-08** (Development environment). Full capture in `docs/design/specs/2026-09-08-account-project-properties-endpoints.md`.

One controller serves both scopes. A project property is the same route with `?project_id=<id>` appended:

```
GET    /account_properties.json[?project_id=<project id>]        -> {"result": [record, ...]}
POST   /account_properties.json[?project_id=<project id>]        -> {"result": record}
PUT    /account_properties/<id>.json[?project_id=<project id>]   -> {"result": record}
DELETE /account_properties/<id>.json[?project_id=<project id>]   -> {"result": record}
```

A record is `{id, name, value, version_no, sensitive}`. `version_no` is a string (`"1788860207.51103"`), not a number.

Headers: `x-requested-with: XMLHttpRequest` on every call, `content-type: application/json` on POST and PUT, `x-csrf-token` from the `XSRF-TOKEN-V2` cookie on POST, PUT and DELETE.

Bodies:

```json
POST { "account_property": { "name": "mcp_probe_alpha", "value": "probe_value_alpha" } }
PUT  { "account_property": { "name": "mcp_probe_beta", "value": "updated", "last_version_no": "1788860207.51103" } }
```

Five things the capture established:

1. **`project_id` is the PROJECT id, not the folder id.** `workato_list_folders` reports both on a project root: `project_id` is the one this route wants. A folder id is rejected with HTTP 404 (verified live 2026-09-08); `workato_properties` reports it as ProjectNotFound.
2. **`last_version_no` is mandatory on PUT** and must equal the current `version_no`. Omitted, outdated or mismatched, the write is refused.
3. **A successful PUT issues a NEW `id`** and a new `version_no`: rows are append-only. Every id from an earlier list is stale after an update.
4. **Errors come back as HTTP 200**, not 4xx: `{"error": {"details": {"name": ["has already been taken"]}}}` on a duplicate name, `{"error": {"details": {"base": ["can't update a stale row"]}}}` on a version mismatch. A status check alone reads both as success.
5. **Sensitive masking is UI only.** Workato sets `"sensitive": true` when the name contains `password`, `key` or `secret` (case-insensitive), and then returns the value in the CLEAR anyway. The `XXXXXXXXXX123` mask exists in the browser, not in the API.

Also verified: the list ignores every pagination and search parameter (`page`, `per_page`, `search`, `q`) and returns everything, so filtering is client-side; an empty `value` string is accepted; a project property and an account property may share a name, and neither shadows the other (both appear in the recipe data tree, under `Properties > Project properties` and `Properties > Environment properties`). Values are frozen at job start: changing one does not affect a running job. Limits: 1,000 properties per environment and per project, 100 characters of name, 1,024 of value.

**Tool.** `workato_properties` wraps all four verbs: `action: "list" | "set" | "delete"`, `scope: "account" | "project"` plus `project_id`. `set` is an upsert by name (list, then PUT or POST), sends `last_version_no` for you, accepts `expected_version_no` to make the concurrency check yours, and takes `rename_to`. Sensitive values come back masked unless `reveal: true`. There is no reason to reach for `workato_api_request` here.

## Activity and queue

```
GET /web_api/activity_logs/latest_activity_by_resource?resource_id=<id>&resource_type=recipe
  -> {"result": {"logs": [{"details", "event",
                           "resource": {"folder_id","id","name","parent_id","parent_name","path"}}]}}

GET /web_api/recipes/<recipe_id>/queue_stats
  -> {"result": {"queue_estimated_size", "queue_estimated_clearing_time_sec"}}
```

Both have **no tool**. Ready to paste:

```json
{
  "method": "GET",
  "path": "/web_api/activity_logs/latest_activity_by_resource",
  "query": { "resource_id": 76902508, "resource_type": "recipe" }
}
```

```json
{ "method": "GET", "path": "/web_api/recipes/76902508/queue_stats" }
```

## Routes that do not exist

Probed and confirmed 404, so that nobody spends another session looking:

| Route                                                                                                                    | Result                                           |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `/recipes/<id>/validate.json`, `/web_api/recipes/<id>/validate.json`, `/recipes/<id>/ready.json`                         | 404. **No pre-start validation endpoint exists** |
| `/web_api/recipes/<id>.json`                                                                                             | 404. The recipe metadata route is top-level      |
| `/web_api/recipes/<id>/{dependents,callers,usage,dependencies,dependent_recipes,active_dependents,versions,status}.json` | 404. Use the dependency graph                    |
| `/web_api/connections/<id>.json`, `/web_api/shared_accounts/<id>.json`                                                   | 404. The connection route is top-level           |
| `POST /web_api/pub_sub/topics/<id>/messages.json`                                                                        | 404. There is no publish API                     |
| `POST /connections/<adapter_name>/test_action.json`                                                                      | 404. A real connection id is required            |

## Fixtures kept in the probe workspace

Folder 30945905, Development environment. Do not delete them: the unit-test fixtures encode their shapes.

| Recipe   | Name                  | What it is for                                                                                                 |
| -------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| 82145419 | MCP probe test-input  | `recipe_function` trigger with a `greeting` parameter plus a logger step; the test-execution regression target |
| 82145436 | MCP probe job-search  | Report columns "Marker code" and "Marker pill", with test jobs carrying `GIRAFFE-4412`                         |
| 76902508 | (production callable) | A callable with three live callers. **Do not modify.**                                                         |
