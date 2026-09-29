---
name: workato-recipes
description: Use when authoring, editing, reviewing, or programmatically mutating Workato recipes or Workflow App (LCAP) pages — recipe code-tree JSON (triggers, foreach/if/repeat/try-catch, Variables-by-Workato, app actions), formula-mode expressions (Ruby allowlist, `_dp(...)` datapills), datapill references, Workflow App page JSON (widgets, layout rows, handlers, page variables, conditional visibility, app-function bindings), discovering an unfamiliar connector's adapter name, actions and field surface, or when calling the `workato_ui_save_recipe_code` / `workato_pull_recipe` / `workato_recipe_*` / `workato_apps_list` / `workato_adapter_meta` MCP tools.
---

# Workato recipes

Reference for building and editing Workato recipes through the WorkatoMCP tool surface. Covers two distinct domains:

1. **Recipe code-tree JSON** — the shape of the saved recipe (triggers, control flow, Variables, app actions, schemas).
2. **Formula-mode expressions** — Workato's Ruby allowlist for inline data transformations (`=_dp("step.x").upcase` and friends).

Load the file matching what you're working on. **Always read `code-tree.md` first** if you're touching recipe JSON — most agent mistakes come from misunderstanding step nesting (`else` inside `if.block`, `catch` inside `try.block`, `source` at foreach root not under `input`).

## Index

| File                          | When to read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `code-tree.md`                | Authoring/mutating recipes via `workato_ui_save_recipe_code` or `workato_recipe_*`. Verbatim schemas for triggers (clock, recipe_function, salesforce), control flow (foreach, if/elsif/else, repeat+while_condition, try/catch, stop), Variables-by-Workato (declare_list, insert_to_list, declare_variable, update_variables), and common app actions (logger, csv_parser, py_eval, salesforce, netsuite, google_sheets, email, workato_files, workato_pub_sub, openai).                                                                                                                                         |
| `discovering-connectors.md`   | Building a step for a connector this workspace has not used before: the connector catalogue and the technical adapter name, listing a connector's operations, reading an operation's real field surface (static `options` vs dynamic `pick_list`, `default`, nested `properties`, `toggle_field`), generating the step's `extended_input_schema` / `extended_output_schema` with `workato_step_schema`, probing that a connection actually works, what `connection_required` means for the recipe `config`, and finding live examples of a step. Read it before guessing a `provider`, an action name or a schema. |
| `platform-endpoints.md`       | Calling a Workato web endpoint that has no tool, or checking what an endpoint really does before trusting a tool's summary: jobs search and retention, the dependency graph behind caller discovery, `state.json` (the only start-failure diagnostic), `test.json`, connection health, Event Streams topics, and the routes that are 404. Live-verified 2026-09-07. Read it before reaching for `workato_api_request`.                                                                                                                                                                                             |
| `workflow-apps.md`            | Building or editing a Workato Workflow App (LCAP) page: page API and CSRF, `layout` row semantics and the geometry trap, widget catalogue, `handlers` (click / change / pageLoad), page variables, the three `_dp` dialects, the full conditional-`visible` opcode table, app-function bindings, and how to stop a table re-firing on every keystroke.                                                                                                                                                                                                                                                             |
| `formula-mode.md`             | **Always read** before constructing or reviewing any formula — text-vs-formula mode, datapill syntax, allowlist behavior, common patterns, gotchas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `formula-reference.md`        | Compact index of all 169 allowlisted functions and operators, mapping each name to its category file. Use it to verify a method is allowlisted or to find where it is documented.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `operators-and-comparison.md` | Arithmetic (+, -, \*, /, %, \*\*), comparison (==, !=, <, <=, >, >=), range (.member?), logical (&&, \|\|, !), ternary and safe-navigation operators.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `string-formulas.md`          | Formula transforms on a string datapill: trimming, casing, regex, parsing, currencies, country/state codes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `number-formulas.md`          | Integer/float math, rounding (`.round`/`.ceil`/`.floor`), casting (`.to_f`/`.to_i`), currency/phone formatting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `date-formulas.md`            | `now`/`today`, `.strftime`, `.in_time_zone`, date math (`+ N.days`), epoch ↔ datetime.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `array-formulas.md`           | Arrays of hashes: `.where`, `.pluck`, `.compact`, `.flatten`, `.join`/`.smart_join`, `.uniq`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `complex-data-types.md`       | Hash ops (`.dig`, `.except`, `.slice`, `.merge`), JSON/XML/CSV/URL encoding, nil-safety without `&.`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `lookup-formulas.md`          | Query data sources from inside a formula: `data_table_lookup` (Data Tables), `lookup` (Lookup Tables), `lookup_table` (inline hash). All case-sensitive AND type-sensitive; return `nil` on miss.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `other-formulas.md`           | Field-control values (`null`/`clear`/`skip`), `uuid`, hashing (`sha1`/`encode_sha256`/`md5_hexdigest`/`hmac_*`), encryption (`encrypt`/`decrypt`), encoding (`encode_base64`/`encode_url`/`encode_hex` + decode variants), JWT (`workato.jwt_encode`/`jwt_decode`), YAML (`workato.parse_yaml`/`render_yaml`), and safe-nav hash chains.                                                                                                                                                                                                                                                                           |

## Critical rules — recipes

These apply when writing or mutating recipe JSON (see `code-tree.md` for full detail):

1. **Nesting**: `else`/`elsif` are last entries inside `if.block`; `catch` is the last entry inside `try.block`. Never siblings.
2. **`as`**: always MINT `/^[0-9a-f]{8}$/`, lowercase hex only. Workato does accept some hand-written anchors (`tjcall01` was observed working), so `workato_recipe_validate` reports a non-hex `as` on an existing step as a warning rather than an error and the tools leave it alone. But a non-hex anchor has been seen to break datapill resolution (`"declare1"` used as a `foreach` source fails with `Unknown data field`), so never write one yourself.
3. **`source` on foreach**: at the node root, NOT inside `input`. Always a `#{_dp(...)}` formula referencing a list pill.
4. **`number`**: globally sequential across the entire tree, including nested blocks. Trigger is `0`. Renumber everything after the insertion point.
5. **Extended schemas**: `extended_input_schema` is REQUIRED for structured `input` fields (arrays, nested objects) or Workato silently drops them on save. `extended_output_schema` is REQUIRED whenever a downstream datapill references the step's output. `workato_ui_save_recipe_code` reads the tree back and fails with `save_status:"persisted_incomplete"` when a strip happens — that error names the fields whose schema is missing.
6. **`keyword:"repeat"`**, not `"repeat_while"` — the `while_condition` is the first child of the repeat's `block`.
7. **`return_result`**: `keyword:"action"` (not its own keyword), `name:"return_result"`, `provider:"workato_recipe_function"`.
8. **Datapill JSON must be compact**: Workato matches `#{_dp('<json>')}` byte-for-byte, so `json.dumps` spacing (`", "` / `": "`) makes the pill unrecognizable — it saves fine and resolves to an empty value. Serialize with no separator spaces (`json.dumps(pill, separators=(",", ":"))`).

## Critical rules — connector discovery

These apply before writing a step for a connector you have no example of (see `discovering-connectors.md`):

1. **`step.provider` is a technical name, never a title.** A custom connector's is generated and unguessable (`netsuite_rest_connector_5105163_1745592003`). Resolve it with `workato_apps_list`, not by transforming the app's display name.
2. **Workato's own connectors are named nothing like they are called.** HTTP is `rest`, Workato Event Streams is `workato_pub_sub`, Scheduler is `clock`, Python snippets is `py_eval`, Workflow apps is `workato_workflow_task`. Guessing from the display name returns an empty meta document, which looks exactly like "this app does not exist". `workato_apps_list` resolves them by title and alias.
3. **A static select's value is not its label.** Workato stores pick lists label-first, so `email_type` accepts `"html"` and not `"HTML"` — and takes the wrong string silently. Read `options[].value` from `workato_adapter_meta`; a `pick_list` string instead means a DYNAMIC list whose values meta cannot know.
4. **No connection means stop and ask the user.** These tools cannot create one, deliberately: it means handing over the customer's credentials. If `connection_required` is true and `workato_apps_list` shows no `connection` entry for that adapter, or shows one whose `authorization_status` is not `success`, ask for it BEFORE writing the step: the step needs an `account_id` in `config` that does not exist yet. Name the app and the adapter in the request, and for a broken connection name it by id rather than asking for a new one. **On an existing recipe, `workato_recipe_connections` is the check**: it reads the recipe's own bindings and each bound connection and returns `{healthy, blocking, actions}`, with `actions` already phrased as what to ask for. Run it before stopping a chain you will have to restart, and whenever a start does not take.
5. **`connection_required: false` means no `account_id`** in that provider's `config` entry, and no connection to look for. Read it off the adapter rather than trusting any list of system providers to be complete. `workato_recipe_connections` reports such a binding as `status: "not_required"` rather than as a hole, and reports a genuine gap as `missing`, so the two are distinguishable without re-deriving the rule. A binding it could not establish either way is `unknown`, a diagnostic gap, not proof the recipe is fine.
6. **A `pick_list` STRING means the values live on the connection, not in meta.** Resolve them with `workato_pick_list`; a parameterised list needs `pick_list_params` sent EVALUATED, because the field shows them as formulas (the value appears wrapped in quotes) and the quoted form fails with a bad-URI error.
7. **A field fed by a dynamic pick list is written TWICE**, in `input` and in `dynamicPickListSelection` under the same field name. Setting only `input` saves cleanly and leaves the editor showing an empty picker.
8. **An array or object field has `properties`.** Filling one with a scalar is the same silent no-op as a wrong key name. Watch for `toggle_field` too: two names for one input, of which exactly one may be set.
9. **`workato_apps_list` IS the catalogue.** It reads Workato's own connector catalogue (338 standard connectors on 2026-09-08, from `/web_api/dynamic_app_config/<hash>.js`) plus the certified community catalogue and this workspace's connections and SDK connectors; `query` matches name, title, aliases and categories. An app absent from it is not available as a connector: say so and offer the HTTP connector (`rest`) or an SDK connector, do not guess names. A bare call returns a summary by category, not 338 rows.
10. **Do not hand-write `extended_input_schema` / `extended_output_schema` for an adapter step.** When `workato_adapter_meta` flags an operation `extends_input_schema` or `extends_output_schema`, call `workato_step_schema(adapter, operation, input, connection_id?)`: it returns both arrays exactly as the editor would save them, and `apply_to: {recipe_id, step}` writes them in one version. `auto_schema` still covers the Variables-by-Workato declarations and the clock trigger.
11. **`authorization_status: "success"` is not proof a connection works.** Three such connections failed every call on 2026-09-08 (`HTTP status code 420`, `invalid_grant`). `workato_step_schema(..., input: {})` is the cheap liveness probe; a failure names the connection to re-authorize. Never use the editor's Refresh button as a probe: it saves the recipe.
12. **A step found by `workato_recipe_step_search` is a template, not a value.** Its datapills point at that recipe's steps and resolve to empty until repointed.

## Critical rules — formulas

These apply when constructing or reviewing any formula-mode expression (see `formula-mode.md` for full detail):

1. **Allowlist only.** If a method isn't in these files, it's blocked — including `eval`, `send`, `JSON.parse`, file/network IO. `formula-reference.md` is the complete allowlist — if a formula isn't listed there, it does not exist.
2. **No blocks.** `array.map { ... }`, `.select { ... }`, `.reduce { ... }` won't parse. Use `.pluck` / `.where` / `.format_map` / `.smart_join` instead. For per-row logic use a Repeat step in the recipe.
3. **No `#{...}` interpolation in plain strings.** `"hi #{name}"` is rejected. Build with `+`, `.join`, `.format_map`. **Regex literals are an exception** — `#{...}` does work inside `/.../`, useful for dynamic patterns like `text.scan(/^.*#{_dp("id")}.*$/)`.
4. **Safe-navigation `&.` is partially supported.** Documented for hash bracket chains (`hash["a"]&.[]("b")`); not documented for scalar methods (`value&.upcase`). Prefer `.dig(...)` for nested hashes and `.presence || default` / ternary for scalars.
5. **Default `now`/`today` are US/Pacific**, not UTC. Add `.in_time_zone("UTC")` (or `.in_time_zone(nil)`) for portable timestamps.
6. **Integer division truncates**: `4 / 7 == 0`. Cast with `.to_f` first if you want decimals.
7. **`.to_i`/`.to_f` on non-numeric strings return `0`**, not an error. Validate with `.match?(/^\d+$/)` if you need failure detection.

## Critical rules — Workflow App pages

These apply when writing page JSON (see `workflow-apps.md` for full detail):

1. **Whole tree only.** `PUT /web_api/lcap/pages/<id>.json` replaces `content` entirely; there is no partial update. GET, mutate, PUT.
2. **Never change a widget `id`.** It is the address every datapill uses. Ids are 8 lowercase hex and may be minted by hand for new widgets.
3. **Never delete a widget without renumbering the rows** of what remains. A collapsed row extent drops the next containers' computed `top` and they stack at 0, with no error anywhere.
4. **Verify geometry after every layout change**, against the rendered DOM, not the JSON: every top level `.lcap-layout__widget` container must have `top:` in its inline style, and no two may share a bounding-box `y`.
5. **Do not PUT while the page builder is open** on that page. The builder's Save overwrites with its cached tree, exactly like the recipe editor.
6. **A 404 on a page read means wrong workspace or environment** for that tab, not a missing page. Pass both `tabId` and `profile`.
7. **Three `_dp` dialects**: `pill_type`/`provider`/`line` for recipe steps, `{"source":"widget","id":...}` for page components, `{"source":"page-variable","id":...}` for page variables. Compact JSON, one line, no added spaces.
8. **`outputMapping` on a button is inert** in the current builder. A button cannot feed its recipe result back into the page; route data through page variables and `set-value` instead.

## Task to tool

Pick the tool before picking the file. Every name below exists in `packages/shared/src/tools.ts`; `docs/TOOLS.md` in the repo carries the parameters.

| Task                                           | Tool                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| One field to change                            | `workato_recipe_set_input_path`                                                        |
| Several edits, or any structural change        | `workato_recipe_apply` (run it with `dry_run: true` first)                             |
| Check a tree before saving it                  | `workato_recipe_validate` (local only, never saves, never creates a version)           |
| Find a field or a value inside a recipe        | `workato_recipe_grep`, then read the path it reports                                   |
| Read one step                                  | `workato_pull_recipe` with `step` plus `include` / `paths`                             |
| Inspect a job                                  | `workato_job_trace` with `paths` and `empty`, not the whole trace                      |
| Find jobs                                      | `workato_list_jobs` with `started_from` / `started_to`, or `match` for a local scan    |
| Find who calls a recipe                        | `workato_recipe_callers`                                                               |
| Connection health before a start               | `workato_recipe_connections`                                                           |
| Why a start failed                             | `workato_recipe_status` (`activation`) or the `start_error` on `workato_start_recipe`  |
| A long save across callers                     | `workato_recipe_save_with_dependents`, then `workato_operation_status` if it times out |
| Run a fixture through a recipe                 | `workato_test_recipe`                                                                  |
| Read or set an environment or project property | `workato_properties` (`action: "list"` to read, `"set"` to upsert by name)             |
| Confirm the target workspace                   | `workato_session_context` (`workato_whoami` for the full profile)                      |
| Call an endpoint that has no tool              | `workato_api_request`, per `platform-endpoints.md`                                     |
| Switch environment or client workspace         | `workato_switch_environment` (moves every Workato tab in that Chrome profile)          |
| Deploy to Test or Production                   | `workato_deploy_plan`, then `workato_deploy_run`                                       |
| A project's deployment history                 | `workato_deployments_list`                                                             |
| Put a rebuilt extension and bridge live (dev)  | `workato_reload_extension` (`check_only: true` to see stale profiles)                  |

Deploying a recipe to Test or Production:

1. `workato_deploy_plan` with `recipe_id` and `environment`. Read `step_diffs` (remaps are already normalised away) and confirm only the intended change goes out.
2. `workato_deploy_run` with `allow_writes: true` and a neutral `title`. Add `allow_stop_running: true` only when `will_stop` is non-empty and stopping those recipes briefly is acceptable. Workato restarts them itself.
3. Verify in the target: `workato_switch_environment` to it, `workato_recipe_status` / `workato_recipe_grep` on the target ids, then switch back. The switch moves every Workato tab in that Chrome profile.

Three habits that pay for themselves:

- Read `coverage` or `completeness` before reporting "nothing found". An incomplete scan is not an absence.
- Prefer an `as` anchor over a step number: a structural change renumbers the whole tree.
- Do not trust a folder scope you did not ask a tool to resolve. Workato's asset search ignores `folder_id` entirely and answers with the whole workspace (re-probed 2026-09-07); the tools resolve folder membership through the dependency-graph listing or a client-side filter and report which in `scope`. Never hand a raw `folder_id` to `workato_api_request` against `mixed_assets` and read the result as one folder.

## Quick task → file mapping

| Task                                            | Start here                                                     |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Add a step to a recipe                          | `code-tree.md` (find matching action shape)                    |
| Use an app this workspace never used before     | `discovering-connectors.md`                                    |
| Find the technical name behind an app's title   | `discovering-connectors.md` → `workato_apps_list`              |
| Get a step's extended schemas from the adapter  | `discovering-connectors.md` → step 4, `workato_step_schema`    |
| Check a connection actually works               | `discovering-connectors.md` → step 4, the `input: {}` probe    |
| Find a real example of a step to copy           | `discovering-connectors.md` → step search                      |
| Build or edit a Workflow App form               | `workflow-apps.md`                                             |
| Hide a page widget conditionally                | `workflow-apps.md` → conditional `visible` opcodes             |
| Stop a page table re-running its recipe         | `workflow-apps.md` → task consumption                          |
| Wire a foreach over a typed list                | `code-tree.md` → Variables-by-Workato → `declare_list`         |
| Catch and log a step's error                    | `code-tree.md` → Try / Catch                                   |
| Format a datapill before injection              | `formula-mode.md` then the type-specific file                  |
| Find or verify a specific formula               | `formula-reference.md` (name to category file), then that file |
| Build a JSON body from datapills                | `complex-data-types.md` → `.compact.to_json` patterns          |
| Reformat a date string                          | `date-formulas.md` → `.to_date(format:)` + `.strftime`         |
| Filter array of hashes                          | `array-formulas.md` → `.where(...).pluck(...)`                 |
| Look up a value in a data/lookup table          | `lookup-formulas.md` → `data_table_lookup` / `lookup`          |
| Generate UUID / hash / encrypt / JWT / base64   | `other-formulas.md`                                            |
| Conditionally clear or skip a destination field | `other-formulas.md` → `null` / `clear` / `skip`                |
