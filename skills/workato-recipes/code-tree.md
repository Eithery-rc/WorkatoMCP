# Workato recipe code-tree schemas

Reference doc mined from three production recipes:

- **62529313** (csv compare flow, 1.4 MB)
- **68617131** (Debug Gemini)
- **72652236** (AOF — Asset / Install Base sync; Salesforce-triggered, full control-flow + Variables-by-Workato coverage)

All JSON below is **verbatim** from those recipes (large `extended_*_schema` arrays truncated). Two additional recipes (67195786, 64168560) were spot-checked — no new node types.

---

## Top-level recipe shape

The pulled object is `{ recipe_id, code, version }`. `code` is the trigger node, and every step lives in `code.block` (and recursively in nested `block` arrays).

```json
{
  "recipe_id": 72652236,
  "code": {
    "keyword": "trigger",
    "...": "...",
    "block": [
      /* steps */
    ]
  },
  "version": {
    "config": "[{...},{...}]",
    "description": "",
    "folder_id": 25104336,
    "job_data_retention_policy": "default",
    "name": "AI CaseFlow PROD",
    "version_no": 5,
    "visibility_private": true,
    "worker_concurrency": 1
  }
}
```

`version.config` entries: `{"keyword":"application","provider":"salesforce","name":"salesforce","skip_validation":false,"account_id":14474811}` — one per distinct app `provider`. `account_id` is omitted for system providers (`logger`, `workato_recipe_function`, `workato_variable`, `workato_pub_sub`, `clock`, `csv_parser`, `py_eval`).

---

## Triggers

### Schedule — `provider:"clock", name:"scheduled_event"`

```json
{
  "as": "e74c2506",
  "input": { "time_unit": "minutes", "trigger_every": "5" },
  "keyword": "trigger",
  "name": "scheduled_event",
  "number": 0,
  "provider": "clock"
}
```

Required: `as`, `input.time_unit`, `input.trigger_every`. `time_unit` ∈ `minutes`/`hours`/`days`. `trigger_every` is a **string** integer.

### Recipe Function — `provider:"workato_recipe_function", name:"execute"`

```json
{
  "as": "0fd4f0d3-1b60-4310-8949-fea0603cc3b0",
  "keyword": "trigger",
  "name": "execute",
  "provider": "workato_recipe_function",
  "number": 0,
  "input": {
    "parameters_schema_json": "[{\"name\":\"Case\",\"type\":\"array\",\"optional\":false,\"properties\":[{\"name\":\"Subject\",\"type\":\"string\"}],\"of\":\"object\",\"label\":\"Case\"}]"
  }
}
```

| Key                            | Required | Notes                                                                                 |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------- |
| `as`                           | yes      | UUID datapill source for caller parameters                                            |
| `input.parameters_schema_json` | optional | **String-encoded** JSON schema array. Omit (`input:{}`) for a no-arg recipe function. |

Gotcha: `parameters_schema_json` is a string containing JSON, not nested JSON.

### Salesforce — `provider:"salesforce", name:"new_custom_object"` (single) / `"sobject_batch_created"` (batch)

```json
{
  "as": "147f5e51",
  "keyword": "trigger",
  "name": "new_custom_object",
  "provider": "salesforce",
  "number": 0,
  "input": {
    "___poll_interval": "5",
    "sobject_name": "Asset",
    "field_list": "Id\nParentId\nProductCode",
    "query": "((Product2.SKUProfile__c IN ('System ID')) OR (Manual_Creation__c = true))",
    "since_offset": "-604800",
    "batch_size": "100",
    "table_list": "OrderItem\nOrder\nProduct2"
  }
}
```

| Input field              | Notes                                                                             |
| ------------------------ | --------------------------------------------------------------------------------- |
| `sobject_name`           | SF object API name (`"Asset"`, `"Case"`)                                          |
| `field_list`             | Newline-separated SF field paths. Cross-object via `Relationship__r$Object.Field` |
| `query`                  | SOQL `WHERE` clause (no `SELECT`/`FROM`)                                          |
| `since` / `since_offset` | Absolute ISO timestamp **or** relative seconds-offset string                      |
| `___poll_interval`       | Seconds between poll cycles, string                                               |
| `batch_size`             | Records per job, string                                                           |
| `table_list`             | Newline-separated related objects                                                 |

For batch triggers, the datapill path starts with the plural array name and uses `current_item` (`["Case",{"path_element_type":"current_item"},"Id"]`).

---

## Control flow

### Foreach — `keyword:"foreach"`

```json
{
  "as": "0e8ba850",
  "keyword": "foreach",
  "number": 20,
  "clear_scope": "false",
  "repeat_mode": "simple",
  "source": "#{_dp('{\"pill_type\":\"output\",\"provider\":\"py_eval\",\"line\":\"e977d1e7\",\"path\":[\"output\",\"list\"]}')}",
  "input": {},
  "block": [
    /* nested steps */
  ]
}
```

Batch variant:

```json
{
  "as": "b6087497",
  "keyword": "foreach",
  "clear_scope": "false",
  "repeat_mode": "batch",
  "batch_size": "10",
  "source": "#{_dp('{...,\"line\":\"d6a1d0ff\",\"path\":[\"lines\"]}')}",
  "input": {},
  "block": [...]
}
```

| Key           | Required                   | Notes                                                                                                                                                                                              |
| ------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `as`          | yes                        | Datapill source. Inside the loop, reference current item via `{provider:"foreach", line:"<as>", path:["fieldname"]}`. Batch mode uses `path:["batch",{path_element_type:"current_item"},"<col>"]`. |
| `source`      | yes                        | **Top-level key, NOT inside `input`.** Always a `#{_dp(...)}` formula referencing a list pill.                                                                                                     |
| `repeat_mode` | yes                        | `"simple"` or `"batch"`.                                                                                                                                                                           |
| `batch_size`  | when `repeat_mode="batch"` | String integer.                                                                                                                                                                                    |
| `clear_scope` | yes                        | `"true"`/`"false"`.                                                                                                                                                                                |
| `input`       | yes                        | Always `{}` in observed samples.                                                                                                                                                                   |

**Critical**: `source` is at the **node root**, not under `input`. Workato's UI labels the field "Input list" which is misleading.

### If / Elsif / Else — `keyword:"if" | "elsif" | "else"`

`if`:

```json
{
  "keyword": "if",
  "number": 74,
  "input": {
    "type": "compound",
    "operand": "and",
    "conditions": [
      {
        "lhs": "=_dp('{\"pill_type\":\"output\",\"provider\":\"py_eval\",\"line\":\"553a9af4\",\"path\":[\"output\",\"results\"]}')",
        "operand": "blank",
        "rhs": "",
        "uuid": "5b9eddf0-948c-45b2-a0d3-e5493dbe8560"
      }
    ]
  },
  "block": [...]
}
```

`else`:

```json
{
  "keyword": "else",
  "number": 125,
  "input": {},
  "block": [...]
}
```

- `elsif` is identical to `if` but with `keyword:"elsif"`.
- `input.type` is always `"compound"`. `input.operand` joins conditions (`"and"`/`"or"`).
- Each condition: `{ lhs, operand, rhs, uuid }`. `lhs`/`rhs` are literals or `#{_dp(...)}` (interpolated) / `=_dp(...)` (formula).
- Observed operands: `equals_to`, `blank`, `greater_than`, `less_than`. Documented but TODO: `not_equals_to`, `contains`, `present`, `starts_with`, `ends_with`.
- **`elsif`/`else` are NESTED CHILDREN of `if.block`** — they go INSIDE the if's own `block` array, at the END, after the if-branch steps. Verified by parent-search on AOF (recipe 72652236) on 2026-05-12: every if-with-else has its else as the last entry of `if.block`, never as a sibling.
  ```
  if (cond):
    block:
      - <if-branch steps>
      - elsif (cond): block: [<elsif-branch steps>]    ← nested INSIDE if.block
      - else: block: [<else-branch steps>]              ← nested INSIDE if.block
  ```

### Repeat + while_condition — `keyword:"repeat"`

```json
{
  "as": "ac1fa99f",
  "keyword": "repeat",
  "number": 57,
  "input": {},
  "block": [
    {
      "keyword": "while_condition",
      "number": 60,
      "input": {
        "type": "compound",
        "operand": "and",
        "conditions": [
          {
            "lhs": "#{_dp('{...,\"path_element_type\":\"size\"}]}')}",
            "operand": "equals_to",
            "rhs": "0"
          },
          {
            "lhs": "#{_dp('{\"pill_type\":\"output\",\"provider\":\"repeat\",\"line\":\"ac1fa99f\",\"path\":[\"index\"]}')}",
            "operand": "less_than",
            "rhs": "3"
          }
        ]
      }
    },
    {
      /* actual loop body steps */
    }
  ]
}
```

There is **no `repeat_while` keyword**. The loop is `keyword:"repeat"`; its first child is the `while_condition` predicate (no `block`, no `as`). Use `_dp(...,provider:"repeat",line:"<repeat as>",path:["index"])` for the 0-based counter and `["is_first"]` for first-iteration boolean.

### Try / Catch — catch nests inside try.block

`catch` is the **LAST entry inside `try.block`**, not a sibling of `try`. Verified by parent-search on AOF (recipe 72652236) on 2026-05-12: `try.block` ends with `..., 'catch'` in every case.

```json
{
  "keyword": "try",
  "number": 3,
  "input": {},
  "block": [
    ,
    /* monitored steps */ {
      "as": "ca7c4e10",
      "keyword": "catch",
      "number": 6,
      "input": { "max_retry_count": "0", "retry_interval": "3" },
      "block": [
        /* error-handling steps */
      ]
    }
  ]
}
```

- `catch.as` is required.
- `max_retry_count="0"` means no retry. `retry_interval` is seconds (string).
- **Catch output field names are NOT `error_message`/`error_type`** — those are the documented names but Workato rejects them with `"Unknown data field 'Error message'"` on validation. The actual output schema is unknown — TODO, verify via the UI once Workato shows the catch's datapill picker. For now, write static catch-side log messages without referencing the catch's output, OR add an `extended_output_schema` declaring whatever fields you want to use (Workato will accept the names you declare).

### Stop — `keyword:"stop"`

```json
{
  "as": "e9e7b4df",
  "keyword": "stop",
  "number": 8,
  "input": { "stop_with_error": "false" }
}
```

With error:

```json
{
  "input": {
    "stop_reason": "Number of System IDs do not equal quantity",
    "stop_with_error": "true"
  }
}
```

`stop_reason` is required when `stop_with_error="true"`; supports `#{_dp(...)}` interpolation. Omit otherwise.

### Return result — `keyword:"action", name:"return_result", provider:"workato_recipe_function"`

```json
{
  "as": "a5212e2e",
  "keyword": "action",
  "name": "return_result",
  "provider": "workato_recipe_function",
  "number": 3,
  "input": {}
}
```

`keyword:"action"` (not its own keyword!). With `input:{}` it returns nothing. Output schema for Recipe Functions is declared elsewhere — TODO, not observed.

---

## Variables by Workato — `provider:"workato_variable"`

**This is the missing piece for foreach-over-typed-list workflows.** The `source` of a foreach must be a **list datapill**, not a literal `=['a','b','c']`. To get one, declare a typed list with `declare_list` and (usually) populate via `insert_to_list` or inline `list_items`.

### declare_list — `name:"declare_list"` (verified end-to-end 2026-05-12)

Complete shape — pre-populated list, ready for foreach iteration:

```json
{
  "as": "641f89e1",
  "keyword": "action",
  "name": "declare_list",
  "provider": "workato_variable",
  "number": 1,
  "input": {
    "name": "Items",
    "list_item_schema_json": "[{\"name\":\"value\",\"type\":\"string\",\"optional\":false,\"control_type\":\"text\",\"label\":\"Value\"}]",
    "list_items": [{ "value": "apple" }, { "value": "banana" }, { "value": "cherry" }]
  },
  "extended_input_schema": [
    {
      "label": "Items",
      "name": "list_items",
      "of": "object",
      "optional": true,
      "properties": [
        {
          "control_type": "text",
          "label": "Value",
          "name": "value",
          "optional": false,
          "type": "string"
        }
      ],
      "type": "array"
    }
  ],
  "extended_output_schema": [
    {
      "label": "Items",
      "name": "list_items",
      "of": "object",
      "optional": false,
      "properties": [
        {
          "control_type": "text",
          "label": "Value",
          "name": "value",
          "optional": false,
          "type": "string"
        }
      ],
      "type": "array"
    }
  ]
}
```

| Input                   | Required | Notes                                                                                                                                                               |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | yes      | Human label ("Items")                                                                                                                                               |
| `list_item_schema_json` | yes      | **String-encoded JSON array** of field defs. Each: `{name, type, control_type, label, optional}`. Use `type:"string", control_type:"text"` for strings.             |
| `list_items`            | optional | Inline pre-population as a **real JSON array** of objects matching `list_item_schema_json` field names. No `____source` wrapper — just `[{value:"a"},{value:"b"}]`. |

**CRITICAL — silent strip risk:** Workato persists `input.list_items` ONLY if you also include `extended_input_schema` declaring a `list_items` array field. Without it, the save reports `code_errors:[]` but the items are SILENTLY DROPPED on readback.

**For foreach to source this list**, you MUST also include `extended_output_schema` with the same `list_items` array shape. Without it, foreach.source fails with `"Unknown data field 'List items' used in source"`.

**Datapill to reference the list** from a downstream foreach:

```
"#{_dp('{\"pill_type\":\"output\",\"provider\":\"workato_variable\",\"line\":\"<declare_list.as>\",\"path\":[\"list_items\"]}')}"
```

- `line` is the **`as`** (8 hex chars), NOT the `<uuid>:<as>` composite.
- `path` is `["list_items"]` (the literal field name from extended_output_schema).
- Inside the foreach: `provider:"foreach", line:"<foreach.as>", path:["value"]` (or whatever list_item field name).

`insert_to_list` (alternative to inline `list_items`): still uses the `"<declare_list.uuid>:<declare_list.as>"` composite for `input.name` — that's a separate lookup format, not the datapill format.

### insert_to_list — `name:"insert_to_list"`

```json
{
  "as": "e48d0745",
  "keyword": "action",
  "name": "insert_to_list",
  "provider": "workato_variable",
  "input": {
    "name": "fda41c1c-b715-4c30-8094-5974415c2b40:fd7c15ca",
    "location": "end",
    "list_item": {
      "OrderItemNumber": "#{_dp('{...,\"path\":[\"OrderItemNumber\"]}')}",
      "SystemId": "#{_dp('{...}')}"
    }
  }
}
```

`location` observed: `"end"`. `"start"`/numeric index TODO. `list_item` keys must match `list_item_schema_json` field names.

### declare_variable — `name:"declare_variable"` (single typed variable)

```json
{
  "as": "e65113a6",
  "keyword": "action",
  "name": "declare_variable",
  "provider": "workato_variable",
  "input": {
    "variables": {
      "data": {
        "asset_id": "=_dp('{...,\"path\":[\"SBQQ__RequiredByAsset__c\"]}') or _dp('...,\"path\":[\"Id\"]}')"
      },
      "schema": "[{\"name\":\"asset_id\",\"type\":\"string\",\"optional\":true,\"label\":\"Asset ID\",\"control_type\":\"text\"}]"
    }
  }
}
```

Multiple variables in one step: add more keys to `data` and entries to `schema`.

### update_variables — `name:"update_variables"`

```json
{
  "keyword": "action",
  "name": "update_variables",
  "provider": "workato_variable",
  "input": {
    "input_mode": "raw",
    "name": "6ed0ff64-5408-4c61-9f6e-d807328bb851:e65113a6:asset_id",
    "asset_id": "=_dp('...').sub(/^[0]+/,'')"
  }
}
```

`input.name` format: `<declare_variable.uuid>:<declare_variable.as>:<variable_name>`. The new value goes under a key matching the variable name.

---

## Actions (alphabetical)

### Clock — `clock / wait_for_interval`

```json
{ "input": { "interval": "10" } }
```

`interval` is seconds (string integer or formula). Useful inside `repeat` loops for backoff.

### CSV parser — `csv_parser / parse_csv`

```json
{
  "input": { "csv_content": "Id,Description\n500N...", "col_sep": ",", "column_value_by": "index" }
}
```

`column_value_by`: `"index"` (rows at `<as>/lines/column_N`) or `"header"` (named columns).

### Email — `email / send_mail`

```json
{
  "input": {
    "to": "...@...",
    "subject": "#{_dp('...')}",
    "body": "see attachments",
    "email_type": "html",
    "attachments": { "file_binary_content": "#{_dp(...)}", "file_name": "results.csv" }
  }
}
```

`email_type`: `"html"` or `"plain"`. Single attachment supported.

### Google Sheets — `google_sheets / add_row_v4_bulk`

```json
{
  "input": {
    "spreadsheet": "<sheet id>",
    "sheet": "Sheet1",
    "team_drives": "my_drive",
    "rows": {
      "____source": "#{_dp('{...,\"path\":[\"responses\"]}')}",
      "col_Id": "#{_dp('{...,\"path\":[\"responses\",{\"path_element_type\":\"current_item\"},\"id\"]}')}"
    }
  }
}
```

Bulk action: `rows.____source` is the iterable list pill; `col_<HeaderName>` references per-item values via `current_item`.

### Logger — `logger / log_message`

```json
{ "input": { "message": "...", "user_logs_enabled": "false" } }
```

`message`: plain text or `#{_dp(...)}`. `user_logs_enabled:"true"` sends to Workato's customer log service.

### NetSuite — `netsuite / execute_suiteql`

```json
{
  "input": {
    "limit": "1000",
    "offset": "0",
    "query": "=\"SELECT BUILTIN.DF(...) FROM CUSTOMRECORD_AVID_SERIAL_NUMBER WHERE custrecord_avid_inven_sf_line_name = '\" + _dp('{...}').sub(/^[0]+/,'') + \"'\"",
    "output_schema": "[{\"control_type\":\"text\",\"label\":\"IF Tran\",\"type\":\"string\",\"name\":\"if_tran\"}]"
  }
}
```

`query` is a Ruby-formula string (note the `=` prefix). `output_schema` is string-encoded; rows under `<as>/items`.

### Python — `py_eval / invoke_custom_py_code`

```json
{
  "input": {
    "name": "unique systemIds",
    "code": "def main(input):\n    ...\n    return {...}",
    "code_input": {
      "data": { "SystemIDsANDSerialNumbers": "#{_dp('{...}')}" },
      "schema": "[{\"control_type\":\"text\",\"name\":\"SystemIDsANDSerialNumbers\",\"type\":\"string\",\"optional\":true,\"parent\":[\"code_input\",\"data\"]}]"
    },
    "code_output_schema_json": "[{\"name\":\"list\",\"type\":\"array\",\"of\":\"object\",\"properties\":[{\"control_type\":\"text\",\"label\":\"System ID\",\"type\":\"string\",\"name\":\"SystemID\"}]}]"
  }
}
```

Function signature `def main(input): ... return {...}`. Inputs in `input["<name>"]`; outputs declared in `code_output_schema_json` accessible at `<as>/output/<field>`.

### Salesforce — `salesforce / search_sobjects_soql_v2` (read) & `update_bulk_job` (write)

```json
{
  "input": {
    "limit": "150",
    "query": "SELECT id FROM OrderItem WHERE OrderItemNumber = '#{_dp(\"...\")}'",
    "output_schema": "[{\"properties\":[...],\"name\":\"Sales_Order_Product__r\",\"type\":\"object\"}]"
  }
}
```

Bulk update: `input.object`, `input.csv_data.{csv,csv_columns,col_sep,skip_first_line}`, `input.records.<sf_field>` (CSV column index as string), `input.advanced.{wait_to_complete,csv_chunk_size}`.

### Workato Files — `workato_files / store_file` and `get_file_contents`

```json
{
  "input": {
    "file_path": "/case_routing",
    "file_name": "results.csv",
    "content": "#{_dp('{...}')}",
    "overwrite": "true"
  }
}
```

`get_file_contents`: only `input.file_path`. Output pill `content`.

### Workato Pub-Sub — `workato_pub_sub / publish_to_topic_batch`

```json
{
  "input": {
    "topic_id": "39566",
    "messages": {
      "Application": "NETSUITE",
      "ErrorMessage": "...",
      "FlowCode": "#{_dp('{\"pill_type\":\"job_context\",\"path\":[\"parameters\",\"flowCode\"]}')}"
    }
  }
}
```

`topic_id` is the numeric id as a string.

### Workato Recipe Function — `workato_recipe_function / call_recipe`

```json
{
  "as": "7a8394a3",
  "keyword": "action",
  "name": "call_recipe",
  "provider": "workato_recipe_function",
  "input": {
    "flow_id": "67992143",
    "parameters": {
      "severity": "LOW",
      "sysid_param": {
        "asset_id": "#{_dp('{...,\"path\":[\"Id\"]}')}",
        "status": "Installed"
      }
    }
  }
}
```

`flow_id` is the target recipe id **as a string**. `parameters` must match the target trigger's `parameters_schema_json`. Outputs available under `provider:"workato_recipe_function", line:"<as>", path:[...]`.

**Silent-strip rule applies here too** — `input.parameters` is dropped on save unless you include the matching `extended_input_schema`:

```json
"extended_input_schema": [{
  "label": "Parameters",
  "name": "parameters",
  "properties": [
    { "control_type": "text", "label": "value", "name": "value", "optional": false, "type": "string" }
  ],
  "type": "object"
}]
```

Each parameter in the target's `parameters_schema_json` becomes one entry in `properties[]`.

---

## Common patterns

### Datapill formulas

- **Interpolated string**: `"#{_dp('{\"pill_type\":\"output\",\"provider\":\"salesforce\",\"line\":\"147f5e51\",\"path\":[\"Id\"]}')}"` — embeds the value inline within a string field.
- **Pure formula**: `"=_dp('{...}').is_true? ? 0 : 10"` — `=` prefix makes the whole field a Ruby expression.
- **Path elements**: literal strings (`"Id"`, `"records"`) or annotated objects:
  - `{"path_element_type":"current_item"}` — current loop item (inside foreach/bulk lists).
  - `{"path_element_type":"size"}` — count of an array.
- **Pill types**: `"output"` (step result), `"job_context"` (job/recipe metadata — paths like `["job_id"]`, `["recipe_name"]`, `["parameters","<name>"]`).
- **Provider sources**: app names (`"salesforce"`, `"netsuite"`, `"py_eval"`), control flow (`"foreach"`, `"repeat"`, `"catch"`), or `"workato_variable"`.

### Numbering

`number` is **globally sequential** across the entire recipe tree, including nested `block` arrays. The trigger is `0`; its first child is `1`; a deeply nested step inside a foreach inside a try inside an if continues the same monotonic counter. When inserting steps, renumber everything that comes after.

### `as` and UUID

- `as` is **exactly 8 lowercase hex chars** (`/^[0-9a-f]{8}$/`) — e.g. `"7a8394a3"`, `"641f89e1"`. Required on every node that produces output. Used as the datapill `line`.
- **Workato silently rejects non-hex `as` values.** E.g. `"declare1"` (contains `l` which is not hex) is treated as an invalid identifier; foreach.source pointing at such an `as` will fail with `"Unknown data field <Capitalized>"`. Always use proper hex like `crypto.randomBytes(4).toString('hex')`.
- `uuid` is the full UUID v4; the API tolerates omitting it on simple action shapes but every saved recipe has it. Generate with `crypto.randomUUID()`.

### `version.config` deduplication

Each distinct `provider` used in the recipe gets one entry. System providers (`logger`, `workato_recipe_function`, `workato_variable`, `workato_pub_sub`, `clock`, `csv_parser`, `py_eval`) omit `account_id`; connection-based providers include it.

### Extended schemas — NOT safe to omit (silent-strip rule)

`extended_input_schema` and `extended_output_schema` are **NOT** universally safe to omit. The rule:

- **`extended_input_schema` is REQUIRED** whenever `input` contains non-trivial structured fields that aren't part of the action's _base_ schema. Examples observed: `declare_list.input.list_items` (array), `call_recipe.input.parameters` (object). Without the matching `extended_input_schema` entry, Workato accepts the save (`code_errors:[]`) but **silently drops those fields** on readback.
- **`extended_output_schema` is REQUIRED** on any step whose output is referenced by a downstream `_dp(...)` datapill into a non-trivial path. Without it, the referencing step fails validation with `"Unknown data field 'X' used in <field>"`.

Trivial inputs (a single string field on a base-schema field like `logger.input.message`) **don't** need extended schemas. The danger zone is structured/array inputs and any output that gets sourced by foreach/datapill references.

When writing the schema, mirror the shape Workato itself emits: `{label, name, type, of?, properties[], control_type?, optional?, hint?}`. The `name` must match the key under `input` (input schema) or the path segment (output schema).

### Genuinely optional metadata keys (safe to omit on creation)

`title`, `description`, `comment`, `skip`, `dynamicPickListSelection`, `visible_config_fields`, `toggleCfg`, `requirements`.

### Not observed (TODO)

- `keyword:"handle_errors"` — never seen; error handling uses `try`/`catch` instead.
- Foreach `repeat_mode` values other than `"simple"` and `"batch"`.
- Conditional operands beyond `equals_to`, `blank`, `greater_than`, `less_than`.
- Recipe Function output schema declaration location.

---

## How to use this skill

When authoring or mutating Workato recipes via the WorkatoMCP tools:

1. **For each step** you want to add, find the matching schema above. Copy the verbatim sample. Customize ONLY the fields the row table marks as required + the inputs you actually need.

2. **Compose into a tree** with proper sequential `number` values and a fresh `as`/`uuid` per output-producing node.

3. **Save** via `workato_ui_save_recipe_code(recipe_id, code, config)` — `code` is the trigger object with nested `block`; `config` is the deduplicated `[{keyword:"application", name, provider, skip_validation:false, account_id?}]` array.

4. **Validate**: check the response's `code_errors`. Empty `[]` = clean save. Otherwise the errors point to fields/blocks that need fixing.

Common mistakes:

- Putting `source` inside `foreach.input` (it goes at root).
- Inlining `=['a','b','c']` as foreach `source` instead of using a Variables `declare_list` + datapill reference.
- Using `keyword:"repeat_while"` (there's no such thing — use `repeat` with a `while_condition` first child).
- **Treating `else`/`elsif` as siblings of `if`** — they NEST inside `if.block` at the end. Same for `catch`: nests as the last entry inside `try.block`.
- **Trusting documented catch field names `error_message`/`error_type`** — Workato rejects those. The real catch output schema is undocumented; either skip catch-output references or declare your own via `extended_output_schema`.
- **Using a non-hex `as`** (e.g. `"caller00"`, `"declare1"`). Must be `/^[0-9a-f]{8}$/`.
- **Omitting `extended_output_schema`** on a step whose output is referenced by a downstream datapill — the reference fails validation.
- **Omitting `extended_input_schema`** when writing structured `input` fields (arrays, nested objects) — Workato silently drops them on save. Symptom: `code_errors:[]` but `pull_recipe` shows the data is gone.
