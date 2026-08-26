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

| File                        | When to read                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code-tree.md`              | Authoring/mutating recipes via `workato_ui_save_recipe_code` or `workato_recipe_*`. Verbatim schemas for triggers (clock, recipe_function, salesforce), control flow (foreach, if/elsif/else, repeat+while_condition, try/catch, stop), Variables-by-Workato (declare_list, insert_to_list, declare_variable, update_variables), and common app actions (logger, csv_parser, py_eval, salesforce, netsuite, google_sheets, email, workato_files, workato_pub_sub, openai). |
| `discovering-connectors.md` | Building a step for a connector this workspace has not used before: finding the technical adapter name, listing a connector's operations, reading an operation's real field surface (static `options` vs dynamic `pick_list`, `default`, nested `properties`, `toggle_field`), what `connection_required` means for the recipe `config`, and finding live examples of a step. Read it before guessing a `provider` or an action name.                                      |
| `workflow-apps.md`          | Building or editing a Workato Workflow App (LCAP) page: page API and CSRF, `layout` row semantics and the geometry trap, widget catalogue, `handlers` (click / change / pageLoad), page variables, the three `_dp` dialects, the full conditional-`visible` opcode table, app-function bindings, and how to stop a table re-firing on every keystroke.                                                                                                                     |
| `formula-mode.md`           | **Always read** before constructing or reviewing any formula — text-vs-formula mode, datapill syntax, allowlist behavior, common patterns, gotchas.                                                                                                                                                                                                                                                                                                                        |
| `formula-reference.md`      | Exhaustive catalog of all 169 formula-mode functions and operators — name, operand types, params, examples, docs links, search tags. Grep here to find a formula by name/synonym, or to verify a formula exists and is being called correctly. The category files give guidance; this is the complete lookup.                                                                                                                                                              |
| `string-formulas.md`        | Formula transforms on a string datapill: trimming, casing, regex, parsing, currencies, country/state codes.                                                                                                                                                                                                                                                                                                                                                                |
| `number-formulas.md`        | Integer/float math, rounding (`.round`/`.ceil`/`.floor`), casting (`.to_f`/`.to_i`), currency/phone formatting.                                                                                                                                                                                                                                                                                                                                                            |
| `date-formulas.md`          | `now`/`today`, `.strftime`, `.in_time_zone`, date math (`+ N.days`), epoch ↔ datetime.                                                                                                                                                                                                                                                                                                                                                                                     |
| `array-formulas.md`         | Arrays of hashes: `.where`, `.pluck`, `.compact`, `.flatten`, `.join`/`.smart_join`, `.uniq`.                                                                                                                                                                                                                                                                                                                                                                              |
| `complex-data-types.md`     | Hash ops (`.dig`, `.except`, `.slice`, `.merge`), JSON/XML/CSV/URL encoding, nil-safety without `&.`.                                                                                                                                                                                                                                                                                                                                                                      |
| `lookup-formulas.md`        | Query data sources from inside a formula: `data_table_lookup` (Data Tables), `lookup` (Lookup Tables), `lookup_table` (inline hash). All case-sensitive AND type-sensitive; return `nil` on miss.                                                                                                                                                                                                                                                                          |
| `other-formulas.md`         | Field-control values (`null`/`clear`/`skip`), `uuid`, hashing (`sha1`/`encode_sha256`/`md5_hexdigest`/`hmac_*`), encryption (`encrypt`/`decrypt`), encoding (`encode_base64`/`encode_url`/`encode_hex` + decode variants), JWT (`workato.jwt_encode`/`jwt_decode`), YAML (`workato.parse_yaml`/`render_yaml`), and safe-nav hash chains.                                                                                                                                   |

## Critical rules — recipes

These apply when writing or mutating recipe JSON (see `code-tree.md` for full detail):

1. **Nesting**: `else`/`elsif` are last entries inside `if.block`; `catch` is the last entry inside `try.block`. Never siblings.
2. **`as`**: must match `/^[0-9a-f]{8}$/` — lowercase hex only. Non-hex `as` is silently rejected by Workato.
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
4. **`connection_required: false` means no `account_id`** in that provider's `config` entry, and no connection to look for. Read it off the adapter rather than trusting any list of system providers to be complete.
5. **An array or object field has `properties`.** Filling one with a scalar is the same silent no-op as a wrong key name. Watch for `toggle_field` too: two names for one input, of which exactly one may be set.
6. **Absence from `workato_apps_list` proves nothing.** Workato publishes no catalogue of its standard connectors. Test a guessed name by passing an array to `workato_adapter_meta` and reading `not_found`.
7. **A step found by `workato_recipe_step_search` is a template, not a value.** Its datapills point at that recipe's steps and resolve to empty until repointed.

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

## Quick task → file mapping

| Task                                            | Start here                                             |
| ----------------------------------------------- | ------------------------------------------------------ |
| Add a step to a recipe                          | `code-tree.md` (find matching action shape)            |
| Use an app this workspace never used before     | `discovering-connectors.md`                            |
| Find the technical name behind an app's title   | `discovering-connectors.md` → `workato_apps_list`      |
| Find a real example of a step to copy           | `discovering-connectors.md` → step search              |
| Build or edit a Workflow App form               | `workflow-apps.md`                                     |
| Hide a page widget conditionally                | `workflow-apps.md` → conditional `visible` opcodes     |
| Stop a page table re-running its recipe         | `workflow-apps.md` → task consumption                  |
| Wire a foreach over a typed list                | `code-tree.md` → Variables-by-Workato → `declare_list` |
| Catch and log a step's error                    | `code-tree.md` → Try / Catch                           |
| Format a datapill before injection              | `formula-mode.md` then the type-specific file          |
| Find or verify a specific formula               | `formula-reference.md` (grep by name or tag)           |
| Build a JSON body from datapills                | `complex-data-types.md` → `.compact.to_json` patterns  |
| Reformat a date string                          | `date-formulas.md` → `.to_date(format:)` + `.strftime` |
| Filter array of hashes                          | `array-formulas.md` → `.where(...).pluck(...)`         |
| Look up a value in a data/lookup table          | `lookup-formulas.md` → `data_table_lookup` / `lookup`  |
| Generate UUID / hash / encrypt / JWT / base64   | `other-formulas.md`                                    |
| Conditionally clear or skip a destination field | `other-formulas.md` → `null` / `clear` / `skip`        |
