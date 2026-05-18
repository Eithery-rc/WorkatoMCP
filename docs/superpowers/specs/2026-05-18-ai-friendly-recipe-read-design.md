# AI-Friendly Recipe Read — Design

**Date:** 2026-05-18
**Status:** Approved (brainstorming)
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

| Param         | Type                    | Default      | Effect                                              |
| ------------- | ----------------------- | ------------ | --------------------------------------------------- |
| `recipe_id`   | number                  | _(required)_ | unchanged                                           |
| `view`        | `'compact'` \| `'full'` | `compact`    | whole-recipe read mode                              |
| `step`        | string                  | —            | `as` anchor or step number — single-step drill-down |
| `field_query` | string                  | —            | substring filter for `step` mode's schema search    |

Call shapes:

| Call                                                     | Returns                                  |
| -------------------------------------------------------- | ---------------------------------------- |
| `pull_recipe(id)`                                        | compact whole-recipe tree — **default**  |
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
  `description` (HTML stripped), `input` (verbatim), `block` (recursed).
- `step_count` counts action/control steps only; the trigger is reported
  separately under `trigger`.
- **Stripped:** `extended_input_schema`, `extended_output_schema`,
  `visible_config_fields`, `dynamicPickListSelection`, `job_report_config`,
  `job_report_schema`, and `skip` when `false`.
- `input` is kept **verbatim** — it holds `#{_dp(...)}` datapills that are
  semantically load-bearing; pruning it would be lossy.
- `description` has its `<span class="provider">…</span>` HTML stripped to plain
  text.

Measured reduction on the sample: 644 KB → 141 KB (≈78% smaller). The remaining
weight is the verbatim `input` of every step (Python source, NetSuite configs);
trimming that further is out of scope. The compact tree maps 1:1 to the full
tree by `n` / `as`, so it doubles as the cheap whole-recipe index — no separate
recipe-wide search is needed.

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

| Function          | Signature                                       | Job                        |
| ----------------- | ----------------------------------------------- | -------------------------- |
| `toCompactRecipe` | `(code, recipeId, version) → CompactRecipe`     | prune the tree             |
| `compactNode`     | `(node) → CompactStep`                          | prune one step node        |
| `stripHtml`       | `(s) → string`                                  | description cleanup        |
| `findStep`        | `(code, step) → RawNode \| null`                | locate by `as` or `number` |
| `flattenSchema`   | `(schema[], io, parentPath) → FieldEntry[]`     | flatten nested schema      |
| `searchFields`    | `(node, query?) → { fields, total, truncated }` | catalog + filter           |

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
   - `step` set → `searchFields(findStep(code, step), field_query)`; if
     `findStep` returns null → error.
   - else `view === 'full'` → today's `{ recipe_id, code, version }`.
   - else → `toCompactRecipe(code, recipe_id, version)`.
4. `JSON.stringify` the result into the `ToolResult` text content.

## Error handling

- `recipe_id` not a finite number → existing error.
- `view` not `compact`/`full` → `"Param [view] must be 'compact' or 'full'"`.
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
- `compactNode` — drops the four UI-metadata sections, keeps `input` verbatim,
  renames keys, drops `skip:false` but keeps `skip:true`.
- `toCompactRecipe` — recurses `block`, preserves nesting, emits `step_count`.
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
  `py_eval` `input`). Possible future optimisation; `input` stays verbatim now.
- Datapill prettification (`#{_dp(...)}` → human-readable refs).
- Any change to the in-page `pullInPage` fetch function.
