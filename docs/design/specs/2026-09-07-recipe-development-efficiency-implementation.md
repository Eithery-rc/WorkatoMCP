# Recipe development efficiency: implementation record (2026-09-07)

What actually shipped against [the plan](../plans/2026-09-07-recipe-development-efficiency.md), which decisions departed from it and why, and what is still open. The plan's baseline evidence is [the audit](../../audits/2026-09-07-recipe-authoring-audit.md); the live endpoint captures behind the work are distributed with the skill, in [`skills/workato-recipes/platform-endpoints.md`](../../../skills/workato-recipes/platform-endpoints.md).

Twelve packages, two waves. Everything below is on `master`.

## What shipped, per delivery

### Delivery 1: correct mutations, routing, and outcome reporting

**Tools.** `workato_recipe_apply` (new). `workato_recipe_add_step`, `workato_recipe_set_step_input`, `workato_recipe_map_datapill` rerouted to the bridge. `workato_session_context` (new). Changed: `workato_ui_save_recipe_code`, `workato_switch_profile`, `workato_list_profiles`, `workato_pull_recipe` (origin block), `workato_start_recipe`, `workato_stop_recipe`.

**Key files.** `app/native-server/src/mcp/workato-recipe-engine.ts` (new, the single guarded pull, clone, apply, renumber, derive, validate, merge-config, save, summarize path), `workato-recipe-apply.ts` (new), `workato-recipe-mutators.ts` (now a re-export shim for the historical names), `workato-file-io.ts` (origin block, version lock defaulting, recipe id refusal), `register-tools.ts` (session tuple, `expected_context` injection, context stamping), `app/chrome-extension/entrypoints/background/tools/workato/session-context.ts` (new). `app/chrome-extension/entrypoints/background/tools/workato-recipe/` deleted.

**Outcome reporting.** Saves report `persisted` / `valid` / `verified` and a `save_status` of `ok`, `already_applied`, `persisted_invalid`, `persisted_incomplete` or `succeeded_after_timeout`. Start and stop report `outcome` of `state_reached`, `accepted` or `failed`.

**Acceptance.** The audit's nested add-step and stale-file reproductions pass. Verified live 2026-09-07: the add-step audit reproduction, `workato_recipe_apply` batching, `dry_run`, idempotency, the stale-lock refusal and the `remove_step` datapill guard, the file version lock, the recipe id mismatch refusal, `ignore_file_version`, `workato_session_context` and the context block.

### Delivery 2: bounded reads and search inside a recipe

**Tools.** `workato_recipe_grep` (new). `workato_pull_recipe` gains `include`, `paths`, `fields` (`field_query` alias), `steps`, `max_items`, `budget_chars`, `cursor`, `if_version`, plus `provenance` and `fields_complete` on a step view. Generic `out_file` / `auto_file` / `auto_file_threshold_chars` on the read surface. `chrome_screenshot` returns an MCP image block.

**Key files.** `pull-recipe.ts`, `recipe-projection.ts` (generic `packLists` / `previewLongValues` / `readPaths` / cursors), `recipe-snapshot.ts` (host plus recipe plus version LRU, 32 entries, 20 MB), `recipe-grep.ts`, `recipe-view.ts` (static field merge), `app/native-server/src/mcp/workato-auto-file.ts` (new).

**Acceptance.** Exact-field reads stay small, every list carries a limit and a cursor, projected traces keep `0` and `false`, and screenshots come back as image blocks with no base64 in text. Verified live: `workato_recipe_grep`, the `chrome_screenshot` image block and `out_file`.

### Delivery 3: jobs that can be found without walking pages

**Tools.** `workato_list_jobs` gains `match`, `scan_budget`, `stop_on_erased`, `started_from`, `started_to`, `timezone`, `fields`, `report_labels`, plus `coverage`, `summary`, `report_columns` and the erased shape. `workato_job_trace` gains `paths`, `empty`, `max_items`, `fields` and the erased trace. `workato_search_recipes` gains `match`, `app`, `running`, `max_pages`, `limit`, coverage and cleaned highlights. `workato_recipe_step_search` gains `folder_ids`, `recipe_ids`, `input_query`, `input_match`, `preview_chars`.

**Key files.** `list-jobs.ts`, `job-projection.ts`, `slim-trace.ts`, `search-recipes.ts`, `step-search.ts`, `slim-asset.ts`.

**Acceptance.** A known retained report value is found, a custom interval is expressible, erased and empty are distinguishable, and an incomplete search says so. Verified live: `query`, `match`, the date range, `timezone`, the erased boundary, report labels, the erased trace and the trace projection, `search_recipes` in `fulltext` and `name_substring`.

### Delivery 4: caller discovery

**Tools.** `workato_recipe_callers` (new). `workato_recipe_save_with_dependents` gains `scan_folder_ids`, `scan_project_id`, `scan_scope`, and consumes the discovery result.

**Key files.** `app/chrome-extension/entrypoints/background/tools/workato/recipe-callers.ts`, `app/native-server/src/mcp/workato-recipe-callers.ts` (`discoverCallers` replaces `scanFolderForDependents`).

**Acceptance.** A fixture with callers across folders, including one beyond page 1, is discovered; repeated calls reuse the index; unreadable recipes and dynamic flow ids make completeness explicit. Verified live: three callers of 76902508.

### Delivery 5: recoverable operations and connection diagnosis

**Tools.** `workato_recipe_connections` (new), `workato_operation_status` (new, bridge-local, `resume: true` writes). `workato_recipe_save_with_dependents` gains `async` and `preflight_connections`. `workato_recipe_status` gains `activation`. `workato_start_recipe` gains `start_error`.

**Key files.** `recipe-connections.ts`, `recipe-state.ts` (both extension), `app/native-server/src/mcp/workato-operations.ts` (the journal), `workato-save-dependents.ts` (restructured around it).

**Acceptance.** A disconnected connector is diagnosed without a browser hunt; an interrupted save keeps its identity and can be resumed without a duplicate version; a failed restart is named. Verified live: start-failure diagnosis with `config_errors` and the connections summary, `workato_recipe_status` `activation`, `workato_recipe_connections`, `workato_recipe_save_with_dependents` with its journal, and `workato_operation_status` `list`, `refresh` and `resume`.

### Delivery 6: batch editing and deterministic schema generation

**Tools.** `workato_recipe_apply` (Delivery 1 above) plus the `derive_schema` op and `auto_schema`. `workato_recipe_validate` (new, bridge-local, never saves).

**Key files.** `app/native-server/src/mcp/workato-recipe-schema.ts` (derivation, `mergeFieldSchemas`), `workato-recipe-validate.ts`.

**Acceptance.** Several mapping changes create one version; an invalid local operation writes nothing; Variables and List structured inputs survive readback without copying another recipe. The derivation's three `documented`-tier kinds are not yet observed live.

### Delivery 7: supported test execution

**Tools.** `workato_test_recipe` (new). `workato_call_action` description states the connection-id limit.

**Key files.** `app/chrome-extension/entrypoints/background/tools/workato/test-recipe.ts`.

**Acceptance.** A supported test receives the fixture and returns a traceable job; an unsupported trigger fails explicitly before any side effect. Verified live: `input` mode and `unsupported` mode.

### Documentation and measurement

**Tools.** `workato_bridge_info` (new, bridge-local).

**Key files.** `app/native-server/src/mcp/server-identity.ts` (name `WorkatoMCP`, the real bridge version, a 1360-byte task-to-tool `instructions` string), `workato-bridge-info.ts`, `.github/workflows/ci.yml` (both suites), `app/chrome-extension/scripts/check-bundle.mjs`, the description-budget and tool-name-drift tests.

**Acceptance.** Verified live: `workato_bridge_info`. The plan's full task replay with usage measurement has not been run; no percentage saving is claimed.

## Decisions that departed from the plan

| Decision                                                                        | Plan said                                                                                                | What shipped, and why                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The dependency graph is the primary caller source**                           | Paginate the folder scan and build a code index; treat a runtime `Called By` as supplementary            | The probe found `GET /dependency_graphs/<id>.json?asset_type=recipe`: one request, workspace-wide, the same edges the Operations hub draws. It became a first-class source alongside the code scan, which is kept because it is the only one that can name the calling STEP and the only one that can report a dynamic `flow_id`. Jobs evidence is third and explicitly labelled as execution history.                      |
| **Folder scopes do not use the search endpoint**                                | Not addressed                                                                                            | `GET /web_api/mixed_assets.json` ignores `folder_id` entirely (re-probed with four variants; each returned the workspace-wide list across four folders). Folder membership is resolved through `GET /dependency_graphs.json?asset_type=recipe&folder_id=<fid>`, or by filtering walked items on their own `folder_id`, and the tools report which in `coverage` / `scope`.                                                  |
| **No `workato_publish_message`**                                                | Add it through a verified Event Streams endpoint or a thin connectionless wrapper                        | There is no endpoint. `POST /web_api/pub_sub/topics/<id>/messages.json` is 404 and the topics UI has no publish action. Shipping a tool over a workaround would make an unsupported path look supported, so the supported path is documented instead: a `workato_pub_sub` / `publish_to_topic` step run under `workato_test_recipe`.                                                                                        |
| **`workato_call_action` stays connection-bound**                                | Allow execution of supported connectionless built-in actions using adapter identity                      | `POST /connections/<adapter_name>/test_action.json` is 404: the endpoint requires a real connection id. (`sample_output.json` does accept adapter names, but it returns a sample, not an execution.) The tool now says so, and points at `workato_test_recipe` as the only way to execute a connectionless step.                                                                                                            |
| **Auto-file is on by default above 60,000 characters**                          | "An auto-file mode may return summary, file reference, version, size, and truncation details"            | Default-on for a named `READ_TOOLS` set, default-off for `chrome_screenshot`. The threshold is a served parameter (`auto_file_threshold_chars`) so a caller can move it, and the three properties are injected into the served schemas rather than repeated per tool. The four tools that already own an `out_file` hook are excluded and unchanged.                                                                        |
| **`auto_schema` defaults to true, over the whole tree**                         | Derive Variables and List schemas from their declarations                                                | Deriving only the edited step would not have fixed the bug: a save rewrites the whole tree, so an untouched `declare_list` with no schema loses its items on this save too. Derived nodes are deliberately not marked as touched, so filling in a schema cannot promote an unrelated pre-existing quirk into a refusal. `call_recipe`'s `input.parameters` is excluded because `workato_caller_bind` already owns that key. |
| **The legacy mutator names are routed to the bridge**                           | "Route `add_step`, legacy `set_step_input`, and `map_datapill` through the same guarded engine"          | The engine lives in the bridge, so the names resolve there and the extension implementation was deleted rather than kept as a second path. Consequence: bridge and extension must ship together.                                                                                                                                                                                                                            |
| **`workato_operation_status(resume: true)` rather than a separate resume tool** | "Expose `workato_operation_status` and resume/recovery behavior"                                         | Resume rides on the status tool. It is a write behind a status-shaped name, so the argument's description opens with `WRITES:` and a schema test asserts that.                                                                                                                                                                                                                                                              |
| **An interruption does not auto-restore**                                       | "If recovery cannot safely finish, list exact affected ids and reasons"                                  | When a nested call throws, the transport that would carry the restore is the one that just failed, and a blind restore against unknown state is what the plan says not to do. The response returns `operation_id` plus the partial dependent state and asks for a resume. This replaces the old outer catch, which always called `restoreAll`.                                                                              |
| **Validation is softer than the authoring guidance in three places**            | Not addressed                                                                                            | Workato accepts hand-written anchors such as `tjcall01`, so a non-hex `as` on an existing step is a warning, not an error. A step inside a `catch` reading its own `catch.<as>.message` is not a forward reference. A `catch` never needs an `extended_output_schema`. Grading any of these as errors would refuse saves on working recipes.                                                                                |
| **The catalogue was not split**                                                 | "Do not build a separate catalog gateway ... Improve tool names, search terms, short selection guidance" | Followed as written. The effort went into the server `instructions` task-to-tool table, the skill's own table, a 2048-byte description budget test, and trimming `workato_apps_list` from 2245 to 1947 bytes with every load-bearing rule kept.                                                                                                                                                                             |

## Endpoint captures

All live-verified on 2026-09-07 in a Development environment, recorded in [`skills/workato-recipes/platform-endpoints.md`](../../../skills/workato-recipes/platform-endpoints.md) and summarised in the memory note `reference-workato-endpoints-2026-09-07`:

- `jobs.json` parameters, the `query` substring semantics, the custom range, and the erased shape.
- The job detail and `line_details` endpoints, including `line_details: []` on an erased job.
- `dependency_graphs` for a recipe and a lookup table, the folder listing, and the type list.
- `mixed_assets` search parameters and the long list of parameters it ignores, `folder_id` included.
- `/recipes/<id>.json`, `code.json?version_no`, `status.json`, and `state.json` with both `config_errors` serializations.
- `start.json` and `stop.json` 202 semantics and the `active_dependent_recipes_count` refusal.
- `test.json` with `trigger_event`, `stop_test.json`, `poll_now.json`, `sample_output.json` accepting adapter names, and `test_action.json` refusing them.
- `/connections/<id>.json` health fields and `/connections.json?adapter[]=`.
- Event Streams topic CRUD and `messages.json`, with no publish route.
- `activity_logs/latest_activity_by_resource` and `queue_stats`.
- The routes that are 404, so nobody probes them again.

## Open items

- **No continuation cursor for `workato_recipe_callers`.** A workspace-wide scan that exhausts its time budget reports the unread count and `completeness: partial`, but the next attempt starts over.
- **Auto-file writes are never cleaned up.** Files accumulate under `<tmpdir>/workatomcp-results/session-<pid>-<stamp>/`; no TTL, no size cap.
- **`windowId` is not uniform.** `findWorkatoTab` honours it, but `resolveTabId` still falls through to global discovery when the named window holds no Workato tab, and several tools expose no `windowId` at all.
- **`workato_test_recipe`'s write gate is not transitive.** It reads only the recipe under test, so a connectionless recipe calling a callee that touches a connection runs without `allow_writes`. The callee index from `workato_recipe_callers` is the natural input.
- **Job `match` on `title` is unverified live.** No job anywhere in the probed workspace had a non-empty title, and whether the server `query` matches a title is likewise unverified.
- **The `lost` branch of `workato_recipe_connections` is unverified live.** Every connection in the probed workspace was `authorization_status: success`, so a broken connection's actual field values have never been seen. Any status other than `success`, or a non-null `connection_lost_at`, is read as lost.
- **Three schema derivations are `documented`, not `verified`.** `insert_to_list`, `declare_variable` and `update_variables` rest on the `code-tree.md` silent-strip rule; only `declare_list` and the clock trigger were observed persisting on a live save. Restricting `applyDerivedSchemas` to the verified kinds is a two-line change in `isDerivableStep` if a live save ever shows Workato rejecting one.
- **`mergeFieldSchemas` has no tool surface.** It is exported and unit-tested; wiring it needs adapter meta inside an otherwise network-free validator, which wants its own opt-in flag.
- **Orchestrator-internal auto-file is not built.** Spilling a nested pull would hand the orchestrator a summary instead of the payload, so it needs a per-call opt-in rather than the current hook.
- **The plan's measured task replay has not been run.** No percentage saving is claimed anywhere in this release.
- **Bridge coverage thresholds** (70/80/80/80) are still red at 69.15/59.5/70.5/75.4 and are formally non-gating in CI.
