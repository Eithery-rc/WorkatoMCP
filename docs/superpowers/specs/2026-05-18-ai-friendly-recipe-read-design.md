# AI-Friendly Recipe Read — Design

**Date:** 2026-05-18
**Status:** Approved (brainstorming) — extended with the `outline` view and
datapill shortening after the first live test showed the `compact` view can
still overflow the harness's per-tool-result token cap for very large recipes.
**Tool affected:** `workato_pull_recipe`

## Problem

`workato_pull_recipe` returns a recipe's full code tree. Real recipes are huge —
a 27-step sample (`adpay-load-mvp`, recipe 72436887) is **644 KB**. Feeding that
to an agent burns context and buries the meaningful logic in UI metadata.

Size breakdown of that sample:

| Section                              | Bytes  | %   | What it is                                                |
| ------------------------------------ | ------ | --- | --------------------------------------------------------- |
| `extended_input_schema`              | 505 KB | 78% | UI control metadata (control_type, label, ngIf, defaults) |
| `input`                              | 66 KB  | 10% | The actual configured values — the meaningful part        |
| `extended_output_schema`             | 54 KB  | 8%  | Datapill output schemas                                   |
| `visible_config_fields`              | 8 KB   | 1%  | UI field ordering                                         |
| step tree / descriptions / providers | ~10 KB | 2%  | structure                                                 |

One NetSuite `batch_upsert_rest` step alone carries 227 KB of
`extended_input_schema`. The UI-metadata sections are noise for an agent that
wants to understand or edit a recipe.

## Goal

Make `workato_pull_recipe` return an AI-friendly payload by default, while
keeping a lossless mode and adding a way to drill into one fat step's schema
without dumping all of it. One tool, no new tools.

## Approach (chosen: A — parameters on the existing tool)

`workato_pull_recipe` gains three optional parameters. No new tools are added.
Each call shape has one clear job.

### Tool surface

| Param         | Type                                   | Default      | Effect                                              |
| ------------- | -------------------------------------- | ------------ | --------------------------------------------------- |
| `recipe_id`   | number                                 | _(required)_ | unchanged                                           |
| `view`        | `'compact'` \| `'outline'` \| `'full'` | `compact`    | whole-recipe read mode                              |
| `step`        | string                                 | —            | `as` anchor or step number — single-step drill-down |
| `field_query` | string                                 | —            | substring filter for `step` mode's schema search    |

Call shapes:

| Call                                                     | Returns                                  |
| -------------------------------------------------------- | ---------------------------------------- |
| `pull_recipe(id)`                                        | compact whole-recipe tree — **default**  |
| `pull_recipe(id, view:'outline')`                        | structural tree, no step inputs          |
| `pull_recipe(id, view:'full')`                           | today's exact lossless tree              |
| `pull_recipe(id, step:'98cc4bea')`                       | one step's config + pruned field catalog |
| `pull_recipe(id, step:'98cc4bea', field_query:'amount')` | that step's fields matching "amount"     |

Precedence: when `step` is set, `view` is ignored. `field_query` is only valid
with `step` (error otherwise).

**Default flip is safe.** The `workato_recipe_*` mutators and
`workato_ui_save_recipe_code` do their own internal pull/PUT and never call this
MCP tool, so changing the default to `compact` regresses nothing.

## Behaviour

### `view: 'full'`

Byte-for-byte identical to today's output: `{ recipe_id, code, version }` where
`code` is the unmodified parsed code tree.

### `view: 'compact'` (default)

The same nested step tree with UI-metadata sections removed. Output shape:

```json
{
  "recipe_id": 72436887,
  "name": "AdPay Load MVP",
  "version": { "version_no": 12, "folder_id": 123, "description": "..." },
  "step_count": 27,
  "trigger": {
    "n": 1,
    "type": "trigger",
    "app": "...",
    "name": "...",
    "as": "32b1601c",
    "description": "...",
    "input": {}
  },
  "steps": [
    {
      "n": 2,
      "type": "action",
      "app": "workato_db_table",
      "name": "get_records",
      "as": "98cc4bea",
      "uuid": "0c7bd277-...",
      "description": "Search records in AdPay Processing errors data table",
      "input": { "table_id": "110379", "limit": "1000", "filters": [] },
      "block": [
        /* nested steps for if / try / foreach branches */
      ]
    }
  ]
}
```

Per node:

- **Kept:** `number`→`n`, `keyword`→`type`, `provider`→`app`, `name`, `as`,
  `uuid`, `title` (only when set to a non-empty value — a user-set step title),
  `description` (HTML stripped), `input` (datapills shortened — see below),
  `block` (recursed).
- `step_count` counts action/control steps only; the trigger is reported
  separately under `trigger`.
- **Stripped:** `extended_input_schema`, `extended_output_schema`,
  `visible_config_fields`, `dynamicPickListSelection`, `job_report_config`,
  `job_report_schema`, and `skip` when `false`.
- `description` has its `<span class="provider">…</span>` HTML stripped to plain
  text.

**Datapill shortening.** A saved recipe references upstream data with verbose
`_dp('{...json...}')` blobs — e.g.
`_dp('{"pill_type":"output","provider":"py_eval","line":"e4f443bd","path":["output","Invoices",{"path_element_type":"current_item"},"lines",{"path_element_type":"current_item"},"amount"]}')`
(~190 chars). In `compact` (and `step`) mode each `_dp('...')` is rewritten to a
short dotted reference: `datapill(py_eval.e4f443bd.output.Invoices[].lines[].amount)`.
Loop items (`current_item`) collapse to `[]`, array sizes to `.size`,
`job_context` pills keep their `pill_type` as the head. A reference whose JSON
fails to parse is left untouched. This is **lossy-but-readable** — `view:'full'`
remains the only source of the exact `_dp(...)` form, and the recipe-mutation
tools never consume the compact view, so there is no write-back risk.

Measured reduction on the sample: 644 KB → ~71 KB (≈89% smaller). Even so, a
recipe this large can still exceed the harness's per-tool-result token cap — use
`view:'outline'` when that happens. The compact tree maps 1:1 to the full tree
by `n` / `as`, so it doubles as the cheap whole-recipe index — no separate
recipe-wide search is needed.

### `view: 'outline'`

Identical to `compact` but every step's `input` is dropped entirely. What
remains is pure structure: the step tree, `type`/`app`/`name`/`as`, and
`description`. This is the lightest view (single-digit KB even for large
recipes) and always fits inline. The agent scans the outline to grasp recipe
shape and flow, then uses `step` mode to read any individual step's actual
configuration.

### `step` mode — searchable schema inspector

Locate one step by `step` (matches `as` anchor, or step `number` when the value
parses as an integer). Walk the full tree to find it.

**`step` without `field_query`** — returns:

```json
{
  "recipe_id": 72436887,
  "step": {
    "n": 12,
    "type": "action",
    "app": "...",
    "name": "batch_upsert_rest",
    "as": "...",
    "description": "...",
    "input": {}
  },
  "fields": [
    {
      "path": "body.items[].adj_cost_estimate",
      "name": "adj_cost_estimate",
      "label": "Adj cost estimate",
      "type": "number",
      "optional": true,
      "control_type": "number",
      "io": "in"
    }
  ],
  "total_fields": 432,
  "fields_truncated": true
}
```

- `fields` is a **flat catalog** built from the step's `extended_input_schema`
  (`io: "in"`) and `extended_output_schema` (`io: "out"`). Nested schema entries
  (`properties`) are flattened with a dotted `path`; array nesting uses `[]`.
- Capped at **60 fields**. When the step has more, `fields_truncated` is `true`
  and `total_fields` gives the real count, signalling the agent to narrow with
  `field_query`.

**`step` with `field_query`** — same shape, but `fields` contains only entries
whose `name` or `label` contains `field_query` (case-insensitive). Uncapped
(matches are naturally few); `fields_truncated` is always `false`.

## Components

All new logic is a **pure transform layer** in the extension background script,
applied to the parsed `code` object _after_ it returns from the in-page fetch.
The in-page `pullInPage` function is **not touched** — it keeps its bundler-safe
promise-chain form (see `reference_v1_pitfalls_resolved`).

New module: `app/chrome-extension/entrypoints/background/tools/workato/recipe-view.ts`

| Function           | Signature                                               | Job                          |
| ------------------ | ------------------------------------------------------- | ---------------------------- |
| `toCompactRecipe`  | `(code, recipeId, version, omitInput?) → CompactRecipe` | prune the tree               |
| `compactNode`      | `(node, omitInput?) → CompactStep`                      | prune one step node          |
| `stripHtml`        | `(s) → string`                                          | description cleanup          |
| `pillToRef`        | `(pill) → string`                                       | render a parsed pill short   |
| `shortenDatapills` | `(value) → value`                                       | rewrite `_dp(...)` in inputs |
| `findStep`         | `(code, step) → RawNode \| null`                        | locate by `as` or `number`   |
| `flattenSchema`    | `(schema[], io, parentPath) → FieldEntry[]`             | flatten nested schema        |
| `searchFields`     | `(node, recipeId, query?) → StepView`                   | catalog + filter             |

`pull-recipe.ts` `execute()` reads the new args, calls `runInWorkatoTab` exactly
as today to get the raw `code`, then dispatches to the transform layer based on
`step` / `view` before serialising the response.

Shared schema: `packages/shared/src/tools.ts` — the `PULL_RECIPE` entry gains
`view`, `step`, `field_query` properties and updated description text.

## Data flow

1. `execute(args)` validates `recipe_id` (existing); validates `view` enum;
   validates `field_query` is only present with `step`.
2. `findWorkatoTab()` + `runInWorkatoTab(tabId, pullInPage, [recipe_id])` —
   unchanged. Yields `{ code, version }`.
3. Dispatch:
   - `step` set → `searchFields(findStep(code, step), recipe_id, field_query)`;
     if `findStep` returns null → error.
   - else `view === 'full'` → today's `{ recipe_id, code, version }`.
   - else → `toCompactRecipe(code, recipe_id, version, view === 'outline')`.
4. `JSON.stringify` the result into the `ToolResult` text content.

## Error handling

- `recipe_id` not a finite number → existing error.
- `view` not `compact`/`outline`/`full` →
  `"Param [view] must be 'compact', 'outline', or 'full'"`.
- `field_query` set without `step` → `"Param [field_query] requires [step]"`.
- `step` matches no node → error listing available step numbers and `as`
  anchors so the agent can retry.
- API/shape failures from the in-page fetch → existing `WorkatoApiError`
  handling, unchanged.

## Testing

Vitest (already used in the extension). New file:
`app/chrome-extension/tests/workato/recipe-view.test.ts`, fed by a trimmed
fixture derived from a `.tmp` dump.

- `stripHtml` — removes `<span>` markup, leaves plain text.
- `compactNode` — drops the four UI-metadata sections, shortens datapills in
  `input`, renames keys, drops `skip:false` but keeps `skip:true`, drops `input`
  when `omitInput` is set.
- `pillToRef` — renders output and `job_context` pills, `[]` for loop items,
  `.size` for array sizes.
- `shortenDatapills` — rewrites `_dp(...)` in strings, recurses objects/arrays,
  leaves unparseable references untouched, passes scalars through.
- `toCompactRecipe` — recurses `block`, preserves nesting, emits `step_count`;
  `omitInput` produces the outline (no step inputs).
- `findStep` — resolves by `as` and by numeric `number`; returns null on miss.
- `flattenSchema` — flattens nested `properties` with correct dotted `path`
  and `[]` for arrays.
- `searchFields` — caps at 60 without query; `field_query` filters by name and
  label case-insensitively and is uncapped; `total_fields`/`fields_truncated`
  correct.

Pure functions only — no browser needed. The in-page fetch path is unchanged
and stays out of scope.

## Out of scope

- Recipe-wide cross-step search — the compact view already serves as the index.
- Per-app special-casing (e.g. trimming `code_output_schema_json` inside
  `py_eval` `input`). Possible future optimisation.
- Reversing shortened `datapill(...)` refs back to `_dp(...)` — the compact and
  outline views are read-only; write-back uses `view:'full'` or the mutators.
- Any change to the in-page `pullInPage` fetch function.
