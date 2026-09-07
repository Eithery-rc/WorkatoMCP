# Changelog

All notable changes to WorkatoMCP. Versions refer to the published npm packages — `workatomcp-bridge` (the local bridge) and `workatomcp-shared` (tool schemas). The Chrome extension is built from source and versioned alongside them.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions. Dates are the commit dates of the corresponding release.

## Unreleased

### Added

- **`workato_recipe_connections`**: the connections one recipe is bound to, and whether they can still authenticate. Workato publishes no per-recipe connection endpoint, so the tool reads the recipe's `config` bindings, then each bound connection, then `/integrations/meta` for the providers that carry no `account_id`, and returns one entry per binding with `status` of `ok`, `lost`, `missing`, `not_required` or `unknown`, plus a verdict `{healthy, blocking, actions}`. The actions are phrased the way the skill asks for them: a broken connection is named by id to re-authorize, never replaced by a request for a new one, and a provider whose adapter needs no connection is reported as `not_required` rather than as a hole. Credentials and the provider input bag never leave the tool: the response passes through `stripConnectionSecrets` and then a field whitelist.
- **A failed start now says why.** `POST start.json` answers `202 {"status":"enqueued"}` whether or not the recipe can start, and `/recipes/<id>.json` afterwards records nothing: no `stop_reason`, no `last_actionable_error`, no `requirements_errors`. The reason lives only in `/web_api/recipes/<id>/state.json`, which the editor polls right after the Start click. `workato_start_recipe` now reads it when a `wait:true` window ends without the state flipping, and returns an ERROR carrying `start_error` `{state, code_errors, config_errors, param_errors, requirements_errors, message}` that names the offending line and field. `config_errors` is normalized to `[{line_number, field, value, message}]` from either serialization Workato uses (positional arrays on later reads, objects on the read right after activation), and a config error about `account_id` also attaches a compact connection summary, so a disconnected connector is diagnosed in the same call instead of a browser hunt.
- `workato_recipe_status` returns `activation` `{state, error_message?, config_errors?}`: the last activation attempt as Workato recorded it. No error there means no failed attempt on record, which is not the same as "this recipe can start"; there is no pre-start validation endpoint (`validate.json` and `ready.json` are both 404).
- **`workato_test_recipe`**: run a recipe's Test, with trigger input, from the tool layer. Until now the only way to feed an event into a recipe was to build a throwaway recipe and click Test in the browser. The mode is read from the trigger rather than promised for everything: a `workato_recipe_function` trigger takes `trigger_input` (sent as `trigger_event.parameters`, checked against the trigger's declared parameters first, so a typo is refused instead of arriving as an empty pill), a `clock` trigger runs immediately and accepts no input, a webhook or `workato_pub_sub` trigger arms a test that waits for a real event (`action:'stop'` ends it), and any other trigger is refused before a request is sent. Workato's response carries no job id, so the tool records the test jobs that already exist, sends the PUT, and polls the test-job list; a wait that runs out returns status `pending` with the elapsed time and the job as it actually stands, never a guessed outcome. The recipe is not started and stays stopped afterwards with `stop_reason: test_run_stop`.
- **Testing is execution, so it is gated like one.** A test runs the recipe's real steps, so `allow_writes: true` is required whenever the recipe binds a connection-backed provider (a `config` entry carrying `account_id`, or a step provider the config does not describe at all). The refusal names the providers and happens before any HTTP. A recipe whose providers are all connectionless (logger, Variables, Event Streams, Scheduler, Python) runs without the flag, which is what makes a probe recipe cheap to run.
- **Publishing to an Event Streams topic has no API, and the tools now say so.** The topics UI has no publish action and `POST /web_api/pub_sub/topics/<id>/messages.json` is a 404, so no `workato_publish_message` tool was added. The supported path, documented on `workato_test_recipe`, is to test-run a recipe with a `workato_pub_sub`/`publish_to_topic` step whose input is `{topic_id, message}` plus a matching `extended_input_schema`. `workato_call_action` now states the matching limit: its endpoint needs a real connection id, an adapter name is rejected, so a connectionless step can only be executed inside a recipe test.

- **`workato_recipe_apply`**: several recipe edits in ONE pull, validate, save, readback cycle, so five mappings create one version instead of five. Ops: `set_input`, `delete_input`, `set_extended_schema`, `set_py_eval_code`, `map_datapill`, plus the structural ones the surgical tools never had: `insert_step`, `remove_step`, `move_step`, `set_loop_source`, `bind_connection`. Steps are addressed by number, `as` anchor, or uuid, and a number that appears twice in a tree an older renumbering bug corrupted is refused rather than resolved to the first hit. Every change is applied to a CLONE of the pulled tree: one invalid operation refuses the whole batch before anything is written, naming the change index, the step and the reason. `dry_run` returns the same summary (validation, `changed_paths`, `would_save_version`) without saving; `idempotency_key` makes a retried batch return the stored summary instead of creating a second version.
- **A shared mutation engine** (`workato-recipe-engine.ts`) behind every native recipe write: the surgical mutators, the batch tool, the three legacy names and the callable-schema tools now pull once, mutate a clone, validate locally, merge the config, save once and summarize once. Local validation covers what Workato accepts silently and then runs wrong: globally sequential numbering including nested blocks, unique 8-hex `as` anchors, a uuid on every node the call creates (the live probe: a node without one is rejected with `code is invalid: line=0, uuid not present`), `else`/`elsif` last inside an `if` block, `catch` last inside `try`, `while_condition` first inside `repeat`, and a `foreach` whose `source` sits at the node root rather than under `input`.
- **Mutation responses distinguish persisted, valid and verified**, alongside `changed_paths` and `version_no`. A save that stored a tree Workato rejects is persisted and NOT valid, and used to read exactly like a clean edit.

### Changed

- **`workato_start_recipe` and `workato_stop_recipe` report how far the call got.** Every response carries `outcome`: `state_reached` when the recipe reports the state that was asked for, `accepted` when Workato took the request and the end state is NOT verified, `failed` when Workato refused to activate the recipe. A start that never reached running used to come back as a success with `state_flipped: false` buried in the JSON, which reads as restored to anything checking `isError` alone.



- `workato_recipe_add_step`'s `keyword` enum matches the code tree: `action`, `if`, `foreach`, `repeat`, `try`, `stop`. `repeat_each` and `return_result` were never keywords (a foreach is `foreach`, a return_result is an `action` named `return_result` on `workato_recipe_function`) and produced a malformed node with no `block`, `source` or `condition`. A `repeat` is built with its `while_condition` as the first child and a `try` with its `catch` last.
- The three legacy mutators, plus `workato_recipe_delete_input_path`, `set_py_eval_code` and `set_extended_schema`, advertise the save modifiers their handler already forwarded: `expected_base_version_no`, `comment`, `verify_readback`, `restart_if_running`, `ensure_running`, and `dry_run` where it applies.
- The three legacy mutators moved out of the Chrome extension into the bridge; `app/chrome-extension/entrypoints/background/tools/workato-recipe/` is deleted, so there is one implementation rather than two that drift.

### Fixed

- **`workato_call_action` no longer auto-retries a write.** The dispatcher retries once on a timeout, which is right for a read and doubles anything else: a timed-out `create_record` could be applied twice. The tool now passes `retryOnTimeout: false` whenever its own gate does not classify the action as read-only.
- **`workato_search_connections(full: true)` strips secrets.** The slim shape whitelists fields, but the raw list items were returned as Workato sent them, the one path out of the connection tools that had no strip. It now runs `stripConnectionSecrets` like the single-connection read.



- **The legacy mutators no longer unbind every connection in the recipe.** `workato_recipe_add_step`, `workato_recipe_set_step_input` and `workato_recipe_map_datapill` rebuilt the `config` array from the providers found in the code tree, which dropped `account_id` from every entry and reset `skip_validation`. Reproduced live in the audit: one added step silently unbound both Salesforce and NetSuite. All three now run through the engine, which MERGES the pulled config and only appends entries for a provider the recipe did not already use. A new provider gets its `account_id` when `connection_id` is given, and otherwise the response says `connection_binding: missing` rather than leaving a recipe that cannot start.
- **`workato_recipe_add_step` renumbers the whole tree and can insert into a nested block.** It renumbered only the top-level block, so an insert at position 0 gave a nested step and a top-level step the same number; and any `after_step` inside a `foreach`/`if`/`try` returned "not found". Insertion now takes an `anchor` (`after` / `before` / `into` with `first` / `last`), keeps `elsif`/`else`/`catch` at the tail of their parent block and a `while_condition` first, and repairs numbering left broken by an earlier save.
- **The optimistic lock fails closed.** `workato_ui_save_recipe_code` skipped the version check whenever the status probe failed, which is exactly the case where a stale tree can overwrite a newer one; when `expected_base_version_no` was requested and the current version cannot be read, the save is refused. The engine also refuses a stale `expected_base_version_no` before applying anything, so operations are never computed against a tree the caller never saw.
- **A save that Workato reports validation errors on no longer restarts the recipe.** The payload carries `save_status: 'persisted_invalid'`, the automatic restart is skipped, and the first line says the recipe is stopped rather than reading as a clean save.
- **py_eval shadowing warnings from a whole-tree file save reach the response.** `workato-file-io.ts` computed them into `args.py_eval_warnings` and nothing ever read them; the save payload now carries `py_eval_warnings`.


## bridge 1.5.0 · shared 1.2.0 (2026-08-26)

### Added

- **`workato_apps_list`**: which apps this workspace can build a step with, and their TECHNICAL adapter names. `workato_adapter_meta` describes one connector in full but only once its name is known, and the name is exactly what cannot be guessed for a custom connector (`netsuite_rest_connector_5105163_1745592003`). Merges connections, the adapters already used by recipes here, this workspace's SDK connectors and Workato's certified catalogue into one list, tagging each app with where it came from and sorting the immediately usable ones first. The response states the limit rather than hiding it: Workato publishes no catalogue of its standard connectors — the recipe editor compiles that list into its own bundle and makes no request for it — so absence from this list is not proof an app does not exist, and the way to test a guessed name is the array form of `workato_adapter_meta`.
- **`workato_recipe_step_search`**: real steps from real recipes, as templates. Meta says what a field is called; it cannot say what a working value looks like, and that only exists in the recipes already running in the workspace. Scans the recipe list (each item already carries `trigger_application` and `action_applications`, so candidates are found without opening them), reads the matches and walks the tree at any depth, so a step nested inside an if / repeat_each / try block is found too. Zero results is reported as a normal answer with the scan size, not as an error.
- **`workato_apps_list` carries Workato's own built-in connectors**, whose display name and adapter name share almost nothing: HTTP is `rest`, Workato Event Streams is `workato_pub_sub`, Scheduler is `clock`, Python snippets is `py_eval`, Workflow apps is `workato_workflow_task`. Guessing from the display name returns an empty meta document, indistinguishable from "no such app": `workato_event_streams` and `event_streams` both resolve to nothing. Only the list of NAMES is fixed in the tool; title, aliases, categories and connection_required are read live from `/integrations/meta` on every call, so a rename shows up immediately and no stale copy is shipped. Verified live: "event stream", "pub/sub", "HTTP", "scheduler", "python", "approval", "lookup table" and "csv" each resolve to exactly one right adapter.
- **`workato_pick_list`**: resolve a DYNAMIC pick list against a real connection. `workato_adapter_meta` returns a static select's values inline, but when a field's `pick_list` is a string the values are not in the meta document at all: they are the customer's own Salesforce objects, NetSuite record types, Slack channels, fetched per connection. This was the last thing standing between "the agent knows the field" and "the agent can fill the field". Found by capturing the editor: `POST /connections/<id>/pick_list.json`, whose body is the field definition itself. Verified live: salesforce `all_sobjects` answers with 2567 pairs, and the parameterised `sobject_field_values_list` answers Hot/Warm/Cold for Account.Rating. Two traps carried into the tool: the response is label-FIRST like every other Workato list, and a parameterised list needs its params EVALUATED, because the field shows them as formulas (the value appears wrapped in quotes) and the quoted form fails with `bad URI (is not URI?)`. Quotes copied by mistake are stripped and reported.
- **No connection is a stop-and-ask, not a workaround.** These tools deliberately cannot create a connection: it means handing over the customer's credentials. `workato_apps_list` and the skill now say to raise it before writing the step, because a step needs its provider's `account_id` in the recipe `config` and that id does not exist until the connection does. An app with no `connection` source, or one whose `authorization_status` is not `success` (`connection_lost` reads as working right up until the recipe runs), is a blocker; a `builtin` with `connection_required: false` is not.
- `dynamicPickListSelection` is documented in `code-tree.md`: a field fed by a dynamic pick list is written twice, in `input` and in `dynamicPickListSelection` under the same name. Writing only `input` saves cleanly and leaves the editor showing an empty picker.
- `skills/workato-recipes/discovering-connectors.md`: the ladder from "the recipe should send an email" to a step that works, with no example to copy — finding the adapter name, listing operations, reading an operation's real field surface, and what `connection_required` means for the recipe `config`.

### Fixed

- **`workato_adapter_meta` no longer drops the parts of a field that decide whether the step works.** The slim view kept `control_type: "select"` but threw away the values behind it. Workato stores pick lists label-first, so `email_type` accepts `"html"` and not the `"HTML"` the UI shows — and takes the wrong string silently. Fields now carry `options` (value and label), `default`, `properties` for the item fields of an object or array, and `toggle_field` for the alternative form of a field that accepts either shape. `field_grep` searches nested names too. Found by taking a connector this workspace had never used and checking what an agent would actually have written.
- `workato_adapter_meta` returns the adapter's own `title`, `aliases` and `categories`, which is what confirms a guessed name landed on the right app, and `connection_required` — false means the connector needs no connection at all and its `config` entry carries no `account_id`. Verified against a live recipe whose config holds `email` without one beside `salesforce` with one.

### Fixed

- **`out_file` wrote a truncated document and reported it as whole.** On `workato_api_request` the native-server asked for the body with `max_bytes: 200_000`, which is exactly where the extension clamps, so a larger response reached disk cut short under a `bytes_written` count that read as complete. `workato_adapter_meta(out_file)` was worse: raw mode caps at 20k chars and its own note tells the caller to use `out_file`, which then wrote the same 20k. Both now signal "no cap" explicitly, and the writer adds an INCOMPLETE warning if a truncated body ever reaches it anyway. Found while pulling a 681 KB recipe.

### Changed

- `workato_recipe_step_search` requires a step `keyword` and skips `keyword: "application"`, because a recipe's `config` entries carry `provider` too and are connection bindings, not steps. Disabled steps come back with `skip: true` rather than being passed off as live examples.
- `stripConnectionSecrets` takes an opt-in key allowlist. A connection's `url` can embed credentials, which is why it is denied by default; a recipe step's `url` is the endpoint being called and the most useful line of an HTTP example. Step search opts `url` / `uri` / `path` / `endpoint` back in and redacts any credentials left in the userinfo part.
- `skills/workato-recipes/code-tree.md` states the general rule for `account_id` in `config` (`connection_required` on the adapter) instead of a fixed list of system providers, which had omitted `email`.

## bridge 1.4.2 · shared 1.1.2 (2026-08-26)

### Changed

- **The merged-row check is a warning, not a refusal.** Smoke-testing 1.4.1 against a live page disproved the assumption behind it: two full-width text widgets moved onto one row do not overlap. The renderer stacks them (`top: 0px` then `top: 32px`), the container keeps its height, and the container after it keeps its own `top`. Refusing that save blocked a layout that works, so the check now warns that an overflowing row will stack rather than sit side by side, and lets the save through. The refusal that stays is the row COLLAPSE, which is the shape that actually broke a live form.

## bridge 1.4.1 · shared 1.1.1 (2026-08-26)

### Fixed

- **`workato_lcap_page_save` no longer refuses ordinary side-by-side layout.** The row-merge guard judged the fact that widgets moved onto one row, so it blocked a normal edit: the live forms carry three 4-wide fields in a row. It now judges the merged row's width and refuses only when the widths sum past the 12 column grid, which is when the widgets actually overlap and the layout's height collapses. The message names the column count. Found by smoke-testing the family against a live page, where the guard rejected a page that rendered correctly.
- **The row-collapse guard had stopped firing.** Widening the internal placement map from a row number to `{row, width}` left the collapse check comparing objects, so `Math.max` produced `NaN` and the deleted-divider regression passed silently. A broken guard looks exactly like a working one until something real breaks; the existing regression test caught it.

## bridge 1.4.0 · shared 1.1.0 (2026-08-26)

### Added

- **Workflow App (LCAP) page tools.** `workato_lcap_apps_list`, `workato_lcap_page_get` (widget index by default, `view:"full"` or `out_file` for the whole tree), `workato_lcap_page_save`, `workato_lcap_page_validate`, `workato_lcap_widget_patch`, `workato_lcap_page_create`, `workato_lcap_page_delete`. A page is a JSON tree with no partial update, and every failure mode in it is silent, so the save path carries the guards: it refuses while the page's builder is open (the builder's own Save overwrites an API write), refuses a widget id disappearing, refuses a layout whose row extent collapses (the failure that leaves later containers with no computed `top`, stacked at 0, with valid JSON and no error anywhere), refuses an unparseable `_dp` payload, validates `visible` expressions against the opcode table and per-opcode arity, and probes the rendered page afterwards. `workato_lcap_widget_patch` is the safe subset: presentation props only, with `id`, `handlers`, `appFunctionOptions`, `visible` and `layout` refused.
- `workato_api_request`: raw authenticated call against the Workato app host under the user's session, for endpoints no dedicated tool covers yet. Same-origin paths only, CSRF attached automatically and never echoed back, `allow_writes` required for anything other than GET or HEAD, large responses to `out_file`.
- `workato_adapter_meta`: read an adapter's real trigger and action definitions from `/integrations/meta`. Returns an operation index by default; field lists arrive with `operation` or `field_grep`. This is the authority on field names, and it replaces guess-save-pull-check cycles.
- `workato_recipe_save_with_dependents`: stop the dependent recipes, save the callee, restore each dependent to the state it was in. Refuses to run blind: Workato exposes only a dependent _count_, and only as a stop-time error, so the call needs `dependent_recipe_ids` or `scan_folder_id` rather than reporting "could not look" as "there are none".
- `workato_callable_schema_set` and `workato_caller_bind`: write the four coupled artefacts of a callable recipe in one call, and bind a caller to it. The schema setter migrates values found flat on `return_result.input` under the `result` wrapper, which is the shape that produces a silent `result: null` in every caller.
- `workato_datapill`: build a datapill reference in any of the three dialects (recipe step, page widget, page variable), interpolated or formula mode, compact by construction.
- `workato_lookup_table_row_upsert`: update by key column or create, refusing on multiple matches instead of picking one.
- `skills/workato-recipes/workflow-apps.md`: the Workflow App page format, confirmed against a live page rather than inferred, including the full conditional-`visible` opcode table, the handler shapes, and the app-function trigger markers.

### Changed

- `run_suiteql` and `run_query` are read-only in `workato_call_action`, so a schema probe no longer needs `allow_writes: true`.
- A save now refuses a `_dp('...')` payload that is not parseable JSON. Compaction already fixed the spacing case; a corrupt payload used to pass through and resolve to nothing.
- py_eval code is compiled and linted before it is pushed, on both `workato_recipe_set_py_eval_code` and full-tree saves. Without python on PATH the response says the syntax was not verified rather than implying a pass. Names that shadow a declared `code_input` key are warned about.
- `Tab not found` now names the Chrome profile as a likely cause, and a Workato 404 says it can mean the wrong workspace or environment for that tab rather than a missing object.
- `workato_job_trace`'s description states that the untruncated read is `detail:"full"` together with `lines:[N]`, and that there is no `step` parameter.

### Fixed

- `workato_adapter_meta`'s `out_file` was declared in the schema but not implemented on the bridge side, so it silently did nothing.

## bridge 1.3.12 (2026-08-18)

### Added

- **Bridge self-update.** The running bridge polls the npm registry every 4 hours (same-major versions only) and flags newer releases; the `run_host` wrappers apply the pending install via `apply-update.cjs` before the next host launch, when nothing locks the package directory. Once an update is pending and the MCP surface has been idle for 10 minutes, the host restarts itself so the extension's reconnect respawns it on the new version, with no user action. Failed installs back off and give up after 3 attempts (see `update.log` in the bridge state directory); a running host never blocks on the updater.

## bridge 1.3.11 · shared 1.0.10 (2026-08-18)

### Added

- `workato_copy_recipe`: clone a recipe into any folder (`POST /recipes/<id>/copy.json`); returns the new recipe id. A timed-out copy is verified against the destination folder's recipe list instead of being retried blind.
- `workato_delete_recipe`: permanently delete a recipe (`DELETE /recipes/<id>.json`). Pre-reads the recipe, fails fast when it does not exist, and refuses a running recipe until it is stopped; a timed-out delete is verified via the recipe 404ing.

## bridge 1.3.10 · shared 1.0.9 — 2026-08-05

### Fixed

- **Silent input strip is no longer silent.** Every `workato_ui_save_recipe_code` save (and so every `workato_recipe_*` mutator) reads the tree back and compares it with what was sent. When Workato accepts a save but drops dynamic input keys the step has no `extended_input_schema` for — `py_eval` `code_input.data`, `call_recipe` `parameters`, `update_object` custom fields, data-table columns, `declare_variable` `variables` — the tool now fails with `save_status: "persisted_incomplete"` and names the dropped paths instead of reporting a clean save of empty data. `verify_readback: false` opts out.
- **Datapills survive `json.dumps` spacing.** Workato matches `#{_dp('<json>')}` byte-for-byte, so a pill payload with spaces after `:` / `,` saved fine and then resolved to nothing. Pill payloads are now re-serialized compactly before the save; the response reports `datapills_normalized`.
- **A recipe that was already stopped no longer stays down quietly.** `restart_if_running` only ever restored what the save itself stopped. The response now carries `was_running` and says out loud when the recipe is left stopped; the new `ensure_running` flag starts it regardless of the state it was in.
- **`chrome_javascript` no longer reports finished work as a failure.** The default timeout went from 15 s to 60 s (the 16 s ceiling cut off page scripts whose fetches then landed anyway), and a timeout response now warns that the script was not cancelled and that a blind retry can execute it twice.
- **Retrying a save whose response timed out no longer duplicates versions.** A version-drift check now compares the stored tree with the one being written and returns `save_status: "already_applied"` when the earlier attempt had in fact landed, instead of a false `expected_base_version_no` conflict.
- **The `workato_recipe_*` mutators no longer swallow the save's own report.** Their summary now carries `save_status`, `was_running`, `restarted` / `restart_error`, `verification_error`, `value_mismatches`, and `datapills_normalized`, and calls out a recipe left stopped, a failed restart, or an unverified readback on the first line — previously all of it was flattened into a clean-looking "updated recipe N". They also accept `verify_readback`, so a mutator caller has the same opt-out the save tool gives.
- **A save that landed without a readable `version_no` says "version unknown"** instead of printing the literal word `undefined`. The payload carries `version_no_unknown: true`, and the timeout path re-probes the status once before giving up on the number. That path also reuses the readback it already fetched rather than requesting the same tree twice.

### Other

- Documentation overhaul: rewritten README, full tool reference, architecture and troubleshooting guides, security policy, contribution guide, and CI.
- Upstream leftovers removed from the tree (parent-project READMEs, translated docs, prebuilt release archive, scratch files). Attribution retained via `LICENSE.upstream`.

## bridge 1.3.9 · shared 1.0.8 — 2026-07-23

### Added

- `workato_repeat_job` — re-run one or more jobs by master job id.

## bridge 1.3.8 · shared 1.0.7 — 2026-07-15

### Added

- Project and folder management: `workato_list_folders`, `workato_create_folder`, `workato_update_folder`, `workato_delete_folder`, `workato_move_recipe`, `workato_create_project`, `workato_update_project`.

### Changed

- The extension now builds to `dist/` instead of WXT's default `.output/`, so "Load unpacked" works without hunting for a hidden folder on macOS.

## bridge 1.3.7 · shared 1.0.6 — 2026-07-14

### Added

- `workato_recipe_status` — cheap live-state read for post-write verification.
- `workato_recipe_version_diff` — changed steps only, between any two saved versions.
- `workato_ui_save_recipe_code` gained `restart_if_running` (atomic stop → save → verify → restart), `comment`, and `expected_base_version_no` (optimistic locking).
- `workato_job_trace` gained `lines`, `line_range`, and `detail: "full"` for exact per-step payloads.
- `workato_search_connections` gained a `provider` filter.
- `get_windows_and_tabs` gained a `filter` substring parameter.
- Configurable `timeout_ms` on `pull_recipe`, `list_jobs`, `job_trace`, and `version_diff`.

### Changed

- Unified tab resolution across every Workato tool family: explicit `tabId` → pinned session tab → Workato tab in window → any Workato app tab. Never the focused tab.
- Reads auto-retry once on a 30 s timeout and report `retried: true`; long calls are excluded so the bridge's 120 s ceiling isn't blown.
- `workato_list_jobs` returns partial results with `partial: true`, `scanned_through`, and `next_cursor` instead of dying mid-pagination.
- Nested step editing: `set_step_input` and `map_datapill` accept `as` anchors and dotted paths, search nested blocks recursively, and support current-item pills.
- `workato_job_trace` strips `output_schema` / `extended_*_schema` noise from summaries.

### Fixed

- Writes that time out are now verified by re-reading state (`save_status: "succeeded_after_timeout"`) instead of being reported as failures or blindly retried.

## bridge 1.3.6 · shared 1.0.5 — 2026-06-11

### Added

- `workato_set_version_comment` — annotate a specific recipe version.

## bridge 1.3.5 — 2026-06-05

### Added

- Recipe control tools: `workato_rename_recipe`, `workato_start_recipe`, `workato_stop_recipe`.

## bridge 1.3.4 · shared 1.0.3 — 2026-06-04

### Fixed

- Workato calls are pinned to the selected tab, ending the focus-drift bug where a call could land in an unrelated page.

## bridge 1.3.3 — 2026-05-29

### Fixed

- Shell scripts are forced to LF line endings so the bridge runs on macOS and Linux after an npm install from a Windows-authored publish.

## bridge 1.3.2 · shared 1.0.2 — 2026-05-26

### Changed

- `workato_run_query` timeout raised to 90 s with proper abort handling and a configurable `timeout_ms`.

## bridge 1.3.1 — 2026-05-23

### Added

- WebSocket-based Chrome profile aggregation with dynamic context switching (`workato_list_profiles`, `workato_switch_profile`).
- Theme-adaptive extension popup.

### Fixed

- Fastify SSE and streamable-HTTP `/mcp` routes hung without `reply.hijack`.
- Multi-profile bridge stability.

## Workato tool families — 2026-05-11 → 2026-05-21

The initial fork work, before npm publishing began.

### Added

- **Recipes and jobs** — `workato_pull_recipe`, `workato_job_trace`.
- **Discovery** — `workato_search_recipes`, `workato_search_connections`, `workato_get_connection` (secrets stripped on every path), `workato_list_jobs`.
- **Connector execution** — `workato_run_query` (SOQL / SuiteQL / SQL through any connection) and `workato_call_action`, the universal action runner behind a write-safety gate that refuses non-read-shaped actions unless `allow_writes: true`.
- **Recipe editor automation** — the 11-tool `workato_ui_*` family, including `workato_ui_create_recipe` and `workato_ui_save_recipe_code`.
- **Code-side mutators** — `workato_recipe_add_step`, `set_step_input`, `map_datapill`, then the universal set: `set_input_path`, `delete_input_path`, `set_py_eval_code`, `set_extended_schema`.
- **Lookup tables** — 11-tool CRUD family including `workato_lookup_table_import_csv` with `csv_path` streaming through the bridge.
- **Data tables** — 12-tool CRUD family for the newer relational data tables.
- **Session** — `workato_whoami`.
- **File round-trip** — `out_file` / `code_path` so large recipes never enter the model's context.
- **`workato_pull_recipe` views** — `compact`, `outline`, `step`, and `full`, with datapill shortening and field queries.
- **`workato-recipes` skill** — recipe code-tree schemas and the complete Workato formula reference, published through this repo's Claude Code marketplace manifest.

### Fixed

- CSRF token is read from the `XSRF-TOKEN-V2` cookie, since editor pages carry no meta tag.
- Non-app Workato subdomains are ignored when resolving the session tab.

## Fork point — 2026-05-11

Forked from [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome) at its MIT-licensed state, keeping the extension shell, native-messaging bridge, MCP transports, and browser-automation tools. See [LICENSE.upstream](LICENSE.upstream).
