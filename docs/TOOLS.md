# Tool reference

66 Workato tools, plus the browser-automation tools inherited from the upstream project.

The authoritative definitions live in [`packages/shared/src/tools.ts`](../packages/shared/src/tools.ts) — this document is written from them. If the two ever disagree, the schema wins.

- [Conventions](#conventions)
- [Recipes & versions](#recipes--versions)
- [Jobs](#jobs)
- [Search & connections](#search--connections)
- [Connector execution](#connector-execution)
- [Projects & folders](#projects--folders)
- [Code-side recipe editing](#code-side-recipe-editing)
- [Recipe editor UI](#recipe-editor-ui)
- [Lookup tables](#lookup-tables)
- [Data tables](#data-tables)
- [Session](#session)
- [Common workflows](#common-workflows)
- [Inherited browser tools](#inherited-browser-tools)

## Conventions

**Every Workato tool needs a signed-in Workato tab.** Requests are executed inside that tab's origin, using its cookies and CSRF token. Nothing works without one.

**Tab resolution** — a tool targets, in order: an explicit `tabId`, the tab pinned by `workato_switch_profile`, a Workato tab in the same window, then any open Workato app tab. It never targets "whatever tab happens to be focused". Two different Workato hosts open at once (say US and EU) is ambiguous and fails with `MultipleWorkatoHosts`.

**Slim by default** — read tools return a compact, agent-shaped payload. Pass `full: true` where offered to get Workato's raw response instead.

**Timeouts** — `timeout_ms` is accepted on the long reads (`pull_recipe`, `list_jobs`, `job_trace`, `recipe_version_diff`, `run_query`). Default 30 s (40 s for diffs), clamped to 10–110 s. The bridge's own ceiling is 120 s, and most MCP clients cut off around 60 s, so values above ~55 s also disable the automatic single retry.

**Writes are verified, never blind-retried.** If a write times out, the tool re-reads state to determine whether it actually landed and reports `save_status: "succeeded_after_timeout"` rather than a false failure.

**Error codes**

| Code                    | Meaning                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `TabNotFound`           | No signed-in Workato app tab, or the given `tabId` isn't one                               |
| `MultipleWorkatoHosts`  | Several Workato regions open simultaneously — close all but one                            |
| `WorkatoUnsafeAction`   | `workato_call_action` blocked a write-shaped action; pass `allow_writes: true` if intended |
| `WorkatoConnectorError` | The connector itself rejected the call (bad input shape, unsupported dialect, auth)        |
| `ScriptExecutionFailed` | The in-tab script could not run (page navigating, tab closed)                              |
| `UnexpectedShape`       | Workato returned a payload the tool could not parse                                        |

Every tool also accepts `tabId` (and the UI/table families accept `windowId`); they're omitted from the tables below.

---

## Recipes & versions

| Tool                          | Required                          | Optional                                                | Description                                                              |
| ----------------------------- | --------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `workato_pull_recipe`         | `recipe_id`                       | `view`, `step`, `field_query`, `out_file`, `timeout_ms` | Fetch a recipe's code tree plus version metadata                         |
| `workato_rename_recipe`       | `recipe_id`, `name`               | —                                                       | Rename a recipe (`PUT /recipes/<id>.json`)                               |
| `workato_start_recipe`        | `recipe_id`                       | `wait`, `wait_timeout_ms`                               | Start a recipe; `wait: true` polls until the state flips                 |
| `workato_stop_recipe`         | `recipe_id`                       | `force`, `wait`, `wait_timeout_ms`                      | Stop a recipe; `force: true` enqueues the stop despite active dependents |
| `workato_recipe_status`       | `recipe_id`                       | —                                                       | Cheap live-state read — the standard post-write verification             |
| `workato_recipe_version_diff` | `recipe_id`, `from`, `to`         | `value_excerpt_chars`, `timeout_ms`                     | Changed steps only, between any two saved versions                       |
| `workato_set_version_comment` | `recipe_id`, `version`, `comment` | —                                                       | Annotate a version (empty string clears it)                              |

### `workato_pull_recipe` views

The single most-used tool. Pick the lightest view that answers the question:

| `view`                 | Returns                                                                                                                                                       | Use for                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `compact` (default)    | Full step tree with UI metadata stripped and `_dp(...)` datapills shortened to a readable `datapill(...)` form                                                | Understanding a whole recipe             |
| `outline`              | Step tree and descriptions only, no inputs                                                                                                                    | Very large recipes that overflow compact |
| `step: "<as\|number>"` | One step: inputs classified as datapill / formula / interpolated / literal / code, the settable `fields`, and the `available_datapills` upstream steps expose | Working on a single step                 |
| `full`                 | The lossless raw tree with exact `_dp(...)` references                                                                                                        | Wholesale tree rewrites                  |

`field_query` filters a step's `fields` and `available_datapills` by name, label, or ref. `out_file` writes the tree to disk through the bridge instead of returning it inline — **use it for recipes above roughly 50 KB** so the tree never enters the model's context; `workato_ui_save_recipe_code(code_path: ...)` reads it back.

`workato_recipe_status` returns `{running, state, version_no, last_run_at, stopped_at, stop_reason, stopped_for_error, job_succeeded_count, job_failed_count}`.

`workato_recipe_version_diff` returns `{summary, added, removed, changed}` with field-level `{path, from, to}` excerpts. Steps that merely got renumbered by an insertion above them count in `summary.moved` but aren't listed.

## Jobs

| Tool                 | Required               | Optional                                                                                        | Description                               |
| -------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `workato_list_jobs`  | `recipe_id`            | `limit`, `status`, `query`, `started_at`, `group_by_master_job`, `cursor`, `full`, `timeout_ms` | List jobs, auto-walking cursor pagination |
| `workato_job_trace`  | `recipe_id`, `job_id`  | `lines`, `line_range`, `detail`, `full`, `timeout_ms`                                           | Per-step execution trace for one job      |
| `workato_repeat_job` | `recipe_id`, `job_ids` | —                                                                                               | Re-run one or more jobs by master job id  |

`workato_list_jobs` walks pagination under the hood up to `limit` (default 25, max 100). `query` is full text and matches the job title, the error message, **and the custom job-report columns** — so searching a record id straight out of the job report finds its job. If the walk runs out of time it returns what it scanned with `partial: true`, `scanned_through`, and `next_cursor` to resume; partial results are never discarded.

`workato_job_trace` strips schema noise (`output_schema`, `extended_*_schema`) from summaries and truncates step input/output to 500 characters. Narrow with `lines: [104, 118]` (exact set) or `line_range: [91, 123]` (inclusive), and add `detail: "full"` to get a selected step's exact untruncated payload — the way to answer _"what precisely did step 118 receive in this job"_.

## Search & connections

| Tool                         | Required        | Optional                                                | Description                                                 |
| ---------------------------- | --------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| `workato_search_recipes`     | —               | `text`, `folder_id`, `page`, `sort`, `full`             | Search recipes by name                                      |
| `workato_search_connections` | —               | `text`, `provider`, `folder_id`, `page`, `sort`, `full` | Search connections by name, optionally filtered by provider |
| `workato_get_connection`     | `connection_id` | `full`                                                  | One connection, with secrets stripped                       |

Workato caps pagination at 20 items per page server-side; step through with `page: N`.

`text` matches connection **names**, not the `provider` field. The `provider` parameter is applied client-side (Workato ignores `provider=` on the endpoint) by walking up to five pages.

**`workato_get_connection` always strips auth material, including under `full: true`.** An agent that needs to reach the SaaS should go through the connection itself — `workato_run_query` or `workato_call_action` — not extract a token.

## Connector execution

| Tool                  | Required                                | Optional                            | Description                                   |
| --------------------- | --------------------------------------- | ----------------------------------- | --------------------------------------------- |
| `workato_run_query`   | `connection_id`, `query`, `type`        | `schema_only`, `full`, `timeout_ms` | Run SOQL / SuiteQL / SQL through a connection |
| `workato_call_action` | `connection_id`, `action_name`, `input` | `allow_writes`, `full`              | Invoke any connector action (gated)           |

### `workato_run_query`

Returns `{type, count, truncated_to_100, schema, rows}` regardless of the underlying SaaS. `connection_id` is the `shared_account_id` from `workato_search_connections` or from a recipe's `version.config`.

- **Hard-capped at ~100 rows server-side.** Narrow with a `WHERE` clause.
- **SOQL** — a trailing `LIMIT` is stripped before sending, because Workato appends its own and the two collide.
- **SuiteQL** — works against both NetSuite REST and SOAP connections.
- **SQL** — adapter-dependent; unsupported connectors surface `WorkatoConnectorError`.
- `schema_only: true` returns field metadata without rows.

Read-only. Never treat it as a write path.

### `workato_call_action`

The most powerful tool in the kit — it can mutate SaaS data. It is backed by `POST /connections/<id>/test_action.json`, the same endpoint the recipe editor's **Test** button uses.

**Write gate.** By default only read-shaped actions run. An action counts as read-only if any of:

- `action_name` starts with `search_`, `get_`, `list_`, `query_`, `find_`, `describe_`, `read_`, or `fetch_`
- `action_name` is exactly `execute_suiteql`
- `action_name` is `__adhoc_http_action` **and** `input.verb` is `get`, `head`, or `options`

Everything else — `add_record`, `upsert_record`, `delete_record`, `__adhoc_http_action` with `verb: "post"` — is rejected with `WorkatoUnsafeAction` unless the caller passes `allow_writes: true`. The override exists for legitimate writes; it creates, modifies, and deletes real production records.

**Finding `action_name` values.** Every step in a recipe's code tree carries a `name` that is a valid action name. Pull a representative recipe and read its steps. Confirmed examples:

| Action                    | Connector                  | Input notes                                                                                                                                                                                                        |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `__adhoc_http_action`     | Any HTTP-capable connector | `{mnemonic: "Custom action", verb, path, response_type, inspect: true, request_headers?}` — **both `mnemonic` and `inspect: true` are required**, otherwise Workato replies `'Action name' must be present`        |
| `execute_suiteql`         | NetSuite                   | `{query}`                                                                                                                                                                                                          |
| `search_sobjects_soql_v2` | Salesforce                 | `{query, limit: 100, output_schema: '[{"name":"Id"}]'}` — `output_schema` is required but need not match the selected fields; omitting it makes Workato introspect the whole object and the call usually times out |

Prefer `workato_run_query` when all you need is rows.

## Projects & folders

| Tool                     | Required                 | Optional                | Description                                    |
| ------------------------ | ------------------------ | ----------------------- | ---------------------------------------------- |
| `workato_list_folders`   | —                        | `project`, `full`       | The full project/folder tree                   |
| `workato_create_folder`  | `name`, `parent_id`      | —                       | Create a folder                                |
| `workato_update_folder`  | `folder_id`              | `name`, `parent_id`     | Rename and/or move a folder                    |
| `workato_delete_folder`  | `folder_id`              | `force`                 | Delete a folder — **cascades to its contents** |
| `workato_move_recipe`    | `recipe_id`, `folder_id` | —                       | Move a recipe into another folder              |
| `workato_create_project` | `name`                   | —                       | Create a project                               |
| `workato_update_project` | `folder_id`              | `name`, `color`, `icon` | Rename/restyle a project                       |

`workato_list_folders` is the source of folder ids — call it before creating or moving anything. Top-level entries are project **root folders**: their `id` is what `parent_id` / `folder_id` want, while `project_id` identifies the owning project. Nodes report `flow_count` / `active_flow_count` plus non-zero asset counts under `counts`.

Note the asymmetry: `workato_update_project` takes the project's **`folder_id`**, not its `project_id` (the endpoint is `/web_api/projects/f<folder_id>.json`).

Deleting a folder removes everything inside it. There is no undo.

## Code-side recipe editing

These mutate the recipe's JSON code tree directly — GET the tree, change it, PUT it back — with no editor UI involved. They are the preferred way to edit recipes.

| Tool                                 | Required                                                          | Optional                                                                                                       | Description                                            |
| ------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `workato_recipe_add_step`            | `recipe_id`, `after_step`, `provider`, `action_name`              | `input`, `keyword`                                                                                             | Insert a step                                          |
| `workato_recipe_set_step_input`      | `recipe_id`, `step_number`, `field`, `value`                      | —                                                                                                              | Set a top-level input field                            |
| `workato_recipe_set_input_path`      | `recipe_id`, `step`, `path`, `value`                              | `value_kind`, `restart_if_running`, `ensure_running`, `comment`, `expected_base_version_no`, `verify_readback` | Set a **nested** input value                           |
| `workato_recipe_delete_input_path`   | `recipe_id`, `step`, `path`                                       | —                                                                                                              | Delete a nested leaf                                   |
| `workato_recipe_map_datapill`        | `recipe_id`, `target_step`, `target_field`, `source_step`, `path` | —                                                                                                              | Build a `_dp(...)` datapill mapping                    |
| `workato_recipe_set_py_eval_code`    | `recipe_id`, `step`                                               | `code`, `code_path`, `validate_step`                                                                           | Replace a Python-by-Workato step's code body           |
| `workato_recipe_set_extended_schema` | `recipe_id`, `step`, `kind`, `schema`                             | —                                                                                                              | Set `extended_input_schema` / `extended_output_schema` |

`workato_recipe_set_input_path` is the workhorse for one-field fixes. The step is addressed by number or `as` anchor (nested blocks are searched recursively), and `path` may be a dotted string like `records.item.items[0].amount` or an array of segments. It creates missing intermediate containers, refuses unsafe segments and non-container parents, and leaves every unrelated field of the tree untouched. Values can be literals, formula strings, interpolated strings, or datapill shorthand — `datapill(provider.line.list_items[].AssetId)` expresses a current-item pill inside a `foreach`.

`workato_recipe_set_py_eval_code` takes `code_path` so a Python file goes straight from disk into the step without passing through the model's context.

All of these accept `restart_if_running`, `ensure_running`, `comment`, `expected_base_version_no`, and `verify_readback`, forwarded to the underlying save. The save's own report comes back with the mutation summary, so `save_status`, `was_running`, `restarted` / `restart_error`, `verification_error`, `value_mismatches`, and `datapills_normalized` reach the caller instead of being flattened into a bare "updated recipe N". A recipe left stopped, a failed restart, and an unverified readback are each called out on the summary's first line.

## Recipe editor UI

Automation of the live editor, for the cases no endpoint covers. `workato_ui_save_recipe_code` is the exception — it's a pure API write and the fastest path for whole-tree saves.

| Tool                          | Required                       | Optional                                                                                                                                                            | Description                                                 |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `workato_ui_open_recipe`      | `recipe_id`                    | `mode`                                                                                                                                                              | Open a recipe (view or edit)                                |
| `workato_ui_enter_edit_mode`  | —                              | —                                                                                                                                                                   | Click **Edit**                                              |
| `workato_ui_list_steps`       | —                              | —                                                                                                                                                                   | `{number, label}` for every step on screen                  |
| `workato_ui_focus_step`       | `step_number`                  | —                                                                                                                                                                   | Open a step's config panel                                  |
| `workato_ui_add_step`         | `after_step`, `app`, `action`  | `kind`                                                                                                                                                              | Insert a step through the UI                                |
| `workato_ui_set_field`        | `field`, `value`               | `mode`                                                                                                                                                              | Set a field on the focused step                             |
| `workato_ui_insert_datapill`  | `field`, `source_step`, `path` | —                                                                                                                                                                   | Drop a datapill into a field                                |
| `workato_ui_save_recipe`      | —                              | —                                                                                                                                                                   | Click **Save**, verified by polling the dirty count to zero |
| `workato_ui_exit_edit_mode`   | —                              | `discard`                                                                                                                                                           | Click **Exit**                                              |
| `workato_ui_create_recipe`    | `name`                         | `folder_id`, `project_name`, `description`                                                                                                                          | Create a recipe (`POST /recipes.json`)                      |
| `workato_ui_save_recipe_code` | —                              | `recipe_id`, `code`, `code_path`, `config`, `name`, `description`, `restart_if_running`, `ensure_running`, `comment`, `expected_base_version_no`, `verify_readback` | Save a complete code tree (`PUT /recipes/<id>.json`)        |

### `workato_ui_save_recipe_code`

Pair it with `workato_pull_recipe`: fetch, mutate client-side, save. For large recipes use the file round-trip (`out_file` → `code_path`) so the tree never enters context.

- **Verified writes** — the saved tree is read back and compared against what was sent. Workato accepts a save with `code_errors: []` and still drops dynamic input keys on steps that lack a matching `extended_input_schema`; the tool fails with `save_status: "persisted_incomplete"` and lists the dropped paths rather than reporting a clean save of empty data. `verify_readback: false` disables the check.
- **Datapills** — pill payloads are re-serialized compactly before the save, because Workato matches `#{_dp('<json>')}` byte-for-byte and a payload with `json.dumps` spacing silently resolves to nothing. `datapills_normalized` reports how many were rewritten.
- **Running recipes** — Workato refuses code saves while a recipe runs. `restart_if_running: true` performs stop → save → verify → restart atomically and reports `stopped_at` / `restarted`. It restores only what the save stopped: a recipe that was already stopped stays stopped, reported as `was_running: false`. Use `ensure_running: true` when it must be live afterwards either way.
- **Concurrency** — pass `expected_base_version_no` (the `version_no` you pulled) to refuse overwriting someone else's edit. When the version moved but the stored tree already equals the one being written — the signature of a retry after a timed-out save — the call returns `save_status: "already_applied"` without creating a second version.
- **Annotation** — `comment` sets the version comment in the same call.
- **Timeouts** — a timed-out save is verified by `version_no` and a tree readback, yielding `save_status: "succeeded_after_timeout"`.

Returns the new `version_no` plus any validation errors Workato raises about the saved tree.

## Lookup tables

Classic Workato lookup tables. Columns are positional (`col1`…`col10`); rows carry their own `row_id`, distinct from `table_id`.

| Tool                               | Required                    | Optional                                                        | Description                                       |
| ---------------------------------- | --------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `workato_lookup_tables_list`       | —                           | —                                                               | Every visible lookup table                        |
| `workato_lookup_table_get`         | `table_id`                  | `page`, `per_page`, `qterm`                                     | Table with columns and rows                       |
| `workato_lookup_table_create`      | —                           | `name`, `columns`                                               | Create, then optionally rename and apply a schema |
| `workato_lookup_table_rename`      | `table_id`, `name`          | —                                                               | Rename                                            |
| `workato_lookup_table_set_columns` | `table_id`, `columns`       | —                                                               | Replace the column schema                         |
| `workato_lookup_table_delete`      | `table_id`                  | —                                                               | Delete the table                                  |
| `workato_lookup_table_row_create`  | `table_id`, `row`           | —                                                               | Add a row                                         |
| `workato_lookup_table_row_update`  | `table_id`, `row_id`, `row` | —                                                               | Update a row                                      |
| `workato_lookup_table_row_delete`  | `table_id`, `row_id`        | —                                                               | Delete a row                                      |
| `workato_lookup_table_row_search`  | `table_id`, `qterm`         | `page`, `per_page`                                              | Server-side text search across rows               |
| `workato_lookup_table_import_csv`  | `table_id`                  | `csv_path`, `csv_content`, `mode`, `skip_first_row`, `filename` | Bulk import from CSV                              |

`workato_lookup_table_import_csv` takes either `csv_path` (**preferred** — the bridge streams the file from disk, keeping it out of context) or inline `csv_content`. `mode: "append"` is the default and preserves existing rows; `mode: "replace"` wipes them first. Set `skip_first_row: true` for a header row. CSV column order is positional. Limits: 10 columns, 100 000 rows.

## Data tables

Workato's newer relational Data Tables — a different feature and a different API (`/web_api/workato_db/*`). Records are keyed internally by column UUID; these tools accept and return **label-keyed** rows and resolve the mapping for you. Column operations are full-schema PUTs under the hood.

| Tool                               | Required                       | Optional                                                      | Description                             |
| ---------------------------------- | ------------------------------ | ------------------------------------------------------------- | --------------------------------------- |
| `workato_data_tables_list`         | —                              | `folder_id`, `page`                                           | Data tables in a project folder         |
| `workato_data_table_get`           | `table_id`                     | `include_system`                                              | Table with its columns                  |
| `workato_data_table_create`        | `name`, `folder_id`            | `columns`                                                     | Create a table, optionally with columns |
| `workato_data_table_rename`        | `table_id`, `name`             | —                                                             | Rename                                  |
| `workato_data_table_delete`        | `table_id`                     | —                                                             | Delete                                  |
| `workato_data_table_add_column`    | `table_id`, `name`             | `type`                                                        | Append a column                         |
| `workato_data_table_update_column` | `table_id`                     | `column_name`, `column_id`, `name`, `type`                    | Rename and/or retype a column           |
| `workato_data_table_delete_column` | `table_id`                     | `column_name`, `column_id`                                    | Delete a column                         |
| `workato_data_table_row_list`      | `table_id`                     | `order_by_column`, `direction`, `limit`, `continuation_token` | Query records                           |
| `workato_data_table_row_create`    | `table_id`, `row`              | —                                                             | Insert a record                         |
| `workato_data_table_row_update`    | `table_id`, `record_id`, `row` | —                                                             | Update a record                         |
| `workato_data_table_row_delete`    | `table_id`, `record_ids`       | —                                                             | Delete records (batch)                  |

## Session

| Tool                     | Required  | Optional | Description                                                       |
| ------------------------ | --------- | -------- | ----------------------------------------------------------------- |
| `workato_whoami`         | —         | —        | Workspace, user, role, environments, teams, timezone, tier        |
| `workato_list_profiles`  | —         | —        | Connected Chrome profiles                                         |
| `workato_switch_profile` | `profile` | `tabId`  | Route this session's calls to a profile, optionally pinning a tab |

Call `workato_whoami` first whenever it isn't obvious which workspace or environment the session is pointed at — especially with several Workato accounts open in different tabs or profiles. `workato_switch_profile` with a `tabId` pins the session so browser focus changes can't retarget it.

## Common workflows

**Diagnose a failing recipe**

```
workato_list_jobs(recipe_id, status: "failed")
  → workato_job_trace(recipe_id, job_id, line_range: [<error line ± 10>])
  → workato_job_trace(..., lines: [<the step>], detail: "full")   # exact payload
  → workato_pull_recipe(recipe_id, step: "<as>")                  # what the step maps
```

**Fix one field**

```
workato_recipe_set_input_path(
  recipe_id, step: "1616311d",
  path: "records.custbody_status.refName",
  value: "datapill(provider.line.list_items[].Status)",
  restart_if_running: true,
  comment: "map status from line item",
)
  → workato_recipe_status(recipe_id)                              # verify
  → workato_recipe_version_diff(recipe_id, from: 46, to: 47)      # confirm what changed
```

**Rewrite a large recipe**

```
workato_pull_recipe(recipe_id, out_file: "recipe.json")           # never hits context
  → edit recipe.json locally
  → workato_ui_save_recipe_code(code_path: "recipe.json",
      expected_base_version_no: 46, restart_if_running: true)
  → workato_recipe_version_diff(recipe_id, from: 46, to: 47)
```

**Query a SaaS through an existing connection**

```
workato_search_connections(text: "SFDC Prod")                     # → shared_account_id
  → workato_run_query(connection_id, type: "soql",
      query: "SELECT Id, Status FROM Asset WHERE ...")
```

## Inherited browser tools

From [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome) — useful when a Workato task needs UI driving no endpoint covers.

| Area                | Tools                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabs & navigation   | `get_windows_and_tabs`, `chrome_navigate`, `chrome_switch_tab`, `chrome_close_tabs`                                                                                     |
| Page snapshots      | `chrome_snapshot`, `chrome_snapshot_click`, `chrome_snapshot_fill`, `chrome_snapshot_hover`, `chrome_snapshot_wait_for`, `chrome_read_page`                             |
| Interaction         | `chrome_click_element`, `chrome_fill_or_select`, `chrome_keyboard`, `chrome_computer`, `chrome_request_element_selection`, `chrome_upload_file`, `chrome_handle_dialog` |
| Content & network   | `chrome_get_web_content`, `chrome_network_request`, `chrome_network_capture`, `chrome_handle_download`, `chrome_javascript`, `chrome_console`                           |
| Capture             | `chrome_screenshot`, `chrome_gif_recorder`                                                                                                                              |
| History & bookmarks | `chrome_history`, `chrome_bookmark_search`, `chrome_bookmark_add`, `chrome_bookmark_delete`                                                                             |
| Performance         | `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`                                                                                      |

`get_windows_and_tabs(filter: "workato")` is the quickest way to see which Workato tabs and profiles are live.

Prefer `chrome_snapshot` + `chrome_snapshot_click` over screenshots for navigation — snapshots are cheaper and give stable element refs.
