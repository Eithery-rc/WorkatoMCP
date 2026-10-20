# MokuTab: rename, and Workato as a module

**Status:** Agreed with Roman 2026-10-19; implementation starts after the prune
**Date:** 2026-10-19
**Author:** Roman Chikalenko

## 1. Goal

WorkatoMCP has outgrown its name. Of its 159 tools, 58 are generic browser tools (`chrome_*`, record-replay), and the features of the last releases (saved functions, watches, tab leases, `fetch_to_file`, async JS jobs, vault logins) have nothing to do with Workato. Colleagues use the browser half for NetSuite, Jira and client portals.

Two changes, shipped together as 2.0.0:

1. **Rename** to **MokuTab**, a product of the MokuHub family next to MokuBot.
2. **Split** the code into a core (the universal browser tool) and modules. Workato becomes the first module, enabled per MCP registration.

Non-goals:

- Renaming the `chrome_*` tools. They are named after the browser they drive, they are referenced by bare name in skills, CLAUDE.md files and memories, and renaming 58 tools buys nothing.
- One extension per module. MV3 forbids loading remote code, so module code is compiled into the one extension; a module is switched on in the bridge.
- Changing the native host id `com.chromemcp.nativehost` or the extension ID (pinned by the `key` in `wxt.config.ts`). Both are invisible to users; changing them forces a reinstall everywhere.
- New tools or behaviour changes beyond what the split and the migration need.

## 2. Naming map

| What                                     | Now                                                                     | 2.0.0                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Product, handshake `SERVER_NAME`         | WorkatoMCP                                                              | MokuTab                                                                                        |
| Root package                             | `workatomcp`                                                            | `mokutab`                                                                                      |
| Shared package                           | `workatomcp-shared`                                                     | `@mokuhub/mokutab-shared`                                                                      |
| Bridge package                           | `workatomcp-bridge`                                                     | `@mokuhub/mokutab-bridge`                                                                      |
| Extension package                        | `workatomcp-extension`                                                  | `mokutab-extension`                                                                            |
| Bridge bins                              | `workatomcp-bridge`, `workatomcp-stdio` (+ 3 upstream aliases)          | `mokutab-bridge`, `mokutab-stdio`; the old bins stay as aliases until 3.0                      |
| MCP registration key in `~/.claude.json` | `workato`                                                               | `mokutab`, so tools read `mcp__mokutab__chrome_snapshot`                                       |
| Data dir                                 | `~/.workatomcp`                                                         | `~/.mokutab` (moved on first start, §5.2)                                                      |
| Env vars                                 | `WORKATOMCP_FN_DIR`, `WORKATOMCP_OPERATIONS_DIR`                        | `MOKUTAB_*`; the old names are still read                                                      |
| Temp and log dirs                        | `workatomcp-results`, `workatomcp-operations`, `workatomcp-bridge/logs` | `mokutab-*`                                                                                    |
| Function registry git identity           | `workatomcp`                                                            | `mokutab`, and `workatomcp` still counts as a machine author (§5.2)                            |
| Extension name, popup, welcome page      | WorkatoMCP                                                              | MokuTab                                                                                        |
| Release asset                            | `workatomcp-extension-X.zip`                                            | `mokutab-extension-X.zip`                                                                      |
| GitHub repo                              | `Eithery-rc/WorkatoMCP`                                                 | transferred to the `MokuTeam` organization as `MokuTeam/MokuTab`; GitHub redirects the old URL |
| Native host id, extension ID             | unchanged                                                               | unchanged                                                                                      |

Four core tools carry the `workato_` prefix only for historical reasons. They move to core under browser names, and the old names keep working as aliases in the Workato module until 3.0:

| Old                        | New                       |
| -------------------------- | ------------------------- |
| `workato_list_profiles`    | `chrome_list_profiles`    |
| `workato_switch_profile`   | `chrome_switch_profile`   |
| `workato_bridge_info`      | `chrome_bridge_info`      |
| `workato_reload_extension` | `chrome_reload_extension` |

Bridge files named `workato-*` that are really core are renamed with them: `workato-auto-file.ts` becomes `auto-file.ts`, `workato-bridge-info.ts` becomes `bridge-info.ts`, `workato-reload-extension.ts` becomes `reload-extension.ts`.

## 3. Core and modules

### 3.1 What stays in core

- All `chrome_*` and `record_replay_*` tools, dynamic `flow.*` tools.
- Saved functions (`chrome_fn_*`), the registry, the run log, the vault.
- Watches, tab leases, strict mode, cancellation.
- Profile routing and the session pin of **profile + tab**.
- `out_file` and auto-file spilling, `chrome_fetch_to_file`, the output sanitizer.
- The four profile/bridge tools above, `register`, `doctor`, `report`, update checks.

### 3.2 What moves into the Workato module

Everything under `tools/workato*` in the extension, the `workato-*` orchestrators in the bridge (file IO, recipe engine and mutators, callable schema, save-with-dependents, operations journal, step schema, LCAP IO, datapill, py_eval lint, switch environment, recipe callers), the 101 Workato tool schemas, and the Workato half of the server instructions.

Three pieces of Workato logic live inside the core router today and have to become module hooks, not copies:

1. **The workspace pin.** `SessionContext` holds `host`, `workspace_id`, `workspace_name`, `environment`, probed with `workato_session_context`, re-checked when the profile registry generation changes (`ContextChanged`), and injected as `expected_context` into every `workato_*` call (`withSessionTarget`, `isSessionTargetedTool` keyed on the `workato_` prefix). Core keeps profile + tab; the module contributes the probe, the extra pinned fields, the list of targeted tools and the context-changing tools.
2. **File parameters.** `prepareWorkatoCall` / `writePulledRecipe` (recipes) and `prepareLcapCall` / `writeLcapOutFile` (LCAP) run before and after the extension call. They become the module's `prepare` hook, the same shape `chrome_fetch_to_file` already uses in core.
3. **The context block.** In the extension, `maybeAppendContextBlock` appends the Workato workspace to every `workato_*` result from `handleCallTool`. It becomes the module's `afterCall` hook in the extension.

### 3.3 Module shape

One folder per side, one registration object each. Core never imports from a module; a test enforces it, the way `tool-name-drift.test.ts` guards tool names today.

```
packages/shared/src/modules/workato/        tool names, schemas, instructions snippet
app/native-server/src/modules/workato/      bridge hooks and orchestrators
app/chrome-extension/entrypoints/background/modules/workato/   executors, afterCall, content script
```

Bridge side (sketch):

```ts
interface BridgeModule {
  id: string; // 'workato'
  tools: Tool[]; // listed only when the module is enabled
  instructions: string; // appended to the core instructions
  owns(name: string): boolean;
  /** Bridge-side tools and orchestrators; undefined = forward to the extension. */
  handle?(
    name: string,
    args: JsonObject,
    ctx: ModuleCallContext,
  ): Promise<CallToolResult> | undefined;
  /** File params in, file writes out (recipe out_file, LCAP content_path). */
  prepare?(
    name: string,
    args: JsonObject,
  ): { args: JsonObject; finish?: (r: CallToolResult) => Promise<CallToolResult> };
  /** Extra pin fields on top of profile + tab. */
  session?: {
    probe(profile: string, tabId: number, ctx: ModuleCallContext): Promise<JsonObject | null>;
    targets(name: string): boolean; // gets the pinned tab and expected_context
    isContextChanging(name: string): boolean;
  };
}
```

`ModuleCallContext` gives a module what the router gives its orchestrators today: `callExtension(name, args)` with the same pin and file resolution, the routing profile, and the session summary.

The extension side registers executors and an optional `afterCall(name, args, result)`. All modules' executors are compiled into the extension; the switch (§3.4) decides whether the bridge lists them and whether the extension runs them.

### 3.4 Turning modules on and off

A **Modules** section in the extension popup, one switch per installed module (Roman, 2026-10-19). Workato is off on a fresh install: not everyone needs it.

- **One switch per machine.** The state lives in the bridge, in `~/.mokutab/config.json` (`"modules": {"workato": true}`), not in `chrome.storage`: three Chrome profiles talk to one bridge, and a switch per profile would leave the tool list of a session depending on which profile it happens to route to. Every profile's popup reads and writes the same value over the existing extension-to-bridge connection, and shows the switch disabled when the bridge is not connected.
- **Upgrades keep what they used.** When the first 2.x start migrates `~/.workatomcp` (§5.2), the machine was running WorkatoMCP, so Workato is switched on. A fresh install starts with the core only.
- **Live sessions.** On a change the bridge sends `notifications/tools/list_changed` to every open MCP session (capability `tools.listChanged: true`). Claude Code documents support for it, but there are reports of it being ignored mid-session, so the guaranteed behaviour is: the change applies to new sessions; a live refresh is a bonus. This is checked live before release.
- **A switched-off module refuses calls** in both the bridge and the extension, with the module name and "turn it on in the MokuTab popup", never a bare "Tool not found". This covers a session that still has the old tool list.
- `tools/list` returns the core plus the enabled modules. The server instructions are the core snippet plus each enabled module's snippet, and one line naming installed modules that are off; the 2 KB budget test covers every combination.
- Module content scripts (Workato's `workato-field-outline` on `app.workato.com`) check the switch and do nothing while the module is off.

Not in 2.0: a per-registration override (`/mcp?modules=...`) so one project could see fewer modules than the machine has on. The filter is the same code, so it can be added later if a project needs it.

Rejected alternatives:

- **One endpoint per module** (`/mcp/browser`, `/mcp/workato`). The session pin and the lease table belong to one MCP session (one `createToolRouter` per transport). Two endpoints are two sessions: a lease taken through the browser server is unknown to the Workato one, and a pin set in one does not reach the other. Sharing that state across sessions would need a client identity MCP does not give us.
- **An "enable module" tool the agent calls** (like MokuBot's `netsuite_enable_toolsets`). Which tools exist would then depend on what an agent did earlier in the session. Turning a module on is the person's decision about their own machine, so the switch belongs in the person's UI.

## 4. Order of work

One release, 2.0.0, so colleagues migrate once. Separate commits, each green on CI:

0. **Prune** (branch `chore/prune-upstream`, 2026-10-19): record-replay and other dead upstream code removed first, so the split moves less code.
1. **Split, old names.** Module interface, move the Workato code behind it, hooks for the three router pieces of §3.2, the module switch (bridge config, popup section, `tools/list_changed`, refusal of switched-off modules), per-module instructions, the import-boundary test. No rename yet, so the diff of the split is reviewable on its own.
2. **Rename.** Packages, bins (old ones as aliases), server name, extension name and pages, the four core tools (old names as aliases), env vars, temp and log dirs, release workflow, CI filters.
3. **Migration.** Data dir move, registry identity, doctor checks (§5).
4. **Docs.** README, `docs/TOOLS.md` split into core and Workato, ARCHITECTURE, TROUBLESHOOTING, CHANGELOG with a migration section.
5. **Review and live check.** Sonnet review; live run in all three Chrome profiles with Workato on and off; one read function and one Workato orchestrator per profile; flip the switch with a session open and record whether Claude Code refreshes its tool list.
6. **Release**, in this order:
   1. Roman creates the `mokuhub` org on npmjs.com.
   2. History rewrite (§5.5), force-push master and tags.
   3. Rename the repo to `MokuTab` and transfer it to the `MokuTeam` organization (Roman is an admin there, so it moves at once).
   4. Push tag `v2.0.0` (the release workflow builds and attests the zip under the new repo name), publish `@mokuhub/mokutab-shared` and `@mokuhub/mokutab-bridge` (Roman's OTP), deprecate the old packages.
   5. Migrate this machine (§5.1), update references outside the repo (§5.4), tell colleagues the four install steps.

## 5. Migration

### 5.1 Install steps for each machine

1. Quit Chrome completely, every profile. The running native host locks the old package's files on Windows.
2. `npm uninstall -g workatomcp-bridge`. The 2.0 package keeps the old command names (`workatomcp-bridge`, `workatomcp-stdio`, `mcp-chrome-bridge`, `chrome-mcp-bridge`, `mcp-chrome-stdio`) as aliases until 3.0, so installing it over the old package fails with `EEXIST`. `--force` is not a workaround: a later uninstall of the old package deletes the shared command names.
3. `npm i -g @mokuhub/mokutab-bridge`. Postinstall registers the native host under the same id; the manifest now points into the new package.
4. Put the 2.0.0 extension in place (zip from the release over the folder Chrome loads it from, or the repo build). Same extension ID, so it replaces the old one in place and keeps its permissions, including the userScripts toggle.
5. Start Chrome. The first bridge start moves `~/.workatomcp` to `~/.mokutab` (§5.2); if something holds the directory open, the move is retried at the next start.
6. `claude mcp add --transport http -s user mokutab http://127.0.0.1:12306/mcp`, then `claude mcp remove workato -s user`, then restart the sessions. Workato stays on after an upgrade (§3.4); switch it in the popup if not needed. A machine that skips this step keeps working under the old key, with the old `mcp__workato__` prefix; allowlists that name `mcp__workato__*` need `mcp__mokutab__*`.
7. `mokutab-bridge doctor`.

Order changed on 2026-10-20: the first draft installed the new package before removing the old one, which fails with `EEXIST` because the two share command names, so the uninstall (with Chrome closed) now comes first.

`mokutab-bridge doctor` checks the leftovers: the old package still installed, a native host manifest that points at a missing package or into the old one, a registration that still uses the key `workato`, and a data dir that has not moved.

### 5.2 Data

- First start: if `~/.mokutab` is missing and `~/.workatomcp` exists, rename the directory (same volume, atomic). If both exist, use `~/.mokutab` and say so in `doctor`. The registry is a git repo and moves as is.
- **Vault gate.** `handCommitted` treats a function file as person-committed when its last commit's author and committer are not the machine identity. If the machine identity just changed to `mokutab`, every function saved by `chrome_fn_save` under the old `workatomcp` identity would suddenly look hand-committed. Both names must count as machine authors, permanently. This needs its own test.
- `__workatomcp_fn` (the page-side result marker of the function runner) is renamed on both sides in the same release; nothing persists it.

### 5.3 npm

- Publish `@mokuhub/mokutab-shared` and `@mokuhub/mokutab-bridge` 2.0.0, both with `publishConfig.access: public`. The bin stays `mokutab-bridge`.
- `npm deprecate workatomcp-bridge "Renamed to @mokuhub/mokutab-bridge"`, the same for `workatomcp-shared`. No final 1.x release: bridge self-update has not been firing anyway, and colleagues get the four steps directly.

### 5.4 References outside the repo

Bare tool names stay valid everywhere. Only full `mcp__workato__*` names change with the registration key. A search of `C:\Work` and `~/.claude` on 2026-10-19 found:

Live, must be updated in the same step as the re-registration (back up each first):

- `C:\Work\BSD\Alafair\.claude\settings.local.json`: a permission allowlist. With the old names in it, the Alafair session starts asking for approval on every browser call.
- `C:\Work\BB\bb-monitor\bb-monitor-runbook.md` and `watch-readme.md`: the runbook a monitoring session follows.
- `C:\Work\BB\Legacy\Adpay\CLAUDE.md`
- `~/.claude/agents/centium-netsuite-login.md` (retired by `netsuite.login`; update or delete)
- `C:\Work\BSD\CLAUDE.md` mentions the tools by bare name only; check the wording that says "WorkatoMCP".

History, left as is: `bb-monitor-runbook.before-slack-switch.md`, `SiteCapture/analysis/cleanup/README.md`, `Fairchild/Cases/PHASE1_CASE_EXTRACTION.md`, memories and MemPalace entries. One new MemPalace entry records the rename.

Colleagues' machines have their own copies of such files; the release notes tell them to search for `mcp__workato__`.

### 5.5 History rewrite (author email)

Roman, 2026-10-19: Blu Banyan must not appear as an author. 235 commits (2026-05-12 to early October) carry `rchikalenko@blubanyan.com`; the repo is public, so the address is visible in `git log` to anyone. New commits already use the repo-local `chikalenkor@gmail.com`.

Done once, right before the transfer, after every 2.0.0 branch is merged:

1. Backup: `git bundle create <date>_workatomcp-pre-rewrite.bundle --all`, kept outside the repo. This is the only way back once the remote is overwritten.
2. Rewrite author and committer `rchikalenko@blubanyan.com` to `Roman Chikalenko <chikalenkor@gmail.com>` on every branch and tag (`git filter-repo --mailmap`, or `git filter-branch --env-filter` if filter-repo is not installed). Upstream commits are untouched.
3. Check: `git log --all --format='%ae %ce' | grep -c blubanyan` is 0; the tree of the new master is identical to the old one (`git diff <old> <new>` empty); tags point at the rewritten commits.
4. Force-push master and all tags. Releases are attached to tag names and stay in place.

Consequences: every hash from 2026-05-12 on changes, so hashes quoted in notes and memories go stale; anyone with a clone (v-i-tyan) re-clones; GitHub keeps the commits of closed PRs, so PR #1 still shows 2 commits with the old address until GitHub Support is asked to remove them. With gmail linked to `Eithery-rc`, GitHub then credits all of Roman's commits to the account.

## 6. Risks

- **Vault gate**: §5.2. The one change in this release that could silently weaken a security check.
- **Native host left pointing at an uninstalled package**: the extension cannot connect. Install order in §5.1 avoids it; `doctor` detects it; `mokutab-bridge register` fixes it.
- **Running sessions** keep the old key until restarted. The old `workato` registration points at the same `/mcp`, and an upgraded machine has Workato on, so nothing breaks before or after re-registering.
- **`tools/list_changed` ignored by a client**: a popup switch then takes effect in new sessions only; a switched-off module still refuses calls immediately (§3.4).
- **Name confusion on npm** with the unrelated `@moku-labs/*` family: the `@mokuhub` scope keeps the two apart.

## 7. Decisions

Roman, 2026-10-19:

- **Name:** MokuTab, a MokuHub product.
- **GitHub:** the repo moves to the `MokuTeam` organization (where MokuPilot and the other MokuHub products live) as `MokuTeam/MokuTab`. The GitHub account named `MokuHub` is someone else's personal account, not ours; a transfer sent there by mistake on 2026-10-20 was aborted. Roman is an admin of `MokuTeam`, keeps his commit history, and the old URL redirects as long as no new repo named `WorkatoMCP` is created under `Eithery-rc`.
- **Workato is opt-in, switched in the extension popup**, one switch per machine; upgrades from WorkatoMCP keep it on (§3.4).
- **npm:** `@mokuhub/mokutab-bridge` and `@mokuhub/mokutab-shared`. Nobody else can publish into the scope, other MokuHub people can get publish rights without sharing an account, and the scope is ready for the next MokuHub package. The command stays `mokutab-bridge`.
- **License:** stays MIT. `LICENSE` names MokuHub LLC as the copyright holder; `LICENSE.upstream` keeps hangye's notice, which MIT requires while their code remains (about 44% of the lines before the prune); README and `package.json` keep Roman as the author.
- **Author email:** history rewritten so Blu Banyan does not appear (§5.5).
