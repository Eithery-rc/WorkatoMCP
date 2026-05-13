---
name: workato-recipes
description: Use when authoring, editing, reviewing, or programmatically mutating Workato recipes — recipe code-tree JSON (triggers, foreach/if/repeat/try-catch, Variables-by-Workato, app actions), formula-mode expressions (Ruby allowlist, `_dp(...)` datapills), datapill references, or when calling the `workato_ui_save_recipe_code` / `workato_pull_recipe` / `workato_recipe_*` MCP tools.
---

# Workato recipes

Reference for building and editing Workato recipes through the WorkatoMCP tool surface. Covers two distinct domains:

1. **Recipe code-tree JSON** — the shape of the saved recipe (triggers, control flow, Variables, app actions, schemas).
2. **Formula-mode expressions** — Workato's Ruby allowlist for inline data transformations (`=_dp("step.x").upcase` and friends).

Load the file matching what you're working on. **Always read `code-tree.md` first** if you're touching recipe JSON — most agent mistakes come from misunderstanding step nesting (`else` inside `if.block`, `catch` inside `try.block`, `source` at foreach root not under `input`).

## Index

| File                    | When to read                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code-tree.md`          | Authoring/mutating recipes via `workato_ui_save_recipe_code` or `workato_recipe_*`. Verbatim schemas for triggers (clock, recipe_function, salesforce), control flow (foreach, if/elsif/else, repeat+while_condition, try/catch, stop), Variables-by-Workato (declare_list, insert_to_list, declare_variable, update_variables), and common app actions (logger, csv_parser, py_eval, salesforce, netsuite, google_sheets, email, workato_files, workato_pub_sub, openai). |
| `formula-mode.md`       | **Always read** before constructing or reviewing any formula — text-vs-formula mode, datapill syntax, allowlist behavior, common patterns, gotchas.                                                                                                                                                                                                                                                                                                                        |
| `string-formulas.md`    | Formula transforms on a string datapill: trimming, casing, regex, parsing, currencies, country/state codes.                                                                                                                                                                                                                                                                                                                                                                |
| `number-formulas.md`    | Integer/float math, rounding (`.round`/`.ceil`/`.floor`), casting (`.to_f`/`.to_i`), currency/phone formatting.                                                                                                                                                                                                                                                                                                                                                            |
| `date-formulas.md`      | `now`/`today`, `.strftime`, `.in_time_zone`, date math (`+ N.days`), epoch ↔ datetime.                                                                                                                                                                                                                                                                                                                                                                                     |
| `array-formulas.md`     | Arrays of hashes: `.where`, `.pluck`, `.compact`, `.flatten`, `.join`/`.smart_join`, `.uniq`.                                                                                                                                                                                                                                                                                                                                                                              |
| `complex-data-types.md` | Hash ops (`.dig`, `.except`, `.slice`, `.merge`), JSON/XML/CSV/URL encoding, nil-safety without `&.`.                                                                                                                                                                                                                                                                                                                                                                      |

## Critical rules — recipes

These apply when writing or mutating recipe JSON (see `code-tree.md` for full detail):

1. **Nesting**: `else`/`elsif` are last entries inside `if.block`; `catch` is the last entry inside `try.block`. Never siblings.
2. **`as`**: must match `/^[0-9a-f]{8}$/` — lowercase hex only. Non-hex `as` is silently rejected by Workato.
3. **`source` on foreach**: at the node root, NOT inside `input`. Always a `#{_dp(...)}` formula referencing a list pill.
4. **`number`**: globally sequential across the entire tree, including nested blocks. Trigger is `0`. Renumber everything after the insertion point.
5. **Extended schemas**: `extended_input_schema` is REQUIRED for structured `input` fields (arrays, nested objects) or Workato silently drops them on save. `extended_output_schema` is REQUIRED whenever a downstream datapill references the step's output.
6. **`keyword:"repeat"`**, not `"repeat_while"` — the `while_condition` is the first child of the repeat's `block`.
7. **`return_result`**: `keyword:"action"` (not its own keyword), `name:"return_result"`, `provider:"workato_recipe_function"`.

## Critical rules — formulas

These apply when constructing or reviewing any formula-mode expression (see `formula-mode.md` for full detail):

1. **Allowlist only.** If a method isn't in these files, it's blocked — including `eval`, `send`, `JSON.parse`, file/network IO.
2. **No blocks.** `array.map { ... }`, `.select { ... }`, `.reduce { ... }` won't parse. Use `.pluck` / `.where` / `.format_map` / `.smart_join` instead. For per-row logic use a Repeat step in the recipe.
3. **No string interpolation.** `"hi #{name}"` is rejected in formulas. Build strings with `+`, `.join`, `.format_map`.
4. **No safe-navigation.** `value&.upcase` won't parse — use `value.presence` + `||` or a ternary, or `.dig(...)` for nested hash access.
5. **Default `now`/`today` are US/Pacific**, not UTC. Add `.in_time_zone("UTC")` (or `.in_time_zone(nil)`) for portable timestamps.
6. **Integer division truncates**: `4 / 7 == 0`. Cast with `.to_f` first if you want decimals.
7. **`.to_i`/`.to_f` on non-numeric strings return `0`**, not an error. Validate with `.match?(/^\d+$/)` if you need failure detection.

## Quick task → file mapping

| Task                               | Start here                                             |
| ---------------------------------- | ------------------------------------------------------ |
| Add a step to a recipe             | `code-tree.md` (find matching action shape)            |
| Wire a foreach over a typed list   | `code-tree.md` → Variables-by-Workato → `declare_list` |
| Catch and log a step's error       | `code-tree.md` → Try / Catch                           |
| Format a datapill before injection | `formula-mode.md` then the type-specific file          |
| Build a JSON body from datapills   | `complex-data-types.md` → `.compact.to_json` patterns  |
| Reformat a date string             | `date-formulas.md` → `.to_date(format:)` + `.strftime` |
| Filter array of hashes             | `array-formulas.md` → `.where(...).pluck(...)`         |
