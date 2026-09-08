# Discovering a connector you have not used before

How to go from "the recipe should send an email" to a step that actually works, without an existing example to copy. This is the part that has no answer in `code-tree.md`: that file documents the shapes of connectors already known, this one is about finding the shape of one that is not.

Everything below was verified against a live workspace on 2026-08-26; the connector catalogue and the schema generator were captured on 2026-09-08. Where Workato offers nothing, this file says so rather than leaving a gap that reads like an oversight.

## The ladder

Six questions, in order. Each one narrows the next.

| Question                                                                        | Tool                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------ |
| Which apps exist, what is each called technically, and which have a connection? | `workato_apps_list`                              |
| What can this connector do?                                                     | `workato_adapter_meta` (index mode: bare call)   |
| What does this operation take?                                                  | `workato_adapter_meta` with `operation:"<name>"` |
| What values does this field accept, in THIS workspace?                          | `workato_pick_list`                              |
| What are the step's real `extended_input_schema` and `extended_output_schema`?  | `workato_step_schema`                            |
| What does a working call look like here?                                        | `workato_recipe_step_search`                     |

Then write the step with `workato_recipe_add_step`. It now runs through the same guarded mutation engine as every other native write: it pulls once, applies the insert to a clone, mints the `as` anchor and the `uuid`, renumbers the **whole tree** (not just the block, which is what used to give a nested step and a top-level step the same number), validates locally, and **merges** the pulled `config` rather than rebuilding it, so existing `account_id` and `skip_validation` values survive and only a provider new to the recipe is appended. A new provider gets its `account_id` when you pass `connection_id`; without one the response reports `connection_binding: missing` rather than leaving a recipe that cannot start. Use `anchor` (`after` / `before` / `into` with `first` / `last`) to insert inside a `foreach`, `if` or `try` block, and `dry_run: true` to see the summary without saving.

For more than one insert, or an insert plus the mappings that go with it, use `workato_recipe_apply` instead: the same engine, up to 50 operations, one version.

**On a step that already exists, the field surface comes back with the step.** `workato_pull_recipe(recipe_id, step: "<as>")` merges the adapter's own input fields into `fields` whenever the step's `extended_input_schema` is empty or absent, each entry tagged `provenance: "static" | "dynamic" | "both"`, plus `fields_complete` on the view. So the ladder above is for a connector with no example in the recipe; for one already in it, read the step first and only fall back to `workato_adapter_meta` when `fields_complete` is false.

## Step 1 — find the technical adapter name

`step.provider` is a technical name, never a title. For standard connectors it is usually the lowercase title (`slack`, `hubspot`, `salesforce`), but for anything custom it is a generated string nobody can guess:

```
netsuite_rest_connector_5105163_1745592003    title: "NetSuite REST v2"
enerflo_connector_5105163_1744901872          title: "Enerflo"
```

`workato_apps_list` maps titles to those names. It reads Workato's own connector catalogue (see below) and merges it with what this workspace has, tagging each app with every place it was seen:

- `connection`: a real connection exists here, so a step can authenticate today. The connection ids and `authorization_status` come with it; a `connection_lost` status is why an otherwise correct step fails at run time. `success` is necessary, not sufficient (see step 4).
- `recipes`: already used by a recipe here, so step 5 will find live examples.
- `custom`: this workspace's own SDK connector, with its generated name.
- `builtin`: one of Workato's own tools (catalogue category `Workato` or `Recipe Tools`), always available. See the table below: this is where the display name and the adapter name diverge hardest.
- `standard`: any other connector in Workato's catalogue, whether or not this workspace has a connection to it.
- `certified`: in Workato's certified community catalogue, not installed here.

How to call it:

- `workato_apps_list(query: "sheet")` matches name, title, aliases AND categories, case-insensitively: `google_sheets`, `smartsheet`, `tsheets`, `docparser`. `query: "python"` lands on `py_eval`; `query: "approval"` on `workato_workflow_task`; `query: "teams"` on `microsoft_teams`, `teams_bot` and `cisco_spark`.
- `category: "CRM"` filters on a catalogue category. `only_connected: true` keeps the apps a step can authenticate as right now.
- A bare call returns a SUMMARY, not the whole catalogue: `connected` (full entries), `custom`, `used_in_recipes`, and `catalogue: {standard, builtin, certified, deprecated_hidden, categories: {name: count}}`, with `summary: true`. Query from there.
- Deprecated catalogue entries (`ariba`, `coda`, `splunk`, `soap`, `workato_list`, 17 in all) are hidden unless `include_deprecated: true`, except when this workspace still has a connection to or a recipe using one.

Each entry carries `actions_count`, `triggers_count`, `deprecated_actions_count`, `deprecated_triggers_count`, `connection_required` and, when set, `required_feature` (a plan gate such as `data_pipeline` or `restricted_adapter`, which means the app may not be enabled for this account even though it is in the catalogue).

### No connection: stop and ask the user

**These tools cannot create a connection**, deliberately: it means handing over the customer's credentials, and only a person can do that. So when the app needs one and the workspace does not have one, the answer is to stop and ask, not to build the step anyway.

Check in this order:

1. **`connection_required: false`** on the adapter (`workato_adapter_meta`, or the `builtin` entries in `workato_apps_list`). Then no connection exists or is needed, and there is nothing to ask for. This covers `email`, `logger`, `py_eval`, `clock`, `workato_variable`, `lookup_table` and the rest of Workato's own tools.
2. **A `connection` entry in `workato_apps_list`** with `authorization_status: "success"`. Use its `id` as the `account_id` in the recipe `config`.
3. **Anything else** is a blocker. Either there is no connection at all, or there is one whose status is not `success` (`connection_lost` is the common case, and it reads as working right up until the recipe runs).

**On an existing recipe, run `workato_recipe_connections` instead of re-deriving this.** It reads the recipe's `config` bindings, then each bound connection, then `/integrations/meta` for the providers that carry no `account_id`, and returns one entry per binding with `status` of `ok`, `lost`, `missing`, `not_required`, `unused` or `unknown`, plus a `{healthy, blocking, actions}` verdict. `unused` means the `config` entry survives but no step uses that provider any more: left-over binding, reported and never blocking. `actions` is already phrased the way this section asks: a broken connection is named by id to re-authorize, never replaced by a request for a new one. Run it **before** stopping a chain you will have to restart, and whenever a start does not take: `workato_start_recipe` otherwise reports only that the state did not flip, because `POST start.json` answers 202 either way. `healthy` is false on `unknown` as well as on a real break, because a diagnostic gap is not evidence of health.

A deliberately stopped recipe stays editable even with a broken connection. Connection health blocks a restart, not a repair.

Ask before writing the step, not after. A step needs its provider's `account_id` in `config`, and that id does not exist until the connection does, so the recipe cannot be completed either way. Write the request so it can be acted on without coming back for details:

> The recipe needs a Slack connection and this workspace has none. Could you create one at app.workato.com/connections/new (adapter `slack`), then tell me the connection name? I will wire the step to it.

If a connection exists but is not authorized, say which one by name and id rather than asking for a new one:

> The connection "Salesforce sandbox" (id 1236) shows `connection_lost`, so the step will fail at run time. Could you re-authorize it?

Only continue without one when the user explicitly asks for the recipe to be drafted anyway. Then say plainly that the step is left unconfigured and the recipe cannot start until the connection exists.

### Workato's own connectors: the name is never the name

The worst offenders are Workato's own built-in connectors, where the display name and the adapter name share almost nothing. Asking `/integrations/meta` for `workato_event_streams` or `event_streams` returns an empty document; the adapter is `workato_pub_sub`. Verified live:

| What it is called          | `step.provider`                             | Connection? |
| -------------------------- | ------------------------------------------- | ----------- |
| HTTP                       | `rest`                                      | yes         |
| Workato Event Streams      | `workato_pub_sub`                           | no          |
| Scheduler by Workato       | `clock`                                     | no          |
| Python snippets by Workato | `py_eval`                                   | no          |
| CSV / JSON / XML tools     | `csv_parser` / `json_parser` / `xml_parser` | no          |
| Variables by Workato       | `workato_variable`                          | no          |
| Lookup tables by Workato   | `lookup_table`                              | no          |
| Workato FileStorage        | `workato_files`                             | no          |
| Workflow apps by Workato   | `workato_workflow_task`                     | no          |
| Recipe function by Workato | `workato_recipe_function`                   | no          |
| RecipeOps by Workato       | `workato_app`                               | yes         |
| API platform by Workato    | `workato_api_platform`                      | no          |
| Email by Workato           | `email`                                     | no          |
| Logger by Workato          | `logger`                                    | no          |
| FTP/FTPS, SFTP             | `ftps`, `sftp`                              | yes         |

`workato_apps_list` carries all of these as `builtin` (47 entries in the catalogue) and searches their titles and aliases, so "event stream", "pub/sub", "scheduler", "python" and "approval" each resolve to the right adapter. Nothing is hard-coded in the tool any more: the names, titles, aliases and categories come from the catalogue on every call, so a rename or a new tool shows up as soon as Workato ships it.

### The catalogue (captured 2026-09-08)

The earlier claim that Workato serves no catalogue of its standard connectors was wrong. Every app.workato.com page embeds

```html
<script src="/web_api/dynamic_app_config/<sha256>.js" defer></script>
```

and that file sets `window.Workato.config`, whose `providers` map is keyed by technical adapter name: **338 standard connectors** on 2026-09-08, each with `title`, `aliases`, `categories`, `actions_count`, `triggers_count`, `deprecated_*_count`, `config.required` (false for 45 of them, so no connection and no `account_id`), `deprecated`, `secondary`, `required_feature`. The hash in the URL is the version: it was identical on two unrelated workspaces, so the catalogue is per Workato deployment, not per account, and the bare path without the hash is a 404. The recipe editor's app picker issues no network request because it reads this preloaded map; the action picker then calls `/integrations/meta` for the chosen adapter.

The **certified community catalogue** is separate: `/web_api/certified_custom_adapters.json`, 178 entries on 2026-09-08 with `installed` and `config.title`. `workato_apps_list` reads both, plus this workspace's own SDK connectors and connections.

Coverage check against a workspace with 68 connections: every standard provider in use (gmail, google_drive, hubspot, jira, linkedin, microsoft_sharepoint, netsuite, shopify, slack, twilio, workday, sap, stripe, docusign, asana, airtable, quickbooks, xero, bamboohr, greenhouse) is in the 338. `monday` exists only as a certified connector (`monday_connector_192478_1611837420`); `notion` exists in neither.

**An app absent from both catalogues is not available as a connector.** Say so to the user, and name the two real options: the HTTP connector (`rest`, needs a connection holding the API credentials) or an SDK connector this workspace would have to build and publish. Do not guess adapter names: `/integrations/meta` returns `{}` with HTTP 200 for an unknown name, indistinguishable from a typo, which is exactly the loop the catalogue removes. The array form of `workato_adapter_meta` still reports misses under `not_found`, and it remains the right tool once a name is known.

## Step 2 — list the operations

A bare `workato_adapter_meta(adapter: "email")` returns the index: operation names, titles, `title_hint` and `aliases` where the connector sets them, help, and field counts. This stays small on purpose, a large connector's full meta runs to hundreds of KB. Operations flagged `deprecated: true` are hidden from the index, exactly as the editor's action picker hides them (Salesforce: 60 actions in meta, 27 deprecated, 33 shown), and the adapter reports `deprecated_hidden: 27`; pass `include_deprecated: true` to see them, or name one with `operation:` and it comes back marked. This is the same `/integrations/meta` document the editor fetches when an app is picked, so the index IS the action picker, minus the RECOMMENDED block, which comes from a separate recommendations endpoint.

```json
{
  "name": "send_mail",
  "kind": "action",
  "title": "Send email",
  "help": "Send an email to specified recipient from the email address mailer@workato.com...",
  "input_count": 7,
  "output_count": 3
}
```

The adapter-level fields come back in every mode:

- `title`, `aliases`, `categories` — identity, and the answer to "did I guess the right name".
- `connection_required` — see below, this one changes the recipe's `config`.
- `deprecated`.

## Step 3 — read the operation's fields

`workato_adapter_meta(adapter:"email", operation:"send_mail")` returns each field in full. **Workato silently drops input keys it does not recognise**, so a guessed key name saves cleanly and then does nothing; this is the call that prevents that.

Four properties decide whether the step works, beyond the obvious `name` / `type` / `optional`:

**`options`** — the allowed values of a static select, and the trap of this whole file. Workato stores pick lists label-first, so the label and the value are different strings:

```json
{
  "name": "email_type",
  "control_type": "select",
  "default": "html",
  "options": [
    { "value": "plain_text", "label": "Text" },
    { "value": "html", "label": "HTML" }
  ]
}
```

`step.input.email_type` must be `"html"`. Writing `"HTML"` saves without complaint and misbehaves at run time. When `options` is absent but `control_type` is `select`, look for `pick_list` — a string there names a _dynamic_ list, resolved per connection. See below.

### When `pick_list` is a string: the values live on the connection

`options` covers a static select. When `pick_list` is a **string** instead, it names a dynamic list and the values are not in the meta document at all, because they are the customer's own data: Salesforce objects, NetSuite record types, Slack channels. `workato_pick_list` resolves them:

```
workato_pick_list(connection_id: 19092754, adapter: "salesforce",
                  operation: "search_sobjects", field: "sobject_name")
  -> 2567 options, e.g. {value: "APXTConga4__Conga_Merge_Query__c", label: "Conga Query"}
```

Same inversion as everywhere else: Workato returns `[label, value]`, and `value` is what the step needs.

A **parameterised** list depends on other values, which the field names in its own `pick_list_params`. Read them there, but send them **evaluated**. The schema shows them as formulas, so each value appears wrapped in quotes, and passing that form through reaches Salesforce quoted and fails. Verified live:

```
pick_list_params: {sobject_name: "Account", field_name: "Rating"}  -> Hot, Warm, Cold
pick_list_params: {sobject_name: "\"Account\""}                    -> bad URI (is not URI?)
```

`workato_pick_list` strips quotes copied by mistake and says which ones.

#### The step then carries the choice twice

This is the silent one. A field fed by a dynamic pick list appears in **both** `input` and `dynamicPickListSelection`, under the same field name. From a live recipe:

```json
{
  "number": 1,
  "provider": "salesforce",
  "name": "search_sobjects",
  "keyword": "action",
  "dynamicPickListSelection": { "sobject_name": "Account" },
  "input": { "sobject_name": "Account", "Id": "0015f00001ZKCHRAA5", "limit": "150" }
}
```

Writing only `input` saves cleanly and leaves the editor showing an empty picker.

**`default`** — what Workato applies when the field is omitted. Setting a field to its default is noise; omitting a field whose default is wrong for you is a bug.

**`properties`** — the item fields of an object or an object array. Without these an array field looks atomic and gets filled with a string:

```json
{
  "name": "attachments",
  "type": "array",
  "of": "object",
  "properties": [
    {
      "name": "file_binary_content",
      "toggle_field": { "name": "file_url", "control_type": "text" }
    },
    { "name": "file_name" }
  ]
}
```

**`toggle_field`** — the alternative form of a field. The UI shows one input that flips between two shapes; in JSON either key is accepted, and picking the wrong one writes nothing. Above, an attachment is `file_binary_content` **or** `file_url`, never both.

Nesting is followed three levels deep, and `field_grep` searches nested names too, so `field_grep:"file"` finds `file_url` inside `attachments`.

### `connection_required` and the recipe `config`

`connection_required: false` means the connector needs no connection at all. Its `config` entry then carries **no `account_id`**:

```json
{ "keyword": "application", "name": "email", "provider": "email", "skip_validation": false }
```

versus a connection-based provider:

```json
{
  "keyword": "application",
  "name": "salesforce",
  "provider": "salesforce",
  "skip_validation": false,
  "account_id": 19092754
}
```

Both shapes verified in one live recipe's `config`. This is the general rule behind the list of system providers in `code-tree.md`: read `connection_required` rather than trusting that list to be complete. Hunting for a connection that will never exist is a common dead end.

## Step 4: generate the step's schemas with `workato_step_schema`

Meta describes the STATIC surface. When an operation carries `extends_input_schema: true` or `extends_output_schema: true`, the real schema depends on the connection and on what has been entered so far: the Salesforce object picked, the SuiteQL written, the list item schema declared. Those are the `extended_input_schema` and `extended_output_schema` arrays a saved step carries, and hand-writing them is where recipes break: Workato accepts a step without them, reports `code_errors: []`, then drops `declare_list.list_items` or `call_recipe.parameters` on readback, or fails the downstream datapill with `Unknown data field`.

The editor never writes these by hand. Its Setup panel calls `POST /connections/<id>/extended_schema.json` with the current input, and `workato_step_schema` is that call:

```
workato_step_schema(adapter: "workato_variable", operation: "declare_list",
  input: {name: "orders",
          list_item_schema_json: "[{\"name\":\"order_id\",\"type\":\"string\",\"label\":\"Order ID\"},{\"name\":\"amount\",\"type\":\"number\",\"label\":\"Amount\"}]"})
  -> input_schema:  [{name: "list_items", label: "Items", type: "array", of: "object", optional: true,
                      properties: [{name: "order_id", type: "string", control_type: "text", label: "Order ID"},
                                   {name: "amount", type: "number", control_type: "number", parse_output: "float_conversion", label: "Amount"}]}]
     output_schema: [{name: "list_items", label: "orders", type: "array", of: "object", optional: false, properties: [same two]}]
     title: " Create orders list"
```

Both arrays go into the step verbatim. Verified 2026-09-08 on a connectionless adapter (above), on the clock trigger (`adapter: "clock", operation: "scheduled_event", input: {time_unit: "minutes"}` returns `trigger_every` with default `"5"`, `timezone` and `start_after`), on a standard connector through a connection (Jira `get_issue` with `input: {}` returned the full 14 KB issue schema including custom fields) and on a custom SDK connector (`run_suiteql` with a query returned `items`, `count`, `hasMore`, `offset`, `totalResults`, `query_executed`, `error`).

How to call it:

- `adapter` and `operation` are required. `connection_id` is required when the adapter's `connection_required` is true, and the tool refuses before any call when it is missing. A connectionless adapter goes by slug, exactly as the editor does.
- `input` is the step input as it would be saved. Fields marked `extends_schema: true` in meta are the ones that drive the result; the response lists them as `schema_drivers`. Empty `input_schema` and `output_schema` with drivers unfilled means "pick first", and the response `note` names the missing drivers: Salesforce `search_sobjects` with `input: {}` returns two empty arrays and no error.
- `dynamic_pick_list_selection` is derived for you from `input` for every field whose meta `pick_list` is a string, mirroring what the editor sends; it comes back as `dynamic_pick_list_selection_used`. Pass it only to override.
- `only: ["output"]` when the input side is not wanted. `flow_id` is the recipe id and is optional.
- `apply_to: {recipe_id, step}` writes both arrays into that step in ONE version through the same engine as `workato_recipe_set_extended_schema`, with the usual save modifiers (`comment`, `expected_base_version_no`, `dry_run`, `verify_readback`, `restart_if_running`, `ensure_running`). Without it the response carries `apply_ops`, a ready `workato_recipe_apply` operations array with `step: "<as>"` left for you to fill.

**The endpoint reports failure as HTTP 200 with an `error` key, never a 4xx.** `{"error": "HTTP status code 420"}` means the CONNECTION failed the call against the SaaS. Seen live on 2026-09-08 on both Salesforce connections of the probed workspace and, as `{"error": "invalid_grant"}`, on a Google Sheets connection, while all three reported `authorization_status: "success"`. So `success` is necessary, not sufficient. `workato_step_schema` with `input: {}` is the cheap liveness probe: it answers in under a second, saves nothing, and a healthy connection returns either a schema or two empty arrays without an `error`. When it fails, name the connection by id and ask the user to re-authorize it; do not build the step on it.

Never use the editor's toolbar **Refresh** button as this probe: it fires `extended_schema` per step and then `PUT /recipes/<id>.json`. It saves the recipe (observed: recipe 69530013 went from version 1 to version 2 with a half-configured step).

## Step 5: find how it is used here

Meta says what a field is called and what it accepts. It cannot say what a working value looks like: which datapill shape the team uses, which optional fields they always set, how they format an internal id. That knowledge only exists in recipes already running in the workspace.

```
workato_recipe_step_search(provider: "email", action: "send_mail")
```

returns real steps with their full `input`, plus `recipe_id` and `step_number` so the example can be opened. Omitting `action` is how you learn which of a connector's operations are used here at all.

Two things to keep in mind:

- The returned `input` is a **template, not a value**. Its datapills are bound to that recipe's own steps and must be repointed, or they resolve to empty.
- **Zero results is a normal answer**, meaning this connector was never used here. It is not an error, and meta still describes the connector in full. The response says how many recipes were flagged and how many pages were scanned, so a zero that came from too small a scan is distinguishable from a real zero.

Connection secrets are stripped from the returned input. A step's `url` / `uri` / `path` is deliberately kept — it is the most useful line of an HTTP or custom-REST example — with any credentials embedded in its userinfo replaced by `[redacted]`.

## Worked example: sending an email, never done here before

```
workato_apps_list(query: "email")
  → email is present, source ["recipes"], no connection listed

workato_adapter_meta(adapter: "email")
  → title "Email by Workato", connection_required false
  → one action: send_mail, "Send email", 7 input fields

workato_adapter_meta(adapter: "email", operation: "send_mail")
  → to, subject, body required; email_type optional, options plain_text|html, default html
  → attachments is an array of objects, items are file_name + (file_binary_content | file_url)
  → extends_input_schema and extends_output_schema both absent: the static surface is the whole surface

workato_recipe_add_step(
  recipe_id: <id>, after_step: 0,
  provider: "email", action_name: "send_mail",
  input: {to: "...", subject: "...", body: "...", email_type: "html"})
```

No dynamic pick list on this action, so no `dynamicPickListSelection`. An action like `salesforce.search_sobjects` would need one.

No `account_id` in `config` for this provider, because `connection_required` was false. No `workato_step_schema` call either, because neither `extends_*_schema` flag was set.

## Worked example: a typed list filled from Salesforce, then a loop

The case that used to need hand-written schemas. Recipe already open; the user asked for "a list, fill it from Salesforce accounts, log each one".

```
workato_pull_recipe(recipe_id: <id>)
  → trigger and two empty steps; config has no salesforce entry

workato_apps_list(query: "salesforce")
  → salesforce, source ["connection", "standard"], connections [{id: 17977571, status: "success"}, ...]

workato_step_schema(adapter: "salesforce", connection_id: 17977571,
                    operation: "search_sobjects", input: {})
  → ok, input_schema [], output_schema [], note: schema depends on sobject_name
    (a healthy connection answers this way; {"error": "HTTP status code 420"} would mean stop and ask for re-authorization)

workato_pick_list(connection_id: 17977571, adapter: "salesforce",
                  operation: "search_sobjects", field: "sobject_name", query: "account")
  → {value: "Account", label: "Account"}

workato_step_schema(adapter: "salesforce", connection_id: 17977571,
                    operation: "search_sobjects", input: {sobject_name: "Account"})
  → output_schema: the Account fields; pick Id and Name for the list

workato_step_schema(adapter: "workato_variable", operation: "declare_list",
                    input: {name: "accounts",
                            list_item_schema_json: "[{\"name\":\"Id\",\"type\":\"string\"},{\"name\":\"Name\",\"type\":\"string\"}]"})
  → input_schema and output_schema for list_items, ready to write

workato_recipe_apply(recipe_id: <id>, dry_run: true, changes: [
  {op: "insert_step", ... provider: "workato_variable", name: "declare_list", as: "acclist",
     input: {name: "accounts", list_item_schema_json: "..."},
     extended_input_schema: <from step_schema>, extended_output_schema: <from step_schema>},
  {op: "insert_step", ... provider: "salesforce", name: "search_sobjects", connection_id: 17977571,
     input: {sobject_name: "Account", limit: "150"}, dynamicPickListSelection: {sobject_name: "Account"},
     extended_output_schema: <from step_schema>},
  {op: "insert_step", ... provider: "workato_variable", name: "insert_to_list_batch", ...},
  {op: "insert_step", keyword: "foreach", source: <datapill on acclist list_items>, ...},
  {op: "insert_step", anchor: {into: <foreach>, position: "last"}, provider: "logger", name: "log_message",
     input: {message: <datapill on foreach current item Name>}}
])
  → summary, then the same call without dry_run
```

Then `workato_recipe_validate` and `workato_pull_recipe(step: "acclist")` to confirm `list_items` survived the save. The two `workato_step_schema` calls replace the two schema arrays an agent used to compose by hand, and the `input: {}` call is what caught the dead Salesforce connections in the probed workspace before a single step was written.

## Endpoint reference

For `workato_api_request` when a tool does not cover something.

| Endpoint                                                 | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/web_api/dynamic_app_config/<sha256>.js`                | The standard-connector CATALOGUE, 338 adapters on 2026-09-08. The hash is read from the HTML of `/` (`dynamic_app_config/([0-9a-f]{64})\.js`); the path without it is 404. Sets `window.Workato.config`; parse the JSON between `window.Workato.config = ` and `};\nvar providers`. 320 KB, served without a session, per deployment not per workspace.                                                                                                                                                                                                                |
| `/integrations/meta?name=a,b,c`                          | Full meta per adapter. Works for any standard connector with or without a connection here. Unknown names are omitted, HTTP 200, `{}` when none matched. The editor calls it with `&cacheKey=<x-workato-version>_<locale>` and shows `actions[]` minus `deprecated: true`.                                                                                                                                                                                                                                                                                              |
| `GET /connections.json?adapter[]=<provider>`             | The connections for one adapter, what the editor's Connection tab calls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST /connections/<id or adapter>/extended_schema.json` | The schema generator behind `workato_step_schema`. Body `{flow_id?, operation_name, input, dynamic_pick_list_selection?, depends_on?, list_schema?, only?: ["input","output"]}`; `<id>` is a connection id or, for a connectionless adapter, its slug. Returns `{result: {input: [...], output: [...], title, description, help}}`, the two arrays being the step's `extended_input_schema` and `extended_output_schema`. Saves nothing. Failure is HTTP 200 `{"error": "HTTP status code 420"}` (connection broken against the SaaS) or `{"error": "invalid_grant"}`. |
| `/web_api/mixed_assets/adapters.json`                    | Bare array of adapter names used by recipes in this workspace. Under 200 bytes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/web_api/published_custom_adapters.json`                | This workspace's SDK connectors: generated name, title, trigger/action counts, connection fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/web_api/certified_custom_adapters.json`                | Workato's certified community catalogue with `installed`. ~70 KB.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /connections/<id>/pick_list.json`                  | Dynamic pick list values. Body is the FIELD DEFINITION from `/integrations/meta`, plus optional `flow_id` and `pick_list_params`. Returns `{result: [[label, value], ...]}`. Answers HTTP 200 with `{"error": ...}` for a bad body, never a 4xx, so the status alone is not a success check.                                                                                                                                                                                                                                                                           |
| `/web_api/mixed_assets.json?asset_type=recipe`           | Recipe list. Each item already carries `trigger_application` and `action_applications`, which is what makes finding examples cheap. No server-side adapter filter was found (five plausible parameter names all silently returned the full list), so filter on those two fields client-side.                                                                                                                                                                                                                                                                           |
