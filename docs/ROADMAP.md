# Roadmap

What's planned, what was considered and rejected, and why. Nothing here is a commitment to a date.

Most items come from real recipe-building sessions — the pattern that repeats often enough to deserve a tool. That's the bar: a tool should absorb a _frequent narrow edit_, not a one-off architectural change.

## Planned

### `workato_recipe_apply_to_steps`

Apply one mutation to several steps atomically, reporting per-step outcomes.

```
workato_recipe_apply_to_steps(
  recipe_id, steps: ["5c0d4007", "04e75065"],
  operation: { kind: "set_input_path", path: "records.custbody_client_email",
               value: "datapill(py_eval.1616311d.lines[].client_email)" },
)
```

Nearly every mapping change in practice lands on two or more parallel steps — an Invoice step and its Credit Memo twin, a Vendor Bill and its Bill Credit. Today that's a loop around `workato_recipe_set_input_path`, which means N round-trips and N version bumps for one logical change.

### `workato_recipe_validate`

Run Workato's server-side validation without saving, so silent-strip and schema-mismatch problems surface before a version is created rather than after. Today the only way to see `code_errors` is to save and read them back.

### Raw step view

`workato_pull_recipe(step: ...)` returns the compact view, with datapills rewritten in shorthand and extended schemas stripped. Wholesale edits need the exact `_dp(...)` JSON plus `extended_input_schema` / `extended_output_schema` verbatim. Either a `view: "raw"` on the step mode or a sibling tool.

### `workato_recipe_refresh_schema`

The recipe editor's schema-refresh button is backed by `POST /connections/<id>/extended_schema.json`. Wrapping it would let an agent re-derive a step's schema after a connector-side field change instead of hand-writing the array. The endpoint has been captured; reliability across connectors still needs checking — it returned empty for `execute_suiteql` during earlier reconnaissance.

### `workato_lookup_table_get_row`

Single-row lookup by key column and value, without paging through the whole table. Spot-checking a value before referencing it in a formula is currently more expensive than it should be.

### Better `code_errors` hints

`code_errors: [[12, [["Records", null, "can't be blank", ["records"]]]]]` almost always means a structured input was silently stripped because the step lacked an `extended_input_schema`. The save now detects the strip itself by reading the tree back, so what's left is mapping Workato's own error tuples onto the offending step and field — the readback names the paths, the `code_errors` array still doesn't.

### `workato_create_connection`

Stubbed at [`workato/create-connection.stub.ts`](../app/chrome-extension/entrypoints/background/tools/workato/create-connection.stub.ts) with the endpoint and body shape documented. Held back deliberately: creating a connection means handling auth material, which every other tool in this project is built to never touch. It needs a provider allowlist and a clear story on where credentials come from before it ships.

## Known debt

**The extension does not typecheck cleanly.** `pnpm typecheck` reports around 100 errors, all in code inherited from the upstream project — `record-replay-v3` and its tests, `element-marker`, `gif-recorder`, and a few browser tools. None are in the Workato tool families, and the build is unaffected (WXT/Vite transpiles without typechecking), which is why the errors went unnoticed for so long.

CI typechecks `workatomcp-shared` and `workatomcp-bridge` as a gate and reports the extension separately without failing the run. Paying this down means either fixing the inherited code or dropping the parts of the record-replay feature this fork doesn't use — the second is probably the better trade, since none of it serves the Workato use case.

## Considered and rejected

Some things are better left as code the agent writes, not tools:

- **Bulk structural refactors** — wrapping twenty steps in `if` / `try` / `catch` branches is naturally a script over the pulled tree, not an API.
- **Cross-step regex sweeps** — file-edit territory. Pull with `out_file`, edit, push.
- **Complex formula construction** — a ten-line SuiteQL formula interleaving four datapills is authoring work, not a parameterized call. The [`workato-recipes` skill](../skills/workato-recipes/) exists to make that authoring correct.

## Superseded

| Idea                                | Superseded by                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `workato_push_recipe`               | `workato_ui_save_recipe_code`, which does the same PUT with version locking, restart handling, and timeout verification |
| `workato_run_soql`                  | `workato_run_query`, generic across SOQL, SuiteQL, and SQL                                                              |
| `workato_schema_derive`             | `workato_recipe_set_extended_schema`                                                                                    |
| Nested-path Python round-trips      | `workato_recipe_set_input_path` / `delete_input_path` / `set_py_eval_code`                                              |
| "Active tab isn't Workato" failures | Unified tab resolution — explicit `tabId`, pinned session tab, or any Workato app tab                                   |

Stub files for the superseded tools remain in the source tree as historical reference for the endpoint shapes.

## Design notes

Specs and implementation plans for shipped work live in [`docs/design/`](design/). They record the reverse-engineered endpoints — request shapes, headers, gotchas — and are the first place to look before adding a tool that touches an unfamiliar part of the Workato API.
