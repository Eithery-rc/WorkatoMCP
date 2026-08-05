# Changelog

All notable changes to WorkatoMCP. Versions refer to the published npm packages — `workatomcp-bridge` (the local bridge) and `workatomcp-shared` (tool schemas). The Chrome extension is built from source and versioned alongside them.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions. Dates are the commit dates of the corresponding release.

## Unreleased

### Fixed

- **Silent input strip is no longer silent.** Every `workato_ui_save_recipe_code` save (and so every `workato_recipe_*` mutator) reads the tree back and compares it with what was sent. When Workato accepts a save but drops dynamic input keys the step has no `extended_input_schema` for — `py_eval` `code_input.data`, `call_recipe` `parameters`, `update_object` custom fields, data-table columns, `declare_variable` `variables` — the tool now fails with `save_status: "persisted_incomplete"` and names the dropped paths instead of reporting a clean save of empty data. `verify_readback: false` opts out.
- **Datapills survive `json.dumps` spacing.** Workato matches `#{_dp('<json>')}` byte-for-byte, so a pill payload with spaces after `:` / `,` saved fine and then resolved to nothing. Pill payloads are now re-serialized compactly before the save; the response reports `datapills_normalized`.
- **A recipe that was already stopped no longer stays down quietly.** `restart_if_running` only ever restored what the save itself stopped. The response now carries `was_running` and says out loud when the recipe is left stopped; the new `ensure_running` flag starts it regardless of the state it was in.
- **`chrome_javascript` no longer reports finished work as a failure.** The default timeout went from 15 s to 60 s (the 16 s ceiling cut off page scripts whose fetches then landed anyway), and a timeout response now warns that the script was not cancelled and that a blind retry can execute it twice.
- **Retrying a save whose response timed out no longer duplicates versions.** A version-drift check now compares the stored tree with the one being written and returns `save_status: "already_applied"` when the earlier attempt had in fact landed, instead of a false `expected_base_version_no` conflict.

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
