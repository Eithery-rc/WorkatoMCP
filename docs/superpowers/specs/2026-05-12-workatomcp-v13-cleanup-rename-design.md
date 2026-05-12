# WorkatoMCP v1.3 — Cleanup, Rename, Branding

**Status:** Draft
**Date:** 2026-05-12
**Author:** Roman Chikalenko

## 1. Goal

Take the fork from "still looks like upstream's `mcp-chrome` with Chinese strings everywhere" to "a distinct WorkatoMCP project." Three orthogonal cleanups:

1. **Identity** — rename packages, author, manifest, action title, default locale. Replace upstream icons with a generated logo.
2. **Prune** — drop upstream UI surfaces (sidepanel agent chat, web editor, builder, quick-panel overlay) and the inert vector-search tool. Drop the heavy deps those drag in.
3. **Strip Chinese** — translate or delete ~1078 Chinese-character occurrences across ~50 source files. Drop 5 non-English locale bundles.

**Non-goal:** new tools, new features, behavior changes. This release is pure hygiene.

**Constraint stated by user:** keep all `chrome_*` MCP tools so the agent can navigate / screenshot / inspect when assisting on Workato workflows. Only the inert `chrome_vector_search` is dropped (it's commented out at the MCP surface and brings in ~200MB of model weights on first use).

## 2. Naming map

### Package renames

| Old                          | New                    | File                                |
| ---------------------------- | ---------------------- | ----------------------------------- |
| `mcp-chrome-bridge-monorepo` | `workatomcp`           | root `package.json`                 |
| `chrome-mcp-shared`          | `workatomcp-shared`    | `packages/shared/package.json`      |
| `chrome-mcp-server`          | `workatomcp-extension` | `app/chrome-extension/package.json` |
| `mcp-chrome-bridge`          | `workatomcp-bridge`    | `app/native-server/package.json`    |

(`@chrome-mcp/wasm-simd` is intentionally omitted — that whole package is deleted in §3.3, so renaming it would be wasted work.)

All cross-package `workspace:*` imports + `pnpm --filter <name>` script targets in root `package.json` must update to match.

### Bridge CLI bin names

The native-server exposes three bins. Strategy:

- **Add** new bins: `workatomcp-bridge`, `workatomcp-stdio`
- **Keep** old bins (`mcp-chrome-bridge`, `chrome-mcp-bridge`, `mcp-chrome-stdio`) as aliases — `~/.claude.json` may reference them and we don't want to silently break the MCP client connection. Mark as deprecated in JSDoc; remove in a future release after a migration window.

### Author

Replace `"author": "hangye"` → `"author": "Roman Chikalenko <chikalenkor@gmail.com>"` in 5 places:

- `package.json` (root)
- `packages/shared/package.json`
- `app/chrome-extension/package.json`
- `app/native-server/package.json`

(`packages/wasm-simd/` is being deleted in §3.3; no need to touch its `Cargo.toml`.)

### Manifest

- `action.default_title`: `"Chrome MCP Server"` → `"WorkatoMCP"`
- `default_locale`: `'zh_CN'` → `'en'`
- `_locales/en/messages.json`:
  - `extensionName.message`: `"WorkatoMCP"` (was upstream value)
  - `extensionDescription.message`: `"A Chrome extension that exposes the user's Workato session as MCP tools for AI agents."` (was upstream description)

### Native messaging host id — keep unchanged

`com.chromemcp.nativehost` stays as-is. The host id is invisible to the user, renaming it forces re-registration on every dev machine and on the user's installed setup, and would orphan the existing manifest in `%APPDATA%\Google\Chrome\NativeMessagingHosts\`. Not worth the churn.

### GitHub repo

`github.com/Eithery-rc/WorkatoMCP` — already correct.

## 3. Prune scope

### 3.1 Entrypoints to delete

```
app/chrome-extension/entrypoints/sidepanel/                  # in-Chrome AI chat panel
app/chrome-extension/entrypoints/web-editor-v2/              # visual page editor
app/chrome-extension/entrypoints/web-editor-v2.ts            # editor bootstrap
app/chrome-extension/entrypoints/builder/                    # builder UI
app/chrome-extension/entrypoints/quick-panel.content.ts      # AI chat overlay content script
```

### 3.2 Shared modules used only by deleted entrypoints

To be confirmed by grep before deletion (only delete if no remaining importers):

```
app/chrome-extension/shared/quick-panel/        # almost certainly only used by quick-panel
app/chrome-extension/shared/agent-chat/         # if present, sidepanel-only
```

### 3.3 Dead tool to remove

`chrome_vector_search` — exists in code, but commented out at the MCP surface (`packages/shared/src/tools.ts` lines 768–770). Already invisible to MCP clients.

Files to delete:

```
app/chrome-extension/entrypoints/background/tools/browser/vector-search.ts
app/chrome-extension/utils/vector-database.ts
app/chrome-extension/utils/semantic-similarity-engine.ts
app/chrome-extension/utils/content-indexer.ts
app/chrome-extension/workers/simd_math.js
app/chrome-extension/workers/simd_math_bg.wasm
packages/wasm-simd/                              # WASM crate for vector ops
```

Also:

- Remove `SEARCH_TABS_CONTENT` from `TOOL_NAMES.BROWSER` in `packages/shared/src/tools.ts`
- Remove the commented-out `SEARCH_TABS_CONTENT` schema block (lines ~768–770)
- Remove the `copy:wasm` script + `build:wasm` from root `package.json`
- Remove `@workatomcp/wasm-simd` from the `pnpm -r --filter='!@workatomcp/wasm-simd' build` glob (will simply collapse to `pnpm -r build`)

### 3.4 Dependencies to remove from `app/chrome-extension/package.json`

```
@anthropic-ai/claude-agent-sdk        # sidepanel agent chat
@vue-flow/background                   # web-editor-v2
@vue-flow/controls                     # web-editor-v2
@vue-flow/core                         # web-editor-v2
@vue-flow/minimap                      # web-editor-v2
@xenova/transformers                   # vector-search (~200MB model on first use)
hnswlib-wasm-static                    # vector-search
markstream-vue                         # sidepanel agent chat
elkjs                                  # web-editor graph layout
```

`date-fns` — verify usage before removing. If only used by sidepanel, remove. If used by popup/scheduling, keep.

`gifenc` — KEEP. Used by `chrome_gif_recorder` tool which is a kept `chrome_*` surface.

### 3.5 Locales

Delete `_locales/zh_CN/`, `_locales/zh_TW/`, `_locales/ja/`, `_locales/ko/`, `_locales/de/`. Keep only `_locales/en/messages.json` with updated content.

### 3.6 Tests

Delete only the tests that test deleted code. The `tests/record-replay-v3/` suite stays (record-replay is a kept feature). Any test file that imports from a deleted entrypoint is removed; any test that grep-matches `sidepanel|web-editor|quick-panel|vector-search|@xenova` and lives in the test dir is reviewed individually.

### 3.7 Things explicitly kept

- All 28 `chrome_*` browser tools (everything in `tools/browser/` except `vector-search.ts`)
- All 8 `workato_*` tools (entirely in `tools/workato/`)
- Popup, options page, welcome page
- Background script, MCP HTTP server, native messaging bridge
- Record-replay v3 (chrome-related, deeply integrated)
- Inject-scripts (used by `chrome_*` tools)
- Content scripts (`content.ts`, `element-picker.content.ts`)
- Offscreen document

## 4. Chinese-string cleanup

### Scale

~1078 character occurrences across ~50 source files (per `rg -c '\p{Han}'`). Composition:

- ~95% comments (Chinese narration of upstream's code)
- ~5% user-facing strings (locale JSONs — being deleted wholesale) and a handful of identifier/string-literal cases

### Strategy

For each comment, default to **delete** unless it encodes a non-obvious WHY (per project's CLAUDE.md and the global "default to no comments" rule). When the comment encodes a real WHY, translate to concise English. When it just narrates WHAT a well-named identifier already says, delete it.

For string literals (rare): translate to English. If the string is user-facing, also update any matching i18n keys.

### Execution

Dispatched as a single `general-purpose` subagent with a precise instruction set:

- Input: list of 50 files with Chinese content
- For each file: read it, replace each Chinese comment per the WHY-vs-WHAT rule, replace each Chinese string with English
- Report: per-file diff summary (lines changed, comments deleted vs translated)
- The subagent will run on `sonnet` since it's mechanical translation work

This keeps the main session's context clean — we'd otherwise burn ~50k tokens reading and editing all those files inline.

### Acceptance gate

After the subagent reports done: `rg -c '\p{Han}' app packages` must return 0 matches (or only matches in `_locales/en/` which is allowed to contain CJK text in _test_ data — there shouldn't be any but worth verifying).

## 5. Logo

### Generation flow

1. Invoke `media-pipeline:image-generation` skill with prompt: simple, distinctive, recognizable at 16×16, evokes "automation / bridge / data flow" without using Workato's trademark colors or logo. Neutral modern palette (dark slate + single accent). 2–3 variants at 1024×1024 PNG.
2. Save variants to `docs/logo-options/v1.png`, `v2.png`, `v3.png`. Commit.
3. User picks one. (Brief async pause for the choice.)
4. Resize chosen variant to 5 PNG sizes via Sharp or similar: 16, 32, 48, 96, 128. Overwrite `app/chrome-extension/public/icon/*.png`.
5. Delete the unused variants from `docs/logo-options/`. Keep the chosen one as `docs/logo.png` for documentation reference.

### Quality bar

The 16×16 rendering must be readable. If a generated variant doesn't survive scaling, regenerate or fall back to a simple SVG text-mark ("W" or "WM" in a rounded square).

## 6. Verification

Each milestone must pass before the next starts:

1. **After rename:** `pnpm install` succeeds with the new `workspace:*` names. `pnpm -r exec tsc --noEmit` passes.
2. **After prune:** `pnpm build` builds all 3 packages successfully. Extension bundle size drops measurably (current: 46MB). Target: <15MB.
3. **After Chinese cleanup:** `rg -c '\p{Han}' app packages | grep -v '_locales'` returns 0.
4. **After logo:** all 5 icon sizes present; manifest validates.
5. **End-to-end smoke** (manual, after all milestones):
   - Reload unpacked extension at `chrome://extensions`
   - Popup opens and shows the new icon + name
   - Bridge launches; `curl 127.0.0.1:12306/mcp` returns the MCP handshake
   - In Claude Code: `workato_pull_recipe(72652236)` returns ~350KB recipe (regression baseline from v1.0)
   - `chrome_screenshot` returns a base64 PNG (regression baseline for kept chrome\_\* tools)

Tag `v1.3.0` on master after end-to-end smoke passes.

## 7. Order of operations

The 4 work blocks are partially independent. Suggested order:

1. **Rename first** — touches every package.json + cross-references. Doing this after deletions means re-editing files that are about to be deleted anyway.
2. **Prune second** — removes the files, removes their dep references. Locks in the smaller surface.
3. **Chinese cleanup third** — operates only on files that survived the prune. Avoids translating comments in code that's about to be deleted.
4. **Logo last** — pure asset swap, independent of the above three.

Each block becomes a separate commit. Each commit must build green before the next starts.

## 8. Out of scope

- Refactoring the surviving code (e.g., simplifying tool registration, restructuring `entrypoints/background/`) — that's a separate effort if/when warranted.
- Changing any MCP tool's input/output shape — this is hygiene, not a behavior change.
- Removing record-replay-v3 — chrome-related feature, user wants kept.
- Removing the popup or welcome page — small, kept for first-install UX.
- Renaming the native messaging host id — invisible, would orphan existing registration.
- Documenting v1.3 in detail in README — readme already has a clear v1/v1.1/v1.2 history; we'll add a short v1.3 section noting "renamed and pruned" but not enumerate every removed file.

## 9. Risks & mitigations

| Risk                                                                                      | Mitigation                                                                                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Removing a "deleted" entrypoint still has live imports from a kept file → build breaks    | Build after each major deletion. Stop and investigate before continuing.                                |
| `date-fns` is used by something we keep → silent runtime error                            | grep imports before removing from `dependencies`.                                                       |
| Subagent mistranslates a Chinese comment that did encode a real WHY → loss of information | Subagent reports a delete-vs-translate count per file; spot-check 5 files where it deleted >5 comments. |
| Generated logo looks bad at 16px → unprofessional toolbar icon                            | Verify each generated variant at 16px before committing. Fall back to SVG text mark if all 3 fail.      |
| Renaming `mcp-chrome-bridge` bin breaks existing `~/.claude.json` MCP config              | Keep old bin names as aliases. Document the new name. Schedule alias removal for v2.0.                  |
