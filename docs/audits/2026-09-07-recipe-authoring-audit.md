# Workato MCP recipe authoring audit — 2026-09-07

The highest-value change is a shared recipe editing engine with bounded reads and batched, verified writes. The current MCP already compresses recipe JSON effectively. The remaining cost comes from oversized step inspection, repeated fetch/save cycles, and inconsistent mutation paths that can create repair work.

This is an analysis and proposed implementation order. Runtime source code was not changed.

Follow-up: the user's long-session feedback and Claude lazy-loading setup are incorporated in the [consolidated implementation plan](../design/plans/2026-09-07-recipe-development-efficiency.md). That plan supersedes the ordering below and removes catalog splitting from the essential scope. The measurements in this audit remain baseline evidence.

**Environment and method**

- Connected through the installed bridge at `http://127.0.0.1:12306/mcp`.
- `npm view workatomcp-bridge version`, the global installation, and `workatomcp-bridge doctor` all reported **1.5.0**. Doctor connectivity passed. No bridge upgrade was needed.
- Selected profile **bluBanyan**, pinned tab **404988825**, and verified **Power Factors / Development**, workspace **7633674**.
- Audited all seven existing recipes in folder **30945905**. All were stopped. Their versions were unchanged at the final check.
- Inspected repository commit `716a8c0`. Bridge/extension package manifests are 1.5.0; the root package manifest is still 1.4.2. The MCP initialization response identifies itself as `ChromeMcpServer / 1.0.0`, so that response cannot prove the running extension build matches the repository.
- Ran mutation experiments on a new copy, [recipe 82145141](https://app.workato.com/recipes/82145141), in the authorized folder. No recipe jobs, connector actions, starts, or external business-data writes were invoked.
- The test copy ended at version **10**, stopped, with **zero jobs**. Its code and connection configuration were restored and compared exactly against the pre-experiment copy.

Token measurements use `tiktoken` with **o200k_base** on normalized minified JSON. They measure payload size under that encoding, not the actual billable token usage of this conversation or every possible client/model. They exclude reasoning, prompts, tool-call arguments, and MCP framing. Full-recipe figures use the file envelope, not the slightly different inline full-view response. Timings are individual observations, not latency percentiles.

Machine-readable results: [2026-09-07-recipe-authoring-measurements.json](2026-09-07-recipe-authoring-measurements.json). Raw recipe snapshots and temporary measurement dependencies remain outside the repository at `%TEMP%\workatomcp-audit-20260907`.

**1. Existing compact reads work well; step filtering can reverse the savings**

| Recipe                                                        | Nodes including trigger | Full envelope tokens | Compact tokens | Outline tokens |
| ------------------------------------------------------------- | ----------------------: | -------------------: | -------------: | -------------: |
| 71810482 — Test for everything                                |                       6 |              150,357 |          1,489 |            391 |
| 73671550 — Copy of Opportunity Change Order to Project Budget |                       8 |                4,793 |          2,043 |            533 |
| 73022607 — Project Milestone to Project Task/Milestone        |                       8 |               22,376 |          1,951 |            467 |
| 72454389 — Test                                               |                      16 |               60,856 |          5,175 |          1,024 |
| 71911136 — OLD: Opportunity to Project                        |                       8 |              188,688 |          2,479 |            460 |
| 72449879 — OLD: Work Orders POC                               |                       8 |              122,776 |          4,119 |            506 |
| 72272208 — Milestone Test                                     |                       2 |                9,553 |            197 |            166 |

Step count is a poor predictor of response size: a six-node recipe contains roughly 150k tokens of raw JSON. Schemas dominate several of these recipes. Keep the existing file round-trip and compact view.

The strongest read-path regression was measured on step `3a2912e0` in recipe **72449879**:

| Request                              | Returned characters | Tokens | Schema fields returned | Configured mappings returned |
| ------------------------------------ | ------------------: | -----: | ---------------------: | ---------------------------: |
| Whole recipe, compact                |              14,813 |  4,119 |                      — |                            — |
| One step, no query                   |              25,331 |  6,833 |            60 of 2,414 |                           69 |
| Same step, `field_query: "external"` |              71,461 | 17,317 |                    348 |                           69 |
| Same step, `field_query: "id"`       |             143,170 | 35,516 |                    755 |                           69 |

The query removes the 60-item cap. It also filters only `fields` and `available_datapills`, while returning every configured mapping. A narrower-looking request can therefore return more than eight times the tokens of the entire compact recipe.

A logger step showed the opposite imbalance: only **187 characters** of mappings caused a **7,465-character** step response, largely from automatically attached upstream datapills.

Source: [recipe-view.ts](../../app/chrome-extension/entrypoints/background/tools/workato/recipe-view.ts), `inspectStep`, `flattenInput`, and `collectUpstreamDatapills`.

Recommended extension to `workato_pull_recipe`:

- Independent projections: `include: ["mappings"]`, `include: ["fields"]`, or `include: ["datapills"]`; do not automatically bundle all three.
- Exact `paths`, path-prefix matching, and a query that can filter configured mappings as well as field definitions.
- Separate limits/cursors and an overall response budget. Search must never implicitly disable limits. Return valid JSON with continuation metadata, rather than cutting a JSON string mid-value.
- `steps: [...]` to inspect several selected nodes against the same recipe snapshot.
- A `version_no` in every view. Current compact step responses omit it.
- Preview long SQL/Python/text values unless their exact field was requested. Mark previews explicitly and preserve a lossless retrieval path.

Initial acceptance targets: ordinary exact-field reads under **1,000 o200k_base tokens**; a broad `id` search under a configured **2,000-token** budget with a cursor. These are proposed targets, not achieved savings.

**2. Legacy mutation tools can damage otherwise valid recipe structure**

Live reproduction on the test copy:

1. Copy recipe 73671550 into the authorized folder; the new copy is version 1 with two connection bindings and sequential nested step numbers.
2. Call `workato_recipe_add_step` with `after_step: 0`, `provider: "logger"`, `action_name: "log_message"`, and a literal message.
3. The tool saves version 2 and returns `isError: false`, `ok: true`.
4. Readback shows both Salesforce and NetSuite `account_id` values removed from `config`.
5. The foreach and its nested if both have number 3. Workato returns five out-of-sequence validation errors.

The cause is direct in [workato-recipe/handlers.ts](../../app/chrome-extension/entrypoints/background/tools/workato-recipe/handlers.ts): `collectProviders` reconstructs configuration without preserving account bindings, and `renumberBlock` only numbers the top-level block. The same `collectProviders`/`putRecipe` path is also used by the older `set_step_input` and `map_datapill` handlers; those two were inspected in source but were not separately exercised live.

These handlers bypass the newer native-server mutation/save pipeline. They lack its version preflight, datapill normalization, and persisted-input verification. The advertised add-step keywords also include `repeat_each` and `return_result`, inconsistent with the recipe skill's `foreach` and action-style `return_result` shapes.

Priority: route all recipe writes through one engine. Preserve existing config entries, merge only new providers, renumber the entire tree, locate nested insertion points, and use stable node identifiers. Handle nodes without `as` using their existing UUID or a snapshot-bound path; the observed if/try nodes do not all have `as` anchors.

Return explicit `persisted`, `valid`, and `verified` outcomes. A stored recipe with Workato validation errors must not be indistinguishable from a successful usable edit. The current modern save path also formats a successful response even when `code_errors` is non-empty; inspect that shared behavior while consolidating handlers.

**3. File saves do not inherit the file's version lock**

The pull-to-file envelope contains `version_no`. `loadRecipeFile` reads it but does not use it to populate `expected_base_version_no`.

Live reproduction: the test recipe was at version **8**. Saving a file exported at version **7**, without an explicit `expected_base_version_no`, succeeded as version **9**. Its older field values replaced the newer ones.

Source: [workato-file-io.ts](../../app/native-server/src/mcp/workato-file-io.ts), `loadRecipeFile`.

Set the default expected version from the file envelope and require an explicit, clearly named override to disregard it. Include origin/workspace/environment identity in new envelopes and validate it on save. Version checks should also fail closed when the preflight cannot establish the current version.

The existing check is a preflight read followed by a PUT. It is not a demonstrated server-enforced compare-and-swap transaction; another editor can potentially save between those operations. Do not advertise strict cross-client atomicity without verifying a Workato API mechanism that guarantees it.

**4. Batch changes should share a fetch, validation pass, and save**

Three logger input changes on the test recipe:

| Method                                    |   Save versions | Observed save/mutation time | Returned text characters |
| ----------------------------------------- | --------------: | --------------------------: | -----------------------: |
| Three sequential `set_input_path` calls   | 3, versions 5–7 |               9.527 s total |                      978 |
| One full-file save carrying three changes |    1, version 8 |                     2.415 s |                      291 |

The file method additionally needed a pull and local file editing, excluded from the second timing. This experiment demonstrates the cost of repeated saves; it does not measure a batch tool that does not yet exist.

Add **`workato_recipe_apply`**, supporting a typed list of operations. Implement it first for field edits and then extend the same engine to structural edits. Existing one-field tools can remain compatibility wrappers. The existing roadmap already proposes `apply_to_steps` and recipe validation; this recommendation consolidates that direction into a shared engine and adds concrete acceptance evidence.

Proposed contract, not currently callable:

```json
{
  "recipe_id": 82145141,
  "expected_base_version_no": 4,
  "changes": [
    { "op": "set_input", "step": "a0d17001", "path": "message", "value": "first" },
    { "op": "set_input", "step": "a0d17002", "path": "message", "value": "second" },
    { "op": "set_input", "step": "a0d17003", "path": "message", "value": "third" }
  ]
}
```

One recipe load, all operations applied locally, structural/schema checks, one guarded save, one readback, and a small changed-path report. Invalid local operations should stop before the PUT. Support `dry_run` for a preview without saving and an idempotency key bound to the target, base version, and request contents. A batch means one recipe write; it does not make changes to several recipes transactional.

Later operations should include inserting/moving/removing steps, setting a loop source, binding an existing connection, and wiring an input to an upstream output. The engine should generate UUIDs, numbering, datapill JSON, and picker metadata. The model should provide the intended mapping or structural change.

**5. Compact views omit execution semantics and incomplete schema views invite guesswork**

Live recipe **73671550** contains a foreach with `source`, `repeat_mode`, and `clear_scope`. The compact view drops all three; inspecting that node also derives mappings only from `input`. An agent cannot discover the loop's source from these advertised semantic views.

The budget action `ddc516e1` has 31 configured mappings but the step view reports **zero input fields**. A live `workato_adapter_meta` call exposes its actual static operation fields, including the nested budget-line structure. Thus an empty `extended_input_schema` is not evidence that an action has no fields.

The datapill collector uses numerical order and `extended_output_schema`. It does not model branch/loop visibility, and providerless foreach nodes are excluded by its provider requirement. Treat its output as incomplete hints until this is corrected.

Recommended changes:

- Define a semantic recipe representation that explicitly retains loop source/mode, conditions, error handling, enabled/disabled state, and relevant bindings. Compact must preserve the information needed to explain execution.
- Resolve operation fields from adapter metadata plus the step's dynamic schema, with provenance and a completeness flag. Fetch only the requested operation/field slice.
- Add a typed connection-aware step builder: resolve provider/action, verify an existing usable connection, apply selector values and `dynamicPickListSelection`, derive/refresh dynamic schemas where supported, and compile the resulting step locally.
- Expose datapills by scope and source, with their actual types. Allow batch wiring by structured references without a separate string-building tool call for every field.
- Add a local `workato_recipe_validate` for structure, bindings, references, and known schema rules. Formula/runtime checks need separately reported coverage. A reliable Workato server-side validation-without-save endpoint was **not established** in this audit.

**6. Cache snapshots and resolved schemas at the server**

Every pull currently fetches recipe metadata followed by the full code tree, even for an outline or a single field. Filtering happens afterward. This reduces model context but not the repeated upstream transfer. Observed read calls were mostly around 0.8–1.5 seconds; compact and outline were in the same range.

Source: [pull-recipe.ts](../../app/chrome-extension/entrypoints/background/tools/workato/pull-recipe.ts), `pullInPage`.

Use a cache keyed by **profile + host + workspace/environment + recipe id + version**. Repeated projections can use one immutable snapshot; verify currency before committing changes and invalidate/update on successful writes and session changes. Metadata and code are currently fetched separately, so ensure that a snapshot's version and code actually belong together before caching it as authoritative.

Cache adapter metadata and connection-dependent schema results separately, including connection identity and relevant input parameters in their keys. Cache hit rates and transferred bytes should be observable. Cache savings primarily improve latency/network use; bounded projection improves model token consumption.

**7. Reduce the exposed catalog and make results predictable**

The live catalog contains **117 tools**: **85 Workato** and **32 inherited browser** tools. Normalized serialized schemas occupy approximately **38,893 o200k_base tokens**, including **9,188** for browser tools. None of the 117 tools declares an `outputSchema` or tool annotations.

This is catalog size, not a claim that every call is billed for all 38.9k tokens. Clients differ in discovery, caching, and which schemas enter model context. This audit's initial broad metadata discovery itself produced an unnecessarily large response; subsequent discovery was restricted to exact tool names.

Recommended approach:

- Provide configured tool surfaces for recipe development, data operations, browser fallback, and Workflow Apps. Start recipe sessions with the recipe surface and preserve opt-in access to the others.
- Keep one preferred tool for each job; hide legacy/UI equivalents from the default recipe surface once compatibility wrappers exist.
- Shorten tool descriptions to selection guidance, input semantics, and essential constraints. Move extended examples to discoverable resources/skill files.
- Add typed output envelopes with stable error codes and concise diagnostics: step, path, expected/actual type, persistence state, and next repair action.
- Report bridge version, extension build, schema revision, and connected workspace in a small health/capability response. The current hardcoded initialization version is not useful for checking deployment drift.

MCP supports output schemas, structured results, resource links, tool annotations, and catalog-change notifications. Use the protocol's compatibility guidance when returning structured content; structured JSON alone is not a guarantee of lower token use. [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

The installed recipe skill is also older than the repository skill: it lacks the new connector-discovery guidance. Update/distribute the skill with compatible runtime versions, and turn enforceable rules into code checks. Documentation should explain the workflow; the runtime should handle deterministic bookkeeping.

**Implementation order and acceptance checks**

| Order | Deliverable                                                                | Why now                                                        | Acceptance check                                                                                                              |
| ----- | -------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1     | Consolidate legacy mutators; inherit file version locks                    | Prevents broken recipes and repeated repair loops              | Reproduce the copy/add-step case; preserve both bindings and globally sequential numbers. A stale file is refused by default. |
| 2     | Bounded projected reads; include version and control-flow semantics        | Direct reduction in response tokens                            | Exact field <1k tokens; broad search respects its budget/cursor; foreach source is visible.                                   |
| 3     | `recipe_apply` for multiple field edits                                    | Removes repeated fetch/save/verification cycles                | Three field changes produce one version; invalid local operation produces no write; response names only changed paths.        |
| 4     | Structural operations and connection-aware step construction               | Speeds new recipe development and reduces schema/pill mistakes | Nested insertion/removal preserves references and config; picker and dynamic fields survive readback.                         |
| 5     | Snapshot/schema caching and scoped search                                  | Reduces repeated network and discovery work                    | Several reads at one version reuse a snapshot; changes/workspace switches invalidate the correct entries.                     |
| 6     | Curated catalog, output schemas, synchronized skills and version reporting | Reduces selection overhead and ambiguous recovery              | Recipe surface has measured schema size; errors are machine-readable; client can identify running builds.                     |

Extend the existing `workato_recipe_step_search` with `folder_id`/`recipe_ids`, an input/path query, explicit scan coverage, and bounded previews. It currently searches across the workspace and has no folder scope, which prevents targeting exactly the sandbox folder through that tool. This was established from the schema/source; a workspace-wide scan was unnecessary for this audit.

Keep a small benchmark suite for exact-field read, broad field search, multi-field edit, nested insertion, stale-file conflict, and creating a step with a dynamic schema. Record input/output tokens under a named tokenizer, model-visible call count, upstream request count, latency, versions created, validation outcome, and recovery attempts. Measure complete authoring tasks before claiming an end-to-end percentage improvement.

The first implementation slice should be the legacy mutation fix plus bounded step reads. Both have concrete reproductions from this workspace and require no speculative Workato endpoint.
