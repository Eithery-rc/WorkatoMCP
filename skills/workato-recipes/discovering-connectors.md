# Discovering a connector you have not used before

How to go from "the recipe should send an email" to a step that actually works, without an existing example to copy. This is the part that has no answer in `code-tree.md`: that file documents the shapes of connectors already known, this one is about finding the shape of one that is not.

Everything below was verified against a live workspace on 2026-08-26. Where Workato offers nothing, this file says so rather than leaving a gap that reads like an oversight.

## The ladder

Four questions, in order. Each one narrows the next.

| Question                                                            | Tool                                             |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| Which apps can I use here, and what is each one called technically? | `workato_apps_list`                              |
| What can this connector do?                                         | `workato_adapter_meta` (index mode: bare call)   |
| What does this operation take?                                      | `workato_adapter_meta` with `operation:"<name>"` |
| What values does this field accept, in THIS workspace?              | `workato_pick_list`                              |
| What does a working call look like here?                            | `workato_recipe_step_search`                     |

Then write the step with `workato_recipe_add_step`, which mints the `as` anchor and `uuid`, renumbers the block and deduplicates `config` for you.

## Step 1 — find the technical adapter name

`step.provider` is a technical name, never a title. For standard connectors it is usually the lowercase title (`slack`, `hubspot`, `salesforce`), but for anything custom it is a generated string nobody can guess:

```
netsuite_rest_connector_5105163_1745592003    title: "NetSuite REST v2"
enerflo_connector_5105163_1744901872          title: "Enerflo"
```

`workato_apps_list` maps titles to those names, and tags each app with where it was seen:

- `connection` — a real connection exists here, so a step can authenticate today. The connection ids and `authorization_status` come with it; a `connection_lost` status is why an otherwise correct step fails at run time.
- `recipes` — already used by a recipe here, so step 4 will find live examples.
- `custom` — this workspace's own SDK connector.
- `builtin` — one of Workato's own connectors, always available. See the table below: this is where the display name and the adapter name diverge hardest.
- `certified` — in Workato's certified community catalogue, not installed here.

### No connection: stop and ask the user

**These tools cannot create a connection**, deliberately: it means handing over the customer's credentials, and only a person can do that. So when the app needs one and the workspace does not have one, the answer is to stop and ask, not to build the step anyway.

Check in this order:

1. **`connection_required: false`** on the adapter (`workato_adapter_meta`, or the `builtin` entries in `workato_apps_list`). Then no connection exists or is needed, and there is nothing to ask for. This covers `email`, `logger`, `py_eval`, `clock`, `workato_variable`, `lookup_table` and the rest of Workato's own tools.
2. **A `connection` entry in `workato_apps_list`** with `authorization_status: "success"`. Use its `id` as the `account_id` in the recipe `config`.
3. **Anything else** is a blocker. Either there is no connection at all, or there is one whose status is not `success` (`connection_lost` is the common case, and it reads as working right up until the recipe runs).

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

`workato_apps_list` carries all of these and searches their live titles and aliases, so "event stream", "pub/sub", "scheduler", "python" and "approval" each resolve to the right adapter. Only the list of names is fixed in the tool; titles and aliases are read from `/integrations/meta` on every call, so a rename shows up immediately.

### The one real gap

**Workato serves no catalogue of its standard connectors.** The recipe editor's app picker issues no network request at all: the list is compiled into its bundle, the DOM carries titles without technical names, and the list is virtual-scrolled. There is no endpoint to page through.

That leaves the third-party standard connectors. An app missing from `workato_apps_list` is _not_ proof it does not exist. Resolve it by guessing instead, which is cheap because `/integrations/meta` takes a comma-separated list and silently omits names it does not know:

```
workato_adapter_meta(adapter: ["slack", "gmail", "microsoft_teams"])
```

Names that resolved come back with `title`, `aliases` and `categories`, which is what confirms the guess landed on the right app. The rest are listed under `not_found`. A completely unknown name returns `{}` with HTTP 200, never a 404, so absence is the only signal.

## Step 2 — list the operations

A bare `workato_adapter_meta(adapter: "email")` returns the index: operation names, titles, help, and field counts. This stays small on purpose — a large connector's full meta runs to hundreds of KB.

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

## Step 4 — find how it is used here

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

workato_recipe_add_step(
  recipe_id: <id>, after_step: 0,
  provider: "email", action_name: "send_mail",
  input: {to: "...", subject: "...", body: "...", email_type: "html"})
```

No dynamic pick list on this action, so no `dynamicPickListSelection`. An action like `salesforce.search_sobjects` would need one.

No `account_id` in `config` for this provider, because `connection_required` was false.

## Endpoint reference

For `workato_api_request` when a tool does not cover something.

| Endpoint                                       | Returns                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/integrations/meta?name=a,b,c`                | Full meta per adapter. Works for any standard connector with or without a connection here. Unknown names are omitted, HTTP 200, `{}` when none matched.                                                                                                                                       |
| `/web_api/mixed_assets/adapters.json`          | Bare array of adapter names used by recipes in this workspace. Under 200 bytes.                                                                                                                                                                                                               |
| `/web_api/published_custom_adapters.json`      | This workspace's SDK connectors: generated name, title, trigger/action counts, connection fields.                                                                                                                                                                                             |
| `/web_api/certified_custom_adapters.json`      | Workato's certified community catalogue with `installed`. ~70 KB.                                                                                                                                                                                                                             |
| `POST /connections/<id>/pick_list.json`        | Dynamic pick list values. Body is the FIELD DEFINITION from `/integrations/meta`, plus optional `flow_id` and `pick_list_params`. Returns `{result: [[label, value], ...]}`. Answers HTTP 200 with `{"error": ...}` for a bad body, never a 4xx, so the status alone is not a success check.  |
| `/web_api/mixed_assets.json?asset_type=recipe` | Recipe list. Each item already carries `trigger_application` and `action_applications`, which is what makes finding examples cheap. No server-side adapter filter was found — five plausible parameter names all silently returned the full list — so filter on those two fields client-side. |
