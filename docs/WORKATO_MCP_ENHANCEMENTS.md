# Workato MCP — Enhancement Request

Compiled from an extended Workato recipe build session (ObitPortal Load MVP,
recipe 72825615 — Python parser + 21-step error-recovery tree, ~63 saved
versions). The current MCP tooling works, but a handful of patterns repeat
constantly and would be much cleaner as first-class tools.

## Current MCP tools (relevant ones)

| Tool                                                                        | Today's role                                        | Limitation                                                                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `workato_pull_recipe(recipe_id, out_file)`                                  | Round-trip pull — writes the full code tree to disk | None — works great; **mandatory** for recipes > ~50 KB                                                                           |
| `workato_ui_save_recipe_code(code_path)`                                    | Round-trip push — uploads the modified file         | None — works great                                                                                                               |
| `workato_recipe_set_step_input(step, field, value)`                         | Set one scalar input field                          | **Scalar only.** Cannot write `records.custbody_mhi_status.refName` (nested object path). Cannot write structured object values. |
| `workato_recipe_map_datapill(target_step, target_field, source_step, path)` | Build a `_dp(...)` datapill formula                 | **Flat target field only.** Won't navigate `records.item.items.amount`.                                                          |
| `workato_recipe_add_step(after_step, provider, action_name, input)`         | Insert a new step                                   | Useful, but doesn't help with the 90% case of editing existing steps                                                             |
| `workato_data_table_*`                                                      | CRUD on Data Tables                                 | Adequate                                                                                                                         |
| `workato_lookup_table_*`                                                    | CRUD on Lookup Tables                               | Adequate                                                                                                                         |

## Real workflow today

For ~95% of recipe edits, the loop is:

```
1. workato_pull_recipe(recipe_id, out_file="recipe_full.json")
2. # Local Python script (heredoc or build_recipe_*.py):
3. #   - DFS walk by `as` to find step
4. #   - mutate step.input.records.<deep.path> = <datapill or formula>
5. #   - sometimes apply the same edit to N steps (Invoice + CM, etc.)
6. #   - json.dump back to file
7. workato_ui_save_recipe_code(code_path="recipe_full.json")
8. (verify) workato_pull_recipe(step="<as>", field_query="...")
```

The existing `workato_recipe_set_step_input` / `map_datapill` solve only the
shallow / flat cases. Below are the gaps that matter.

---

## Proposed enhancements (priority order)

### 1. `workato_recipe_set_py_eval_code(recipe_id, step, code_path)` ⭐ highest leverage

**The most repeated mutation in the session — done ~10 times.**

Splices the contents of a local `.py` file into `<step>.input.code` of a
`py_eval` action step. Round-trips via pull/edit/push internally.

```
workato_recipe_set_py_eval_code(
  recipe_id=72825615,
  step="1616311d",
  code_path="obitportal_workato_csv_parser.py"
)
```

Implementation: GET tree → find step by `as` (or `number`) → set
`step.input.code` to the file contents (string, with proper JSON escaping for
embedded quotes / newlines / BOM-style `﻿`) → PUT tree.

Optionally: validate the step is `provider:"py_eval", name:"invoke_custom_py_code"`
before writing, refuse otherwise.

Why this matters: today this is a 5-line Python script every time. Replacing
it with one tool call would save the most friction.

---

### 2. `workato_recipe_set_input_path(recipe_id, step, path, value, value_kind)` ⭐⭐ second highest

Generalizes `set_step_input` to **nested paths**. The vast majority of NetSuite
upsert mappings are 2–4 levels deep:

- `records.custbody_mhi_status` (object → assign `{refName: ...}`)
- `records.custbody_mhi_status.refName` (3-level scalar)
- `records.item.items.line` (3-level scalar, line SuiteQL formula)
- `records.item.items.class.refName` (4-level scalar)
- `records.item.items.____source` (3-level datapill list-source)

**Signature:**

```
workato_recipe_set_input_path(
  recipe_id: int,
  step: str | int,                 # as (hex) or number
  path: str,                        # dotted: "records.item.items.class.refName"
  value: any,                       # str / number / bool / object / null
  value_kind: "literal" | "datapill" | "formula" | "interpolated"
)
```

- `literal` — value is set as-is (string / number / bool / object / null).
- `datapill` — value is `{provider, line, path[]}` (or a shorthand
  `"<provider>.<line>.<path.with.dots>"`); tool builds the canonical
  `#{_dp('{...}')}` interpolated form.
- `formula` — value is a Ruby expression; tool wraps with `=` prefix and
  encodes embedded `_dp(...)` references the same way.
- `interpolated` — value is a templated string with placeholders; tool
  produces `#{_dp(...)}` substitutions.

Creates intermediate object nodes as needed (`records.item` → `records.item.items`
→ leaf).

**Refusal cases:** invalid path syntax; trying to overwrite a non-object with
a child; step not found.

This single tool would absorb maybe 60% of the heredoc Python I write.

---

### 3. `workato_recipe_set_extended_schema(recipe_id, step, kind, schema)`

The silent-strip rule is a real footgun. Today, when I add structured input
to a step (e.g. `records.parameters.<column_uuid> = ...` on
`create_records_batch`), I have to manually write a 30-line `extended_input_schema`
or Workato drops the fields on save with `code_errors: []` (no warning).

A dedicated tool would centralize that risk:

```
workato_recipe_set_extended_schema(
  recipe_id=72825615,
  step="ae888d2e",
  kind="extended_input_schema",   # or "extended_output_schema"
  schema=[...]                     # full schema array, or "auto" to derive from input
)
```

**Bonus:** with `schema="auto"`, the tool inspects the step's current `input`
shape and derives a minimal schema. That'd eliminate the silent-strip class
of bug entirely.

---

### 4. `workato_recipe_apply_to_steps(recipe_id, steps[], operation)`

Almost every edit in this session was applied to **both** the Invoice step
(`5c0d4007`) and the Credit Memo step (`04e75065`) — and will soon hit Vendor
Bill + Bill Credit too. Today I write `for step in (...): edit(step)` loops
in Python.

```
workato_recipe_apply_to_steps(
  recipe_id=72825615,
  steps=["5c0d4007", "04e75065"],
  operation={
    "kind": "set_input_path",
    "path": "records.custbody_mhi_client_email",
    "value": "py_eval.1616311d.lines[].client_email",
    "value_kind": "datapill"
  }
)
```

Atomic across all listed steps. Reports per-step outcomes.

---

### 5. `workato_recipe_delete_input_path(recipe_id, step, path)`

Inverse of `set_input_path`. Today I do `del step['input']['records']['tranId']`
in Python.

```
workato_recipe_delete_input_path(
  recipe_id=72825615,
  step="5c0d4007",
  path="records.tranId"
)
```

Removes the leaf; prunes empty parent objects upward.

---

### 6. `workato_recipe_get_step(recipe_id, step, view="raw")`

`pull_recipe(step=...)` already exists but returns the _compact_ view by
default with datapills rewritten in shorthand `datapill(...)` form. For
edits I often need the **raw** `_dp(...)` JSON to copy/extend without
manually reconstructing it.

Either add `view="raw"` to existing `pull_recipe(step=...)` or expose this as
a sibling tool. Should also include the step's `extended_input_schema` and
`extended_output_schema` verbatim (compact view strips them today).

---

## Lower-priority quality-of-life items

### 7. `workato_recipe_validate(recipe_id)`

Run Workato's server-side validation without saving. Currently I have to
`save_recipe_code` and read `code_errors` to learn about silent-strips or
schema mismatches. A no-side-effect validate would be nicer for tight loops.

### 8. Better error reporting on `save_recipe_code`

When `code_errors: [[12, [["Records",null,"can't be blank",["records"]]]]]`,
hint at the likely cause (missing `extended_input_schema` for a structured
input). The skill docs flag this pattern, but a hint in the error response
would help.

### 9. `workato_recipe_diff(recipe_id, code_path)`

Show what would change before saving. Useful as a dry-run.

### 10. `workato_lookup_table_get_row(table_id, key_column, key_value)`

Quick single-row lookup without paging through `lookup_table_get`. Helps with
spot-checking before referencing in a recipe formula.

### 11. Active-tab tolerance

Every tool today fails with "active tab is not a Workato page" if the user
clicked over to NetSuite / Google Drive / GitHub. The tool should either:

- transparently call `workato_ui_open_recipe(recipe_id)` before retrying, **or**
- accept a `tab_id` argument and use it directly (some already do — make
  consistent across the toolset)

This burned ~5 minutes per session navigating back to the Workato tab.

---

## Anti-patterns — what NOT to tool

A few things should **stay** as Python rather than become MCP tools, because
they're inherently one-off:

- **Bulk structural refactor.** The 21-step error-recovery refactor (adding
  `if(is_repeat)`, `try`, `catch`, failure-store branches under each upsert)
  is naturally code, not API.
- **Cross-step regex sweeps.** "Replace every `Invoices` reference in step
  `<as>` with `Credit_Memos`" — file-edit territory.
- **Building complex `=` formulas** that interleave SuiteQL/regex/multiple
  datapills (the line dedup SQL is ~10 lines of string concat with 4
  datapills woven in).

Tools should cover the **frequent narrow edits**, not the architectural
moves.

---

## Summary — if you implement only 3

The highest-leverage three, in order:

1. **`set_py_eval_code`** — kills the most-repeated mutation.
2. **`set_input_path`** with `value_kind` — covers ~60% of recipe edits.
3. **`set_extended_schema`** (especially with `schema="auto"`) — eliminates the silent-strip class of bugs.

Adding those would cut the average "edit the recipe" turn from a 30-line
heredoc to a single tool call.

---

## Context for the developer

Real session data backing this:

- 63 saved recipe versions in ~2 days of active work
- ~50 distinct mutations to the recipe code tree
- ~10× py_eval `code` field swaps
- Repository: `C:\Work\BB\Legacy\ObitPortal\`
- Reference scripts that show the patterns in action:
  - `build_recipe_refactor.py` (one-off, kept) — the 21-step structural refactor
  - The `Bash`/Python heredocs scattered through chat transcripts for the 50+
    smaller mutations

If you want a concrete sample of "what I write today," see
`build_recipe_refactor.py` and grep the conversation transcript for
`PYEOF` heredocs — those are real edits, each of which would shrink to a
single tool call under the proposal above.
