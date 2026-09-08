# Connector catalogue, action discovery and generated step schemas

Date: 2026-09-08. Status: implementing. Evidence: live captures on app.workato.com (Blu Banyan dev workspace 5105163, recipe 69530013), all recorded in this file so nothing below has to be re-derived.

## Problem

An agent building a recipe from a clean session fails at three points:

1. It cannot enumerate the adapters. `workato_apps_list` seeds 18 hard-coded built-in names and otherwise knows only what this workspace already connected or used; a standard connector with no connection here is invisible and "not found" is indistinguishable from a typo.
2. It hand-writes `extended_input_schema` / `extended_output_schema`. Workato accepts a step without them, reports `code_errors: []`, and drops structured input on readback (`declare_list.list_items`, `call_recipe.parameters`, clock `trigger_every`) or breaks a downstream datapill (`Unknown data field`).
3. It trusts `authorization_status: "success"`. Both Salesforce connections in this workspace carry that status and fail every call with `HTTP status code 420`; Google Sheets fails with `invalid_grant`.

## What Workato actually does (captured 2026-09-08)

### The adapter catalogue

Every app.workato.com HTML page embeds

```html
<script src="/web_api/dynamic_app_config/<sha256>.js" defer></script>
```

Hash on 2026-09-08: `d47c2bc3066f9124a9361c5a8882784c81951cab033d8d96b31f09a75e44dff0`, identical on two unrelated workspaces, so it is per Workato deployment, not per account. The file is 320 KB, `application/javascript`, served with or without a session. `GET /web_api/dynamic_app_config.js` without the hash is 404, so the hash must be read from the HTML of `/` with `/dynamic_app_config\/([0-9a-f]{64})\.js/`.

Shape:

```js
// VERSION: <token>
window.Workato = window.Workato || {};
window.Workato.config = {...};
var providers = window.Workato.config.providers;
...
```

Parse the JSON between `window.Workato.config = ` and `};\nvar providers` (keep the closing brace). Top-level keys of interest: `providers` (338 entries), `system_providers` (`workato, foreach, clock, email, sms, workflow, utility`), `popularApps`, `firstOrderApps`, `jobContextSchema`, `catchSchema`, `forEachSchema`, `repeatSchema`.

`providers` is keyed by technical adapter name. Per entry: `name`, `title`, `aliases[]`, `categories[]`, `color`, `actions_count`, `triggers_count`, `deprecated_actions_count`, `deprecated_triggers_count`, `required_feature` (null for 301; otherwise a feature gate such as `data_pipeline`, `restricted_adapter`, `preview_adapter`), `config {required, oauth, oauth_personalization, personalization, custom_oauth, secure_tunnel, secure_tunnel_required}`; optional `url_name`, `secondary` (28), `deprecated` (17), `delist_excluded` (20), `release_type` (`partner` / `demo`), `partner_info`. 45 entries have `config.required: false`. 47 entries carry category `Workato` or `Recipe Tools`: these are Workato's own tools, the ones whose display name says nothing about the adapter name (HTTP = `rest`, Scheduler = `clock`, Python = `py_eval`, Event Streams = `workato_pub_sub`). All 18 names the old tool hard-coded are in the catalogue.

Example: `salesforce` has `actions_count 60`, `triggers_count 36`, `deprecated_actions_count 27`, aliases `["Salesforce","sfdc","apptus"]`, categories `["CRM","Marketing"]`.

The certified community catalogue is separate: `GET /web_api/certified_custom_adapters.json`, 178 entries `{id, name, installed, config: {title, aliases, logo_url, triggers_count, actions_count, deprecated_*}}`. `logo_url` points at `workato-assets.s3.us-west-2.amazonaws.com/adapters/logos/...`, which is the only place that S3 path appears; the bucket does not list. Standard adapter icons are inline SVG in `cdn.marie.awsprod.workato.com/assets/en/adapter-icons-*.css` under `.appicon-<name>`.

Coverage check against this workspace's 68 connections: every standard provider in use is in the 338. `monday` exists only as a certified connector (`monday_connector_192478_1611837420`, not installed); `notion` exists nowhere, so the honest answer for it is the HTTP connector `rest` or an SDK connector.

A parsed copy is committed at `docs/design/probes/providers.json` and `providers.tsv` for offline reference and tests.

### How the editor lists actions

Captured while adding a Salesforce step:

1. App picker: no request. It reads `window.Workato.config.providers`.
2. Action picker: `GET /integrations/meta?name=salesforce&cacheKey=<x-workato-version>_<locale>` (e.g. `c9bb9bbf26f_en`; `cache-control: max-age=604800, public`). The list is `actions[]` with `deprecated: true` removed: 60 in meta, 27 deprecated, 33 shown. The RECOMMENDED block is `POST /recommendations/line_action` (gzipped body); mapping suggestions are `POST /recommendations/automaps`. Neither is needed by us.
3. Connection picker: `GET /connections.json?adapter[]=salesforce`.
4. Setup panel: `POST /connections/<id>/pick_list.json` per dynamic select, then `POST /connections/<id>/extended_schema.json` with the current input.

Per-action fields in `/integrations/meta`: `name, title, description, title_hint, aliases, help, input[], output[], deprecated, batch, bulk, file, realtime, beta, extends_input_schema, extends_output_schema, has_sample_output, depends_on, init_connection, display_priority, action_billing_type, title_english`. Counts match the catalogue's `actions_count` exactly (netsuite 44, salesforce 60, slack 17, workato_variable 7).

### The schema generator: extended_schema.json

`POST /connections/<connection_id_or_adapter_slug>/extended_schema.json`

Request body:

```json
{
  "flow_id": 69530013,
  "operation_name": "search_sobjects",
  "input": { "sobject_name": "Account" },
  "dynamic_pick_list_selection": { "sobject_name": "Account" },
  "depends_on": {},
  "list_schema": {},
  "only": ["input", "output"]
}
```

Headers: `x-csrf-token` from the `XSRF-TOKEN-V2` cookie (URL-decoded), `x-requested-with: XMLHttpRequest`, `content-type: application/json`, session cookie. `dynamic_pick_list_selection`, `depends_on`, `list_schema` and `only` may be omitted. `flow_id` may be omitted.

Response: `{"result": {"input": [...], "output": [...], "title", "description", "help"}}`. `result.input` and `result.output` are exactly the arrays a step carries as `extended_input_schema` and `extended_output_schema`. Nothing is saved.

Verified cases:

- `/connections/workato_variable/extended_schema.json` (ADAPTER SLUG, no connection), `operation_name: declare_list`, `input: {name: "orders", list_item_schema_json: "[{\"name\":\"order_id\",\"type\":\"string\",\"label\":\"Order ID\"},{\"name\":\"amount\",\"type\":\"number\",\"label\":\"Amount\"}]"}` returned `input: [{name: "list_items", label: "Items", type: "array", of: "object", optional: true, properties: [{name: "order_id", type: "string", control_type: "text", label: "Order ID"}, {name: "amount", type: "number", control_type: "number", parse_output: "float_conversion", label: "Amount"}]}]` and `output: [{name: "list_items", label: "orders", type: "array", of: "object", optional: false, properties: [same two]}]`, title `" Create orders list"`.
- `/connections/clock/extended_schema.json`, `scheduled_event`, `input: {time_unit: "minutes"}` returned `input: [trigger_every (control_type integer, default "5", suffix {text: "minutes"}, extends_schema true), timezone (select, pick_list "timezone_id_global_pick_list", pick_list_connection_less true), start_after (date_time)]`, `output: []`.
- Jira connection 16580119, `get_issue`, `input: {}` returned a 14 396-byte `output`: the full issue schema (id, self, key, changelog, fields with `custom: false|true`).
- Custom SDK connector `netsuite_rest_connector_5105163_1745592003`, connection 17241780, `run_suiteql`, `input: {sql_statement: "SELECT id, companyname FROM customer", limit: 5}` returned `output: [items (array of object: id, name), count, hasMore, offset, totalResults, query_executed, error]`.
- Salesforce connections 17977571 and 17973532, `search_sobjects` with `sobject_name: "Account"`: HTTP 200 `{"error": "HTTP status code 420"}`. With `input: {}` the same call succeeds with `input: [], output: []`. `pick_list.json` on the same connections also returns 420. Google Sheets 18514516: `{"error": "invalid_grant", "error_description": "Bad Request"}`. All three connections report `authorization_status: "success"`.

Failure shape is therefore always HTTP 200 with an `error` key, never a 4xx.

**Side effect to avoid:** the editor toolbar "Refresh" button fires `extended_schema` per step and then `PUT /recipes/<id>.json`. It saves. Recipe 69530013 went from version 1 to version 2 that way. It is not a read-only probe.

## Design

### 1. `workato_apps_list` reads the catalogue

Extension tool `app/chrome-extension/entrypoints/background/tools/workato/apps-list.ts`.

Sources, all in one in-page promise chain (no async/await in in-page code, see the file header of pull-recipe.ts):

- `catalogue`: fetch `/` as HTML (`credentials: include`, `accept: text/html`), regex the hash, fetch `/web_api/dynamic_app_config/<hash>.js`, parse `window.Workato.config`, reduce `providers` IN PAGE to slim entries so the 320 KB never crosses the bridge: `{name, title, aliases, categories, connection_required: config.required, actions_count, triggers_count, deprecated_actions_count, deprecated_triggers_count, deprecated, secondary, required_feature, url_name}`. Return the hash too.
- `connections` (existing, `/web_api/mixed_assets.json?asset_type=connection`), `usedAdapters` (existing), `custom` (existing), `certified` (existing, default on when `query` is set).
- Drop `BUILTIN_ADAPTERS` and the `/integrations/meta` seed fetch: the catalogue covers all 18 names (verified). The fallback when the catalogue fetch fails is "degraded: sources_unavailable names catalogue, note says so".

Service-worker cache: a module-level `{hash, entries, fetchedAt}`; the in-page function receives the known hash and, when the HTML still names the same hash, skips the 320 KB fetch and returns `{unchanged: true}`. The hash is the version.

`source` values become `connection | recipes | custom | builtin | standard | certified`. A catalogue entry is `builtin` when its categories include `Workato` or `Recipe Tools`, otherwise `standard`. Existing ordering rule (connected first, then recipes, then builtin, then custom, then standard, then certified) stays.

New args: `category` (case-insensitive exact match on a category), `include_deprecated` (default false: a catalogue entry with `deprecated: true` is hidden unless it also has a `connection` or `recipes` source), `only_connected` (default false). `query` now also matches `categories`. `limit` default 50 when `query` or `category` is set.

Bare call (no `query`, no `category`, no `only_connected`): return a SUMMARY, not 338 rows: `connected` (entries with a connection, full shape), `custom` (this workspace's SDK connectors), `used_in_recipes` (names), `catalogue: {standard: n, builtin: n, certified: n, deprecated_hidden: n, categories: {name: count} sorted by count desc}`, and a `hint` saying to query by name, alias or category. `summary: true` in the payload.

Response `note` replaces the old "no catalogue" text with: the catalogue is complete for Workato's standard connectors (count) plus the certified catalogue (count); an app absent from both is not available as a connector here, and the honest options are the HTTP connector `rest` or an SDK connector, which the agent should say rather than guess a name. Keep a one-line pointer that `workato_adapter_meta` accepts an array and reports `not_found`.

Description in `packages/shared/src/tools.ts`: rewrite; the served size must stay under 2048 bytes (tests/workato/description-budget.test.ts), no em or en dashes.

### 2. New tool `workato_step_schema`

`TOOL_NAMES.WORKATO.STEP_SCHEMA = 'workato_step_schema'`. Extension tool in `app/chrome-extension/entrypoints/background/tools/workato/step-schema.ts`, exported from the workato tools index, schema in `packages/shared/src/tools.ts` next to PICK_LIST.

Args:

- `adapter` (string, required): technical adapter name. Needed to read `/integrations/meta` for validation and hints, and it is the URL segment when no connection is given.
- `operation` (string, required): trigger or action name.
- `connection_id` (number, optional): numeric connection. Required when meta says `config.required: true`; refuse before any call otherwise, with the message that a connection is needed and how to find one. When given, the URL is `/connections/<connection_id>/extended_schema.json`; else `/connections/<adapter>/extended_schema.json`.
- `input` (object, default `{}`): the step input as it would be saved.
- `dynamic_pick_list_selection` (object, optional): when omitted, AUTO-DERIVED from `input` for every top-level input field whose meta definition carries a string `pick_list` (mirrors what the editor sends). Report the derived object as `dynamic_pick_list_selection_used`.
- `flow_id` (number, optional): recipe id, passed through.
- `only` (array of `input` / `output`, default both).
- `timeout_ms` (default 45000, clamp 10000..110000), `tabId`.
- `apply_to` (object, optional): `{recipe_id, step}` plus the usual save modifiers (`comment`, `expected_base_version_no`, `dry_run`, `verify_readback`, `restart_if_running`, `ensure_running`). See 2b.

In-page function: read meta for the adapter (same fetch and `findField` approach as pick-list.ts), locate the operation in `actions` or `triggers` (case-sensitive exact match, error names the closest few names when missing), check `config.required` against `connection_id`, build the body, POST with the CSRF cookie, parse. Return `{ok, result, meta_flags: {extends_input_schema, extends_output_schema, depends_on, deprecated}, schema_drivers: [names of input fields with extends_schema: true], connection_required, dynamic_pick_list_selection_used, failure: {stage: meta|operation|connection|fetch|shape, message}}`.

Error mapping (the endpoint answers 200 with `{"error": ...}`):

- `HTTP status code 4xx/5xx` inside `error`: report `stage: fetch`, and say plainly that the CONNECTION failed the call, that `authorization_status: success` on the connection does not rule this out (seen live on two Salesforce connections and one Google Sheets connection), and that `workato_step_schema` with `input: {}` is the cheap liveness probe. Suggest re-authorizing the named connection id.
- Empty `input` AND `output` when meta has `extends_*_schema: true` and `schema_drivers` is non-empty and none of the drivers is present in `input`: `isError: false`, but `note` says the schema depends on those fields and which ones are missing.

Payload: `{adapter, connection_id?, operation, title, description (HTML tags stripped), input_schema, output_schema, input_count, output_count, schema_drivers, meta_flags, dynamic_pick_list_selection_used?, note?, apply_ops, write_hint}` where `apply_ops` is a ready `workato_recipe_apply` operations array: `[{op: "set_extended_schema", step: "<as>", kind: "extended_input_schema", schema: [...]}, {op: "set_extended_schema", step: "<as>", kind: "extended_output_schema", schema: [...]}]` with `step: "<as>"` left as a literal placeholder when `apply_to` is absent; skip the op for an empty array. `write_hint` says: a field fed by a dynamic pick list is written twice, in `input` and in `dynamicPickListSelection`.

Auto-file: the generic path (`workato-auto-file.ts`) must treat this as a Workato read tool so a 14 KB Jira schema spills to a file when over the threshold. Check how tool names are classified there and include this one.

#### 2b. `apply_to`: write the schemas into a step

Handled in the native server, not the extension: add `workato_step_schema` handling next to the mutators (see `workato-recipe-mutators.ts` and `register-tools.ts`). Flow: call the extension tool without `apply_to`; if it failed, return that; otherwise run `runRecipeMutation` for `apply_to.recipe_id` with `applySetExtendedSchema` on the target step for each non-empty schema array (both kinds in ONE version), forwarding the save modifiers; merge the mutation summary under `applied: {...}` in the same payload. `dry_run: true` returns the mutation summary without saving. If the step does not exist the mutation error is returned and the schemas are still in the payload, so nothing is lost.

The native-server must declare this tool so the router knows the name is handled natively when `apply_to` is present and forwarded to the extension otherwise. Follow whatever pattern `workato_recipe_validate` (native read that also calls the extension) uses.

### 3. `workato_adapter_meta` index tweaks

- Index mode hides operations with `deprecated: true` unless `include_deprecated: true` (new arg). Detail mode (`operation:` given) still returns a deprecated operation and marks it. Index payload reports `deprecated_hidden: n` per adapter when n > 0.
- Index entries additionally carry `title_hint` and `aliases` when present and non-empty.
- Description: mention both, stay under 2048 bytes.

### 4. Server instructions

`app/native-server/src/mcp/server-identity.ts` routing text gains: `which app or adapter name -> workato_apps_list(query)`, `what an adapter can do -> workato_adapter_meta`, `a step's real input/output schema, instead of writing extended_*_schema by hand -> workato_step_schema`. Keep the sentence style of the existing text.

### 5. Documentation and skill (separate agent, disjoint files)

- `skills/workato-recipes/discovering-connectors.md`: the ladder becomes apps_list -> adapter_meta(index) -> adapter_meta(operation) -> pick_list -> step_schema -> add_step / apply. Replace "The one real gap" with the catalogue facts above. Add a section on `workato_step_schema` with the declare_list example verbatim, the 420 semantics and the liveness probe. Update the endpoint table (`dynamic_app_config`, `extended_schema.json`, `connections.json?adapter[]=`). Update the worked example.
- `skills/workato-recipes/code-tree.md`: near the extended-schema rules (around "NOT universally safe to omit"), add that `workato_step_schema` generates both arrays from the adapter, with the same declare_list example, and that hand-writing is the fallback.
- `skills/workato-recipes/platform-endpoints.md`: add `dynamic_app_config`, `extended_schema.json`, the Refresh-saves warning, the 420 shape.
- `docs/TOOLS.md`: rows for `workato_step_schema`, updated `workato_apps_list` and `workato_adapter_meta` args.
- `docs/ROADMAP.md`: `workato_recipe_refresh_schema` is delivered as `workato_step_schema` (`apply_to`).
- `CHANGELOG.md` Unreleased: Added / Changed entries in the existing voice.
- Skill `SKILL.md` if it lists the tool ladder.

## Out of scope

- `/recommendations/*` endpoints.
- Creating connections.
- Version bump and npm publish (done at release time).

## Acceptance

- `pnpm -r typecheck`/build green; vitest green including `description-budget.test.ts`.
- Live: `workato_apps_list(query: "sheet")` returns google_sheets and smartsheet with `source: ["standard"]`, `workato_apps_list()` returns the summary under 8 KB, `workato_step_schema(adapter: "workato_variable", operation: "declare_list", input: {...})` returns the two `list_items` arrays, `workato_step_schema(adapter: "salesforce", connection_id: 17977571, operation: "search_sobjects", input: {sobject_name: "Account"})` returns the 420 explanation as an error, `workato_adapter_meta("salesforce")` index lists 33 actions with `deprecated_hidden: 27`.
