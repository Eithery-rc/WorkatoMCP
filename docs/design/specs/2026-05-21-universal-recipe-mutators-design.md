# Universal Recipe Mutators Design

**Date:** 2026-05-21
**Status:** Approved by delegated autonomy

## Problem

The current `workato_recipe_*` mutators cover only shallow edits:
`workato_recipe_set_step_input` writes one top-level scalar field and
`workato_recipe_map_datapill` writes one top-level datapill formula. Real
recipe maintenance often changes nested `input` mappings, structured objects,
Python code bodies, and explicit schema metadata. Agents currently fall back to
ad hoc local scripts for those narrow, repetitive edits.

## Scope

Implement universal recipe code-tree mutators, not integration-specific helpers:

- `workato_recipe_set_input_path`
- `workato_recipe_delete_input_path`
- `workato_recipe_set_py_eval_code`
- `workato_recipe_set_extended_schema`
- raw single-step retrieval through `workato_pull_recipe(step, view:"full")`

Defer these items because they are either higher risk or less foundational:
automatic schema derivation, multi-step batch operations, server-side validate
without save, recipe diff, lookup-table single-row lookup, and broad active-tab
tolerance across every Workato tool.

## Architecture

New mutators run in the native server. Each call pulls the full recipe through
the existing `workato_pull_recipe(view:"full")` tool, mutates the parsed code
tree in Node, then pushes the modified tree through
`workato_ui_save_recipe_code`. This keeps the mutation logic testable and gives
`workato_recipe_set_py_eval_code` safe local filesystem access for `code_path`.

The Chrome extension keeps owning authenticated Workato browser fetches. The
native server owns filesystem-aware orchestration and code-tree mutation.

## Tool Behavior

`workato_recipe_set_input_path` locates a step by number or `as`, creates
missing intermediate objects or arrays, and writes a value at a dotted or array
path. It supports:

- `literal`: write the JSON value as-is.
- `formula`: require a string and prefix `=` when absent.
- `datapill`: accept a lossless datapill object or shorthand
  `datapill(provider.line.path)` / `provider.line.path`, then write
  `#{_dp('...')}`.
- `interpolated`: require a string and write it as-is.

`workato_recipe_delete_input_path` removes a leaf from a step input and prunes
empty parents created only for that path.

`workato_recipe_set_py_eval_code` reads local file contents in the native server
when `code_path` is provided, validates by default that the target step is
`provider:"py_eval", name:"invoke_custom_py_code"`, and writes the contents to
`input.code`.

`workato_recipe_set_extended_schema` writes an explicit schema array to either
`extended_input_schema` or `extended_output_schema`. It does not derive schemas
automatically in this first pass.

`workato_pull_recipe(step, view:"full")` returns the raw step node, including
full schemas and raw `_dp(...)` strings. Existing default step inspection stays
unchanged.

## Error Handling

Mutators reject missing recipe IDs, invalid step refs, invalid paths, prototype
pollution path segments, missing parent containers, incompatible non-container
parents, invalid value kinds, malformed datapill specs, invalid schemas, and
non-py_eval targets for `set_py_eval_code` unless validation is disabled.

Upstream pull/save errors are returned unchanged as tool errors. Save responses
include Workato `code_errors` so callers can see validation issues immediately.

## Testing

Unit tests cover the native mutation engine without needing a browser:

- path parsing for dotted paths, numeric indexes, array paths, and invalid
  segments
- nested set behavior and refusal to overwrite non-container parents
- datapill object and shorthand conversion
- formula and interpolated values
- deletion with parent pruning
- py_eval code setting and validation
- extended schema setting
- native orchestration file handling for `code_path`

Existing file round-trip tests continue to cover pull/save file behavior.
