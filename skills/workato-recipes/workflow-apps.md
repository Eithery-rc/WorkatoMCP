# Workato Workflow Apps (LCAP) pages

Everything here was read back from a live page's JSON after configuring that page in the Workato builder, on `app.workato.com`. Shapes that were never seen populated are listed under "Still unknown"; do not synthesise them.

A Workflow App page is a JSON tree, not HTML. The builder is one client of the same endpoints listed below, so a page can be read, patched and written entirely through fetches from a logged-in Workato tab.

## 1. Endpoints

```
GET    /web_api/lcap/apps.json                  list Workflow Apps  -> {result:[{id,name,project_id,unique_id,live,...}]}
POST   /web_api/lcap/pages.json                 create a page       -> 201 {result:{id,...}}
GET    /web_api/lcap/pages/<id>.json            read a page         -> {result:{id,name,path,folder_id,project_id,content,updated_at,...}}
PUT    /web_api/lcap/pages/<id>.json            replace its content -> {"result":"ok"}
DELETE /web_api/lcap/pages/<id>.json            delete the page     -> {"result":"ok"}
```

There is no page-list endpoint: `/web_api/lcap/pages.json` answers `No route matches [GET]`, while POST on the same path creates. Page ids come from the builder URL or the project asset view.

PUT body, whole tree only, no partial update:

```json
{ "page": { "id": 61604, "content": { "...full tree..." } } }
```

POST body:

```json
{ "page": { "folder_id": 30573643, "name": "My page", "path": "my-page", "content": { "...tree..." } } }
```

`path` is regenerated from `name` on create, so the value you send is advisory. `name` is stored with literal markdown (`"**Time Journal Submission form**"`), and is separate from any title text widget on the page.

### Auth

```
x-requested-with: XMLHttpRequest                       every call
x-csrf-token:     <URL-decoded XSRF-TOKEN-V2 cookie>   PUT, POST, DELETE
content-type:     application/json                     PUT, POST
```

There is no `<meta name="csrf-token">` on app.workato.com. Read the cookie instead:

```js
const tok = decodeURIComponent((document.cookie.match(/XSRF-TOKEN-V2=([^;]+)/) || [])[1] || '');
```

### 404 does not mean "no such page"

The workspace and environment are resolved server side from the tab's session. The same GET returns 404 from a tab parked on `app.workato.com/?fid=projects` and 200 from a tab on a recipe in the right workspace. Pin the tab, and pass both `tabId` and `profile` on every browser call: without `profile` the bridge resolves against the default Chrome profile and reports `Tab not found` for a tab that exists.

### The builder is a save hazard

`https://app.workato.com/lcap/pages/<id>` opens the page builder (EDITOR / PREVIEW / Save / Exit). Same rule as the recipe editor: do not PUT a page while its builder is open, because the builder's Save writes its own cached tree over yours. Reload the builder after any API write.

## 2. `content` shape

```json
{
  "type": "common",
  "maxWidth": "fixed",
  "spacing": "standard",
  "background": { "style": "color", "color": "#fafbfc" },
  "variables": [],
  "handlers": { "pageLoad": null },
  "layout": [1, ["<widget>", 0], ["<widget>", 1]]
}
```

`maxWidth` is `fixed` or `full`, `spacing` is `standard` or `compact` (both from the builder's Page panel).

## 3. Layout and the geometry trap

`layout` is `[1, [widget, N], [widget, N], ...]`, at page level and inside every container. The leading `1` is constant. `N` is the widget's row position; `x` and `width` are a 12 column grid. The renderer turns these into absolute CSS:

```html
<lcap-widget
  class="lcap-layout__widget"
  style="left: 0%; top: 48px; width: 33.3333%; height: 112px;"
></lcap-widget>
```

Nothing flows: widgets are absolutely positioned inside a `position: relative` layout. A container whose row extent collapses (for example two widgets both left at row 0 after a delete) can lose its computed `top` entirely, and every container after it then renders at `top: 0`, stacked. The PUT returns ok, the GET reads back exactly what you wrote, and `innerText` still lists every section in order. Only geometry shows it.

**Never delete a widget from a layout without renumbering the rows of what remains.**

What is safe, tested live: putting several widgets on the same row. Widths that tile inside the 12 columns sit side by side, and widths that overflow it do not overlap either. The renderer stacks them instead, giving each its own `top` inside a taller row, and the containers after it keep their own `top`. So a shared row is a layout choice, not a hazard; only the collapsed row extent above is.

Validate against the rendered DOM, not the JSON:

```js
[...document.querySelectorAll('.lcap-layout__widget')].map((w) => ({
  txt: (w.innerText || '').trim().slice(0, 26),
  style: w.getAttribute('style'),
}));
```

Every top level container must have `top:` in its style string, and no two may share a bounding-box `y`. The class is the same in both renderers; only the tag differs: `lcap-widget` in the portal, `lcap-widget-editor` in the builder, where each widget also carries a `.lcap-widget-editor__widget-blocker` overlay that intercepts clicks.

Screenshots are unreliable here: full-page captures of the portal have started at the third container both when the page was broken and when it was fine.

## 4. Widgets

Every widget carries `type`, `id` (8 lowercase hex), `name` (builder label), `x`, `width`, `visible`. **Never change an `id`**: it is the address datapills use. New ids can be minted by hand and render correctly.

Builder palette, the full widget vocabulary:

| Group   | Widgets                               |
| ------- | ------------------------------------- |
| DISPLAY | Text block, Container, Divider, Image |
| TEXT    | Short answer, Long answer             |
| CONTACT | Email, Phone, URL                     |
| NUMBER  | Number, Integer                       |
| DATE    | Date, Date and time                   |
| CHOICES | Checkbox, Single-select, Multi-select |
| VIEW    | Table                                 |
| BUTTON  | Button, Outline button                |
| FILE    | File download, File upload            |

### container

```json
{
  "type": "container",
  "id": "3e8a7cbc",
  "name": "Container (3)",
  "x": 0,
  "width": 12,
  "visible": true,
  "layout": [1, ["...children..."]],
  "backgroundColor": "#ffffff",
  "borderColor": "#ced5db",
  "padding": "large",
  "margin": "standard"
}
```

### text

```json
{
  "type": "text",
  "id": "c646c1d5",
  "name": "Text block",
  "x": 0,
  "width": 12,
  "visible": true,
  "text": "**Time Journal Submission**",
  "alignment": "center",
  "color": "#24434f",
  "pillsSupportMarkdown": false
}
```

Markdown in `text` renders even with `pillsSupportMarkdown: false`; that flag governs markdown inside interpolated datapills.

### divider

```json
{
  "type": "divider",
  "id": "49edbbc7",
  "name": "Divider",
  "x": 0,
  "width": 12,
  "visible": true,
  "backgroundColor": "#ced5db"
}
```

### dropdown (Single-select)

```json
{
  "type": "dropdown",
  "id": "df1984ea",
  "name": "Range type",
  "x": 0,
  "width": 4,
  "visible": true,
  "dataSource": null,
  "editable": true,
  "appFunctionOptions": null,
  "validations": { "required": { "condition": true } },
  "handlers": { "change": null },
  "label": "Range type",
  "hint": "...",
  "placeholder": "Last Month",
  "options": [
    { "title": "Last Month", "value": "Last Month" },
    { "title": "Specific Dates", "value": "Specific Dates" }
  ],
  "dataSourceOptions": null,
  "labelDataSource": null,
  "multiValue": false
}
```

`placeholder` is greyed helper text, not a default: with nothing selected the app function receives an empty string.

Source is either **Manual** (the static `options` array above) or **Recipe**. There is no data-table source for a dropdown. Choosing Recipe empties `options` and writes the same binding a table uses, leaving `dataSource`, `dataSourceOptions` and `labelDataSource` at `null`:

```json
{
  "options": [],
  "dataSource": null,
  "dataSourceOptions": null,
  "labelDataSource": null,
  "appFunctionOptions": { "recipeMeta": { "id": "77041720" }, "input": {} }
}
```

A recipe-backed dropdown runs its recipe on page load, the same task-consumption trap as a reactive table. Keep such a recipe cheap, or feed the list from a lookup table inside it.

### date

```json
{
  "type": "date",
  "id": "8f3ef394",
  "name": "From Date",
  "x": 4,
  "width": 4,
  "visible": true,
  "dataSource": null,
  "editable": true,
  "validations": { "required": { "condition": false } },
  "handlers": { "change": null },
  "label": "From Date",
  "hint": "...",
  "style": "date"
}
```

Values reach the recipe as `"2026-06-01"`.

### input (Short answer)

```json
{
  "type": "input",
  "id": "cb57d336",
  "name": "Netsuite Project Id",
  "x": 0,
  "width": 4,
  "visible": true,
  "dataSource": null,
  "editable": true,
  "validations": { "required": { "condition": false } },
  "label": "NetSuite Project ID",
  "hint": "...",
  "placeholder": "e.g. 338601",
  "style": "short-text"
}
```

`input` has no `handlers` key at all, unlike dropdown and date.

### table

```json
{
  "type": "table",
  "id": "082764d7",
  "name": "Time Journals",
  "x": 0,
  "width": 12,
  "visible": true,
  "editable": false,
  "appFunctionOptions": {
    "recipeMeta": { "id": "76887741" },
    "input": { "RangeType": { "type": "string", "required": false, "value": "#{_dp('...')}" } }
  },
  "handlers": { "activeRow": null },
  "title": "Preview",
  "description": "...",
  "addRowButtonText": "Add record",
  "displayedRowsCount": 25,
  "allowRowCreation": false,
  "allowRowDeletion": false,
  "forbidEmptyRows": false,
  "columnsSettings": [{ "id": "status", "visible": true, "readonly": true, "required": false }],
  "tableId": null,
  "relatedColumnId": null
}
```

`columnsSettings[].id` must match the property names the bound app function returns in `rows[]`; array order is the display order. `allowRowCreation` and `allowRowDeletion` default to `true`, which puts an "Add record" button on a read-only preview: set both to `false`. `tableId` is non-null only when the source is a Workato data table.

### button

```json
{
  "type": "button",
  "id": "14736441",
  "name": "Probe button",
  "x": 0,
  "width": 4,
  "visible": true,
  "handlers": { "click": null },
  "label": "Post to NetSuite",
  "style": "filled",
  "enabled": true
}
```

`name` is the builder label, `label` is the rendered caption; renaming `label` does not touch the binding.

## 5. Page variables

```json
"variables": [ { "id": "135a4f74", "name": "probeVarVariable", "dataType": "string", "defaultValue": "seed" } ]
```

`id` is 8 hex, the same address space as widgets. Builder data types: String, Number, Integer, Date, Date and time, Boolean, File. Only `"string"` has been read back from JSON; the others follow the same lowercased pattern but were not confirmed.

## 6. Datapills: three dialects

`_dp` is one mechanism with three payload shapes, selected by `pill_type` versus `source`:

```
recipe step    #{_dp('{"pill_type":"output","provider":"salesforce","line":"9ad56b78","path":["records"]}')}
page widget    #{_dp('{"source":"widget","id":"df1984ea","path":["value"]}')}
page variable  #{_dp('{"source":"page-variable","id":"135a4f74","path":["value"]}')}
```

The JSON inside `_dp('...')` must stay on one line with no added whitespace, in pages exactly as in recipes. Soft-wrapping or pretty-printing corrupts the reference: it saves fine and resolves to nothing.

## 7. Handlers

Three handler slots, one shape: `handlers.click` on a button, `handlers.change` on dropdown and date, `handlers.pageLoad` at page level. Each is `null` or an object whose `type` names the action.

### set-value

```json
{
  "type": "set-value",
  "elements": [
    { "entity": { "type": "variable", "id": "135a4f74" }, "type": "string", "value": "hello" },
    {
      "entity": { "type": "widget", "id": "bb22cc33" },
      "type": "string",
      "value": "#{_dp('{\"source\":\"page-variable\",\"id\":\"135a4f74\",\"path\":[\"value\"]}')}"
    }
  ],
  "followUpAction": null
}
```

`entity.type` is `variable` or `widget`. `value` is a literal or any datapill.

### invoke-app-function

```json
{
  "type": "invoke-app-function",
  "appFunctionOptions": {
    "recipeMeta": { "id": "76902321" },
    "input": {
      "RangeType": {
        "type": "string",
        "required": false,
        "value": "#{_dp('{\"source\":\"widget\",\"id\":\"df1984ea\",\"path\":[\"value\"]}')}"
      }
    }
  },
  "outputMapping": [],
  "followUpAction": null
}
```

The `input` keys must match the callee's `parameters_schema_json` field names exactly.

**`outputMapping` is inert in the current builder.** It is emitted as `[]` and no UI fills it, even when the bound recipe declares output fields on its `app_function_return` step (verified against a recipe declaring five). A button's recipe result does not become a page datapill either: the button never appears in the PAGE DATA tree. Do not design around reading a button's result on the page.

### open-webpage

```json
{ "type": "open-webpage", "url": "https://example.com", "target": "_blank" }
```

`target: "_blank"` is the builder's "Open in a new browser tab" checkbox. The `url` field is not trimmed: a leading space typed in the builder is stored verbatim.

### followUpAction

Same two objects, nested under a handler:

```json
"followUpAction": { "type": "reset-widgets-values", "ids": ["ee55ff66"] }
"followUpAction": { "type": "open-webpage", "url": "https://example.com", "target": "_blank" }
```

`ids` is the list of widget ids to reset. For a widget backed by an app function this is also what re-runs it, so this is how a submit button refreshes its preview table. Both forms were written by hand through the API and then read back correctly by the builder, so they are safe to generate.

### handlers.activeRow

A table's `handlers.activeRow` takes the same handler object as click and change. The row itself is addressed through the table's own widget pill, with `activeRow` as the first path element and the column name second:

```json
{
  "type": "set-value",
  "elements": [
    {
      "entity": { "type": "variable", "id": "aa00bb11" },
      "type": "string",
      "value": "#{_dp('{\"source\":\"widget\",\"id\":\"ee55ff66\",\"path\":[\"activeRow\",\"code\"]}')}"
    }
  ],
  "followUpAction": null
}
```

### Action vocabularies

| Trigger                        | Actions offered                                                | `type` values                                                              |
| ------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Button is clicked              | Open a webpage, Run recipe, Set value, Reset/reload components | `open-webpage`, `invoke-app-function`, `set-value`, `reset-widgets-values` |
| Value changed (dropdown, date) | Run recipe, Set value, Do nothing                              | `invoke-app-function`, `set-value`, `null`                                 |
| Page is loaded                 | Run recipe, Set value, Do nothing                              | `invoke-app-function`, `set-value`, `null`                                 |
| Active row changed (table)     | same as Value changed                                          |                                                                            |

`followUpAction` options: after a button click, Do nothing / Open a webpage / Reset/reload components; after page load, Do nothing / Reset/reload components.

## 8. Conditional `visible`

`visible` is `true`, or an expression array:

```json
[
  1,
  [8, "#{_dp('{\"source\":\"widget\",\"id\":\"df1984ea\",\"path\":[\"value\"]}')}", "Last Month"],
  [13, "#{_dp('{\"source\":\"widget\",\"id\":\"df1984ea\",\"path\":[\"value\"]}')}"]
]
```

Leading `1` is the combinator, AND. Each condition is `[opcode, lhs pill, rhs literal]` for a binary operator, or `[opcode, lhs pill]` for a unary one.

Full opcode table, every entry confirmed by setting it in the builder and reading the JSON back:

| Code | Operator           | Arity  |
| ---- | ------------------ | ------ |
| 1    | Contains           | binary |
| 2    | Doesn't contain    | binary |
| 3    | Starts with        | binary |
| 4    | Doesn't start with | binary |
| 5    | Ends with          | binary |
| 6    | Doesn't end with   | binary |
| 7    | Equals             | binary |
| 8    | Does not equal     | binary |
| 9    | Greater than       | binary |
| 10   | Less than          | binary |
| 11   | Is true            | unary  |
| 12   | Is not true        | unary  |
| 13   | Is present         | unary  |
| 14   | Is not present     | unary  |

The rhs is a plain literal or a datapill string. Only the AND combinator has ever been observed, and the current builder writes one condition at a time, so do not invent an OR form.

## 9. App function recipes behind a page

Two trigger types on adapter `workato_workflow_task`:

| Trigger                              | Paired return action                | Bound to                                       |
| ------------------------------------ | ----------------------------------- | ---------------------------------------------- |
| `app_function_load_table_request`    | `app_function_return`               | a table's `appFunctionOptions`                 |
| `app_function_load_dropdown_request` | `app_function_load_dropdown_return` | a dropdown's option source (`dataSource`)      |
| `app_function_generic_request`       | `app_function_return`               | a button's `handlers.click.appFunctionOptions` |

The trigger and action names come from `GET /integrations/meta?name=workato_workflow_task`, which is the authority on every field name in this file's recipe half. Its envelope is keyed by adapter name: `{ "<adapter>": { triggers: {...}, actions: {...} } }`.

Every app-function trigger carries a **hidden boolean marker** that is not optional. Omit it and the save succeeds with a validation error (`Trigger mark is not set in input field`) and the recipe will not start:

| Trigger                              | Marker field                                             |
| ------------------------------------ | -------------------------------------------------------- |
| `app_function_load_table_request`    | `_app_function_load_table_request_trigger_mark: true`    |
| `app_function_load_dropdown_request` | `_app_function_load_dropdown_request_trigger_mark: true` |
| `app_function_generic_request`       | `_app_function_generic_request_trigger_mark: true`       |

The table trigger also takes `table_schema_json`, a JSON string declaring the columns, next to `parameters_schema_json`.

Minimal working pair, no connections needed, useful as a template or as a stub while building a page:

```json
{
  "keyword": "trigger",
  "provider": "workato_workflow_task",
  "name": "app_function_load_dropdown_request",
  "as": "aa000001",
  "number": 0,
  "uuid": "...",
  "input": {
    "_app_function_load_dropdown_request_trigger_mark": true,
    "parameters_schema_json": "[]"
  },
  "block": [
    {
      "keyword": "action",
      "provider": "workato_workflow_task",
      "name": "app_function_load_dropdown_return",
      "as": "aa000002",
      "number": 1,
      "uuid": "...",
      "input": {
        "items": [
          { "value": "a", "label": "Alpha" },
          { "value": "b", "label": "Beta" }
        ]
      }
    }
  ]
}
```

`config` needs one entry: `{"keyword":"application","name":"workato_workflow_task","provider":"workato_workflow_task","skip_validation":false}`. Every node needs a `uuid`, or the save is rejected with `code is invalid: line=0, uuid not present`.

One recipe cannot be bound to both a table and a button, which is why the usual shape is a single callable engine (`workato_recipe_function` / `execute`) plus two thin caller recipes. See `code-tree.md` for the callable's `parameters_schema_json` / `result_schema_json` rules and the `result` wrapper, which is where the expensive silent failures live.

The trigger also carries the portal user, free audit data worth stamping onto anything a button writes:

```json
"context": { "session_id": "...", "user": { "email": "...", "id": "...", "name": "...", "user_groups": [] } }
```

Guard placement: `app_function_return` must sit outside any guard `if`, or the component receives nothing at all (not an empty result) when the condition is false.

## 10. Task consumption: the reactive table

A table's `appFunctionOptions` re-fires the app function on **every** bound widget change. Four inputs touched in sequence is four full runs of the recipe chain. Measured: five jobs in 22 seconds from one page session.

Two mitigations, both using confirmed shapes:

1. A guard `if` in the caller recipe so an unselected page load returns immediately without calling the engine.
2. Bind the table's inputs to page **variables** rather than to the widgets, and write the widget values into those variables from a button's `set-value` click handler. The table then re-fires only when the button is pressed. This needs only `set-value` with `entity.type: "variable"` plus `{"source":"page-variable"}` pills in `appFunctionOptions.input`.

The button-writes-its-result route is not available: see `outputMapping` above.

## 11. Still unknown

No populated example seen. Do not guess these.

- `dataSource`, `dataSourceOptions`, `labelDataSource`. They stay `null` for both dropdown source types, so whatever populates them is some other binding, most likely a table widget backed by a Workato data table (`tableId` / `relatedColumnId`).
- A multi-condition `visible` written by the current builder, and whether any combinator other than `1` exists.
- `content.type` values other than `"common"`, and `background.style` other than `"color"`.
