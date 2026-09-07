# Workato MCP recipe development efficiency plan — 2026-09-07

This plan combines the [live audit](../../audits/2026-09-07-recipe-authoring-audit.md) with the user-provided long-session feedback in `.tmp/feedback.txt`. It supersedes the audit's implementation ordering. The intended client is Claude with lazy MCP tool discovery; the Claude Code documentation was checked for that behavior. No runtime implementation is included in this planning change.

The objective is to shorten complete recipe development and debugging tasks: find the relevant recipe/job/field, make a valid change, test it, and restore the intended running state. Primary measures are model-visible calls and response tokens, successful task completion, and time spent recovering from tool failures.

**Evidence and what changed**

| Topic                            | Earlier audit                                                                         | Agent feedback                                                         | Conclusion                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Large recipe/step responses      | Measured a 35,516-token filtered step response                                        | Compact recipes reached 94k characters; embedded schemas/code remained | Strong overlap; bounded semantic reads are essential.                                                            |
| Repeated reads and writes        | Three mutations created three versions; every read refetched code                     | Repeated backups/current reads; request for compound operations        | Strong overlap; batch writes and versioned snapshots.                                                            |
| Schema/pill repair               | Incomplete field views and missing loop semantics                                     | Manually copied Variables schemas after silent-strip failures          | Strong overlap; deterministic schema derivation and semantic step operations.                                    |
| Connection and save correctness  | Live add-step lost bindings and broke numbering; stale file overwrote a newer version | Disconnected connector, failed restoration, unclear start failure      | Broaden the first reliability fixes to lifecycle outcomes and connection health.                                 |
| Session routing                  | Explicit profile/tab pinning worked during the audit                                  | Unexpected workspace/profile change mid-session                        | Drift itself is reported, not reproduced here; enforce a stable context tuple.                                   |
| Caller discovery                 | Scoped step search proposed                                                           | 68 calls found only 2 of 5 callers in three folders                    | Promote dedicated caller discovery to essential. Source also reveals first-page-only scanning.                   |
| Job search and retention         | Not investigated in the initial audit                                                 | Hundreds of jobs scanned; erased jobs looked empty                     | Promote targeted job search and retention visibility to essential. Exact query failure still needs reproduction. |
| Testing recipes                  | Not a focus of the initial audit                                                      | Temporary recipe plus browser Test used to inject an event             | Add a supported test/input execution path to the essential development loop.                                     |
| Screenshot encoding              | Not investigated initially                                                            | Base64 text consumed context without displaying an image               | Source confirms text serialization; small essential fix.                                                         |
| Catalog size and discoverability | Measured 117 schemas, ~38.9k reference tokens                                         | Agent missed existing surgical tools; long descriptions                | Lazy loading lowers the value of reducing tool count. Improve selection instructions instead.                    |

The feedback's approximately 255k subagent tokens and estimated half-session savings are self-reported. They are useful prioritization signals, not independently measured savings or a forecast.

**Claude lazy loading changes catalog priorities**

Current Claude Code documentation says Tool Search defers MCP definitions by default; names and server instructions are visible initially, and matching definitions are loaded on demand. The user's installed version and overrides were not inspected. The same documentation advises concise server instructions and notes a 2KB limit for tool descriptions/instructions. [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search).

Do not build a separate catalog gateway, hide broad tool families, or reduce the tool count as a prerequisite for this work. Lazy discovery already addresses most upfront schema loading. Improve tool names, search terms, short selection guidance, and the skill's task-to-tool table. Keep essential constraints in the tool schema; do not make correctness depend on opening a separate document.

The earlier 38.9k-token measurement describes the serialized catalog, not a charge applied to every Claude request. Only `workato_apps_list` exceeded 2,048 description bytes in the captured catalog; descriptions and full input schemas must not be conflated when budgeting changes.

**Delivery 1 — correct mutations, routing, and outcome reporting**

Must-have foundation. Implement as small fixes with focused regression tests before extending orchestration.

- Route `add_step`, legacy `set_step_input`, and `map_datapill` through the same guarded recipe mutation/save engine. Preserve connection config, recursively number steps, support nested insertion, normalize datapills, and verify persisted edits.
- Default file saves to the envelope's `version_no`. Include workspace/environment/origin in new snapshots; reject stale or mismatched targets. Keep an explicit override for intentional replacement.
- Pin the resolved profile/tab/workspace/environment for the session and for each multi-step operation. Do not silently fall back to a different active profile. Validate that a pinned tab still belongs to the intended environment, particularly before writes and after reconnects. Return a small actual-context object in Workato responses; avoid a full whoami payload on every call.
- Distinguish request accepted, state reached, persisted, valid, and verified. A lifecycle wait that ends with `state_flipped: false` is not a successful restart. Do not describe a `persisted_incomplete` save as "nothing changed".

Source evidence: `workato-recipe/handlers.ts`, `workato-file-io.ts`, `register-tools.ts`, `recipe-lifecycle.ts`, and `workato-save-dependents.ts`. The latter's `lifecycle` helper currently checks only `isError`, while the start tool can return `isError: false` after failing to reach running state.

Acceptance: the audit's nested add-step and stale-file reproductions pass; switching browser focus cannot retarget calls; changing the pinned tab's workspace is detected; a failed restart cannot appear as restored.

**Delivery 2 — bounded reads and search inside a recipe**

Must-have for tokens. Build reusable projection/response helpers and adopt them first in recipe reads, job lists, and job traces.

- Independent `include`, exact `paths`, `fields`, `max_items`, and an overall response budget. Every collection has a limit and continuation metadata; a query cannot remove its limit.
- Preview embedded schemas, sample documents, and long source bodies in compact views. Preserve the loop source, conditions, skip state, and other execution semantics. Exact field reads and full export remain lossless.
- Add `workato_recipe_grep(recipe_id, query, match, ...)`, or equivalent search parameters on the existing pull tool, returning step identity, matching input path, and a bounded snippet. Search the whole internal snapshot; only matches enter model context. Regex support needs bounded execution.
- Add `out_file` to read tools that can produce large results. An auto-file mode may return summary, file reference, version, size, and truncation details before the result enters the MCP response. File output complements projection/search; it should not merely move the manual Python filtering burden onto the agent.
- Add an explicit empty-value policy to trace projections. Preserve `0` and `false`; preserve the distinction between omitted, null, and empty values where it matters. Removing empty fields must not alter array indices or silently change diagnostic meaning.
- Return screenshots as MCP image content, optionally alongside a file reference. Source confirms that `storeBase64: true` currently returns the image in a JSON text block.
- Cache immutable recipe snapshots by context and version. Expose `if_version`/snapshot reuse and multi-step reads; ensure version metadata and code belong to the same snapshot. Invalidate after writes and context changes.

Acceptance: exact-field response target <1k reference tokens; a broad field search obeys a 2k-token budget with a cursor; grep finds a known field without exporting the recipe to the model; projected traces retain meaningful false/zero values; screenshot responses contain image blocks and no large base64 text blocks.

**Delivery 3 — jobs that can be found without an agent walking pages**

Must-have for debugging cost. Extend existing job tools rather than adding a parallel incompatible API.

- First reproduce `query` semantics against a retained job with a known title, error, and report value, plus erased-job examples. The current handler forwards the query directly to Workato; the feedback alone does not prove whether retention, indexing, or search semantics caused zero matches.
- Implement explicit search scope/fields and exact, substring, or supported backend matching modes. If a bridge-side scan is needed, run pagination/filtering internally with a bounded budget and resumable cursor. Report backend-search versus local-scan coverage.
- Add `started_from` and `started_to` with timezone semantics. Confirm Workato's supported request shape; otherwise filter a bounded scan locally and disclose its coverage.
- Preserve `erased` in the slim shape and report unavailable data separately from empty data. Do not claim "no matches" for an incomplete or inaccessible search.
- Stop scans at a verified retention boundary or a configured search budget. The first erased item alone is not proof that all later records are erased; behavior must follow observed API guarantees.
- Add list field projection and job-report column labels/keys so callers can request only job id, date, and a meaningful report column. Give trace reads nested path projection and bounded list previews from Delivery 2.
- Extend recipe-name search with explicit matching behavior and app/running/folder filters. The claim that `ECO` matched `REC` is unverified; inspect actual response behavior before labeling its cause.

Acceptance: a known retained report value is found; a November–December interval is expressible; erased and empty are distinguishable; searches with incomplete coverage say so; the model receives matching summaries instead of hundreds of raw jobs. Upstream requests may still be required, but the agent should not orchestrate each page.

**Delivery 4 — caller discovery shared by editing and diagnostics**

Must-have. Add `workato_recipe_callers` and reuse its result in `save_with_dependents`.

- Immediate correction: paginate the existing folder scan. It currently calls `search_recipes(..., page: 1)` exactly once.
- Support `folder_ids`, project scope, and workspace scope. Page through every selected scope and filter candidate recipes before reading their code.
- Build a version-aware index of literal `call_recipe`/`call_recipe_async` targets to caller recipe/step identities. Reuse snapshots from Delivery 2 and refresh changed recipes; account for moved/deleted recipes and permission changes.
- Include runtime `Called By` as supplementary evidence if its endpoint is confirmed. Mark it as observed execution history, not a complete static dependency graph.
- Return edge source, indexed version, scan scope, freshness, completeness, unresolved dynamic targets, and failed reads. A list of two known callers is not proof that only two exist.
- Revalidate relevant dependencies before a multi-recipe stop/save sequence. Use any Workato active-dependent count as a cross-check, not as a substitute for discovery. Handle transitive relationships and cycles explicitly.

Acceptance: a fixture with five callers across three folders, including a caller beyond page 1, is discovered correctly. Repeated calls reuse the index. Unreadable recipes or dynamic flow ids make completeness explicit. The save tool consumes the same discovery result without asking the model to enumerate callers manually.

**Delivery 5 — recoverable save/start operations and connection diagnosis**

Must-have for long sessions. Depends on truthful outcomes from Delivery 1 and caller discovery from Delivery 4; basic connection diagnosis can ship earlier.

- Add `workato_recipe_connections` or a `recipe_status` health projection for referenced connections, authorization state, and actionable errors. Never return credentials. Check health before stopping a chain that must later be restarted. A deliberately stopped recipe should remain editable even when a connection is disconnected; that health problem should block an unsupported restart, not prevent repairing code.
- Make long saves return an `operation_id` promptly. Persist a journal with context, affected recipes, initial state/version snapshots, current phase, save result, and verified restoration outcomes.
- Expose `workato_operation_status` and resume/recovery behavior. A client timeout must not erase the operation's identity or progress. Bridge restart/disconnect must yield a recoverable interrupted state rather than a fabricated success.
- Restore recipes that were previously running only when their dependencies and saved state are usable; recipes previously stopped remain stopped. If recovery cannot safely finish, list exact affected ids and reasons. Do not blindly start callers against a broken callee or roll back over another editor's changes.
- Diagnose an unsuccessful start using Workato validation/connection errors and available UI-backed metadata. Return the offending connection/step where known, or an honest diagnostic gap.
- Use idempotency to avoid duplicate saves on retries. Treat the workflow as a recoverable sequence of changes, not a transaction guaranteed by Workato.

Acceptance: inject timeouts after each stop/save/restart boundary and disconnect the client; polling/resuming reports the real state, no duplicate version is created, and failed restarts are named. A disconnected Salesforce connection is diagnosed without a manual browser hunt. If connection health changes after preflight, the failure is still reported correctly.

**Delivery 6 — batch editing and deterministic schema generation**

Must-have for authoring speed. Extend the shared engine from Delivery 1.

- Add `workato_recipe_apply(changes: [...], expected_base_version_no, dry_run)` for several input edits in one fetch/validate/save/readback cycle. Existing surgical tools remain compatibility wrappers.
- Add typed structural operations for inserting/moving/removing steps, changing loop sources, and binding existing connections. Use stable anchors/UUIDs or snapshot-bound paths for nodes without `as`.
- Derive Variables/Lists extended schemas from their explicitly declared schemas. Preserve types and optionality; do not guess schemas from current values alone. This directly addresses the manual schema-copying work in the feedback.
- Merge static adapter fields with dynamic step schemas and report completeness. Add connection-aware schema refresh and picker metadata generation only for supported, verified connector shapes.
- Validate structure, known bindings, and datapill references locally. Keep formula/runtime validation coverage explicit. A universal Workato validate-without-save endpoint is not yet established.

Acceptance: several mapping changes create one version; invalid local operations cause no write; Variables/List structured inputs survive readback without manually copying another recipe; unchanged fields and connection bindings remain intact.

**Delivery 7 — supported test execution with input**

Must-have capability for a complete development loop, with a bounded endpoint/capability investigation before implementation.

- Provide `workato_test_recipe(recipe_id, trigger_input)` for recipe/trigger types whose test APIs actually support injected input. Return a job or operation handle that can be queried through existing diagnostics. List supported modes and return an explicit unsupported result for others; do not promise arbitrary input injection for every trigger.
- Allow execution of supported connectionless built-in actions using adapter identity, with connection requirements derived from metadata. The current `call_action` requires a connection and targets `/connections/:id/test_action.json`; simply making `connection_id` optional is insufficient.
- Add `workato_publish_message(topic_id, message)` through a verified Event Streams endpoint or a thin wrapper over the connectionless execution path. Report publication success separately from downstream recipe job success.
- Treat Test and publication as execution with possible real downstream effects. Keep write gates, target context, and returned job tracking; avoid implicit temporary recipes as the normal workflow.

Acceptance: a supported test recipe receives the supplied fixture and returns a traceable job; a test topic accepts a message without creating an ad hoc recipe or requiring UI clicks; unsupported capabilities fail explicitly before creating side effects.

**Documentation and measurement accompany each delivery**

Update tool descriptions, generated references, server instructions, and the distributed skill in the same change that ships each behavior. Start with a short task-to-tool table: one-field edit -> `recipe_set_input_path`; many edits -> `recipe_apply` once shipped; find field -> recipe grep; inspect job -> projected trace; find callers -> caller discovery; long save -> operation status. Until legacy mutation paths are fixed, do not recommend their unsafe aliases merely because the feedback requests a cheat sheet.

Keep catalog splitting, automatic formula-template deduplication, and a generic execute-anything gateway out of the essential scope. Formula deduplication can obscure real differences and needs a lossless design; projection and targeted search give a clearer first benefit. Broad browser snapshot redesign is secondary to fixing screenshot transport and exposing direct diagnostics.

Replay representative tasks using the user's actual Claude setup: find a retained job by business key, find callers across folders, edit one formula, apply several mappings, save a callable through a timeout, and run a fixture. Record tool-selection success, model-visible calls, upstream calls, actual available usage metrics, separately labeled reference-token measurements, elapsed time, versions created, and manual recovery. No overall percentage savings should be promised before this replay.

The first implementation increment should combine Delivery 1's concrete correctness fixes with Delivery 2's bounded reads, `erased` visibility, and image-content fix. Next prioritize job and caller discovery, then durable lifecycle orchestration, batch authoring, and test execution. Documentation and measurement ship throughout.
