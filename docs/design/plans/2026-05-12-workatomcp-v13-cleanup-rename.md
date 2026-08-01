# WorkatoMCP v1.3 — Cleanup, Rename, Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take WorkatoMCP from "looks like upstream mcp-chrome with Chinese strings" to "a distinct, focused WorkatoMCP project." Rename packages, drop upstream UI surfaces (sidepanel chat, web editor, builder, quick panel), drop the inert vector-search tool and its 200MB+ deps, translate or remove ~1078 Chinese-character occurrences, replace upstream icons.

**Architecture:** Four sequential work blocks — rename → prune → Chinese cleanup → logo. Each block becomes its own commit. Each commit must build green and pass tsc/vitest before the next starts. All `chrome_*` MCP tools and `workato_*` tools are kept; only the inert `chrome_vector_search` is removed.

**Tech Stack:** pnpm workspaces, TypeScript, WXT (Chrome MV3), Vite, Vitest, Vue 3 (popup/options/welcome), tsup (shared package), Node native messaging host.

**Reference spec:** `docs/superpowers/specs/2026-05-12-workatomcp-v13-cleanup-rename-design.md`

---

## Block A — Rename packages and manifest

Order matters within this block: shared first (everyone depends on it), then extension, then native-server, then root. After each rename, `pnpm install` must succeed before the next.

### Task A1: Verify clean baseline

**Files:** none (read-only checks)

- [ ] **Step 1: Confirm working tree is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean` (the only uncommitted file should be `pnpm-lock.yaml` if present — that's tolerable).

- [ ] **Step 2: Confirm full build passes today**

Run: `pnpm -r exec tsc --noEmit && pnpm build`
Expected: All packages compile and build successfully. If anything fails here, fix or revert before starting the rename.

- [ ] **Step 3: Record current extension bundle size for later comparison**

Run: `du -sh app/chrome-extension/.output/chrome-mv3`
Expected: A size around 46M. Save this number in your head — Block B's verification will compare against it.

### Task A2: Rename `chrome-mcp-shared` → `workatomcp-shared`

**Files:**

- Modify: `packages/shared/package.json`
- Modify: `app/chrome-extension/package.json` (dependency reference)
- Modify: `app/native-server/package.json` (dependency reference)
- Modify: `package.json` (root, the `pnpm --filter chrome-mcp-shared ...` scripts)

- [ ] **Step 1: Update the package's own name**

Edit `packages/shared/package.json`:

```json
{
  "name": "workatomcp-shared",
  ...
  "author": "Roman Chikalenko <chikalenkor@gmail.com>"
}
```

- [ ] **Step 2: Update the dependency reference in the extension**

Edit `app/chrome-extension/package.json`. Find:

```json
"chrome-mcp-shared": "workspace:*",
```

Replace with:

```json
"workatomcp-shared": "workspace:*",
```

- [ ] **Step 3: Update the dependency reference in native-server**

Edit `app/native-server/package.json`. Find:

```json
"chrome-mcp-shared": "workspace:*",
```

Replace with:

```json
"workatomcp-shared": "workspace:*",
```

- [ ] **Step 4: Update root scripts**

Edit root `package.json`. Find and replace these script lines:

```json
"build:shared": "pnpm --filter chrome-mcp-shared build",
"dev:shared": "pnpm --filter chrome-mcp-shared dev",
"dev": "pnpm --filter chrome-mcp-shared build && pnpm -r --parallel dev",
```

Replace with:

```json
"build:shared": "pnpm --filter workatomcp-shared build",
"dev:shared": "pnpm --filter workatomcp-shared dev",
"dev": "pnpm --filter workatomcp-shared build && pnpm -r --parallel dev",
```

- [ ] **Step 5: Update all source-code imports**

Search the repo for `from 'chrome-mcp-shared'` and replace with `from 'workatomcp-shared'`.

Run (PowerShell):

```powershell
Get-ChildItem -Recurse -Include *.ts,*.tsx,*.vue,*.js -Exclude node_modules,.output,dist,.wxt -Path app,packages | ForEach-Object {
  (Get-Content $_.FullName) -replace "from 'chrome-mcp-shared'", "from 'workatomcp-shared'" | Set-Content $_.FullName -NoNewline
}
```

Or run a Grep tool search for `chrome-mcp-shared` to identify each file and Edit them one by one.

- [ ] **Step 6: Reinstall and verify**

Run: `pnpm install`
Expected: Lockfile updates, no errors about missing `workspace:*` references.

Run: `pnpm -r exec tsc --noEmit`
Expected: 0 errors.

Run: `pnpm --filter workatomcp-shared build`
Expected: `dist/index.js`, `dist/index.mjs`, `dist/index.d.ts` regenerate successfully.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: rename chrome-mcp-shared to workatomcp-shared"
```

### Task A3: Rename `chrome-mcp-server` (extension) → `workatomcp-extension`

**Files:**

- Modify: `app/chrome-extension/package.json`
- Modify: `package.json` (root scripts)

- [ ] **Step 1: Update the extension's own name + description + author**

Edit `app/chrome-extension/package.json`:

```json
{
  "name": "workatomcp-extension",
  "description": "Chrome extension that exposes the user's Workato session as MCP tools for AI agents.",
  "author": "Roman Chikalenko <chikalenkor@gmail.com>",
  ...
}
```

- [ ] **Step 2: Update root scripts referencing the old name**

Edit root `package.json`:

```json
"build:extension": "pnpm --filter chrome-mcp-server build",
"dev:extension": "pnpm --filter chrome-mcp-server dev",
```

Replace with:

```json
"build:extension": "pnpm --filter workatomcp-extension build",
"dev:extension": "pnpm --filter workatomcp-extension dev",
```

- [ ] **Step 3: Reinstall and verify**

Run: `pnpm install`
Expected: Updates without errors.

Run: `pnpm --filter workatomcp-extension build`
Expected: Build succeeds, `.output/chrome-mv3/` regenerated.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename chrome-mcp-server extension to workatomcp-extension"
```

### Task A4: Rename `mcp-chrome-bridge` (native-server) → `workatomcp-bridge` + add bin aliases

**Files:**

- Modify: `app/native-server/package.json`
- Modify: `package.json` (root scripts)

- [ ] **Step 1: Update the bridge package + add new bin entries (keep old bins as aliases)**

Edit `app/native-server/package.json`. Update name, description, author, and `bin` map:

```json
{
  "name": "workatomcp-bridge",
  "version": "1.0.29",
  "description": "WorkatoMCP native messaging host (Chrome ↔ MCP bridge)",
  "author": "Roman Chikalenko <chikalenkor@gmail.com>",
  ...
  "bin": {
    "workatomcp-bridge": "./dist/cli.js",
    "workatomcp-stdio": "./dist/mcp/mcp-server-stdio.js",
    "mcp-chrome-bridge": "./dist/cli.js",
    "chrome-mcp-bridge": "./dist/cli.js",
    "mcp-chrome-stdio": "./dist/mcp/mcp-server-stdio.js"
  },
  ...
}
```

Rationale: the existing `~/.claude.json` MCP client config references `mcp-chrome-bridge` — keep it as an alias so we don't silently break the connection. Schedule alias removal for v2.0.

- [ ] **Step 2: Update root scripts**

Edit root `package.json`:

```json
"build:native": "pnpm --filter mcp-chrome-bridge build",
"dev:native": "pnpm --filter mcp-chrome-bridge dev",
```

Replace with:

```json
"build:native": "pnpm --filter workatomcp-bridge build",
"dev:native": "pnpm --filter workatomcp-bridge dev",
```

- [ ] **Step 3: Reinstall and verify**

Run: `pnpm install`
Expected: Updates without errors.

Run: `pnpm --filter workatomcp-bridge build`
Expected: `dist/cli.js`, `dist/run_host.bat` (Windows), `dist/mcp/mcp-server-stdio.js` all present.

Run: `ls app/native-server/dist/cli.js`
Expected: file exists.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename mcp-chrome-bridge to workatomcp-bridge (keep old bin names as aliases)"
```

### Task A5: Rename monorepo root + update remaining metadata

**Files:**

- Modify: `package.json` (root)

- [ ] **Step 1: Update root manifest**

Edit `package.json`:

```json
{
  "name": "workatomcp",
  "version": "1.3.0",
  "private": true,
  "author": "Roman Chikalenko <chikalenkor@gmail.com>",
  ...
}
```

(`version: 1.3.0` — anchor the upcoming release tag.)

- [ ] **Step 2: Verify**

Run: `pnpm install`
Expected: Succeeds.

Run: `pnpm -r exec tsc --noEmit`
Expected: 0 errors.

Run: `pnpm build`
Expected: All packages build green.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "refactor: rename root workspace to 'workatomcp', bump version to 1.3.0"
```

### Task A6: Update extension manifest (name, locale, action title)

**Files:**

- Modify: `app/chrome-extension/wxt.config.ts`
- Modify: `app/chrome-extension/_locales/en/messages.json`

- [ ] **Step 1: Update wxt manifest**

Edit `app/chrome-extension/wxt.config.ts`. Find:

```ts
    default_locale: 'zh_CN',
```

Replace with:

```ts
    default_locale: 'en',
```

In the same file, find:

```ts
    action: {
      default_popup: 'popup.html',
      default_title: 'Chrome MCP Server',
    },
```

Replace with:

```ts
    action: {
      default_popup: 'popup.html',
      default_title: 'WorkatoMCP',
    },
```

- [ ] **Step 2: Read the current English messages**

Read `app/chrome-extension/_locales/en/messages.json` and identify the `extensionName` and `extensionDescription` keys.

- [ ] **Step 3: Update extensionName and extensionDescription**

Edit `app/chrome-extension/_locales/en/messages.json`. Replace the values (keep the `description` field for translator notes unchanged):

```json
{
  "extensionName": {
    "message": "WorkatoMCP",
    "description": "Extension display name"
  },
  "extensionDescription": {
    "message": "Chrome extension that exposes the user's Workato session as MCP tools for AI agents.",
    "description": "Extension description shown in chrome://extensions"
  },
  ...
}
```

- [ ] **Step 4: Build and verify the manifest**

Run: `pnpm --filter workatomcp-extension build`
Expected: Build succeeds.

Run: `Get-Content app/chrome-extension/.output/chrome-mv3/manifest.json | Select-String 'default_title|default_locale'`
Expected: `default_title: WorkatoMCP` and `default_locale: en`.

- [ ] **Step 5: Commit**

```bash
git add app/chrome-extension/wxt.config.ts app/chrome-extension/_locales/en/messages.json
git commit -m "refactor: rebrand manifest (WorkatoMCP, default_locale=en)"
```

### Task A7: Block A acceptance gate

**Files:** none (verification only)

- [ ] **Step 1: Full build green**

Run: `pnpm build`
Expected: All 3 packages (workatomcp-shared, workatomcp-extension, workatomcp-bridge) build successfully.

- [ ] **Step 2: All typechecks pass**

Run: `pnpm -r exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: All tests pass**

Run: `pnpm --filter workatomcp-extension test`
Expected: All vitest tests pass.

- [ ] **Step 4: No old name remnants in workspace identifiers**

Run (Grep tool): pattern `"name": "chrome-mcp-shared"|"name": "chrome-mcp-server"|"name": "mcp-chrome-bridge"|"name": "mcp-chrome-bridge-monorepo"` in `**/package.json`
Expected: 0 matches.

Run (Grep tool): pattern `from 'chrome-mcp-shared'` in `app/**/*.{ts,tsx,vue}` and `packages/**/*.ts`
Expected: 0 matches.

If anything fails, stop and fix before Block B.

---

## Block B — Prune upstream UI surfaces and vector-search

Inside this block: delete in dependency order (leaves first, then trunks). After each major deletion, run the build to surface dangling imports immediately rather than at the end.

### Task B1: Delete chrome_vector_search and its support code

**Files:**

- Delete: `app/chrome-extension/entrypoints/background/tools/browser/vector-search.ts`
- Delete: `app/chrome-extension/utils/vector-database.ts`
- Delete: `app/chrome-extension/utils/semantic-similarity-engine.ts`
- Delete: `app/chrome-extension/utils/content-indexer.ts`
- Delete: `app/chrome-extension/workers/simd_math.js`
- Delete: `app/chrome-extension/workers/simd_math_bg.wasm`
- Delete: `packages/wasm-simd/` (entire directory)
- Modify: `packages/shared/src/tools.ts` (remove TOOL_NAMES.BROWSER.SEARCH_TABS_CONTENT and the commented-out schema)
- Modify: `app/chrome-extension/entrypoints/background/tools/browser/index.ts` (remove the export)
- Modify: `package.json` (remove `copy:wasm` script and `build:wasm` references)

- [ ] **Step 1: Find and read the browser tool barrel file**

Read `app/chrome-extension/entrypoints/background/tools/browser/index.ts` and locate the `vector-search` re-export (the line that exports `VectorSearchTabsContentTool` or similar).

- [ ] **Step 2: Remove the export**

Edit `app/chrome-extension/entrypoints/background/tools/browser/index.ts`. Delete the line that exports vector-search. Also delete any line in the same file that registers the tool with the tool registry — search for `vector-search` or `VectorSearch` or `SEARCH_TABS_CONTENT`.

- [ ] **Step 3: Remove the TOOL_NAMES entry**

Edit `packages/shared/src/tools.ts`. Find:

```ts
SEARCH_TABS_CONTENT: 'search_tabs_content',
```

Delete that line.

In the same file, locate the commented-out schema block (around lines 768-770):

```ts
// {
//   name: TOOL_NAMES.BROWSER.SEARCH_TABS_CONTENT,
//   description:
//     'search for related content from the currently open tab and return the corresponding web pages.',
//   ...
// },
```

Delete the entire commented block.

- [ ] **Step 4: Delete the implementation files**

Run:

```powershell
Remove-Item -Force app/chrome-extension/entrypoints/background/tools/browser/vector-search.ts
Remove-Item -Force app/chrome-extension/utils/vector-database.ts
Remove-Item -Force app/chrome-extension/utils/semantic-similarity-engine.ts
Remove-Item -Force app/chrome-extension/utils/content-indexer.ts
Remove-Item -Force app/chrome-extension/workers/simd_math.js
Remove-Item -Force app/chrome-extension/workers/simd_math_bg.wasm
Remove-Item -Recurse -Force packages/wasm-simd
```

- [ ] **Step 5: Remove wasm build wiring from root package.json**

Edit root `package.json`. Find:

```json
"build:wasm": "pnpm --filter @chrome-mcp/wasm-simd build && pnpm run copy:wasm",
"build": "pnpm -r --filter='!@chrome-mcp/wasm-simd' build",
"copy:wasm": "cp ./packages/wasm-simd/pkg/simd_math.js ./packages/wasm-simd/pkg/simd_math_bg.wasm ./app/chrome-extension/workers/",
```

Replace with (remove all three lines; the `build` script collapses to a simpler form):

```json
"build": "pnpm -r build",
```

- [ ] **Step 6: Rebuild shared (it's been edited)**

Run: `pnpm --filter workatomcp-shared build`
Expected: succeeds.

- [ ] **Step 7: Rebuild extension to catch any leftover imports**

Run: `pnpm --filter workatomcp-extension build`
Expected: succeeds.

If it fails with "Cannot resolve module" pointing to one of the deleted files, search the codebase for that file's path and delete the import line. Common offenders: `utils/content-indexer` referenced in tool registry, background bootstrap, or a popup component.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: drop chrome_vector_search + xenova/transformers + wasm-simd (inert, not exposed)"
```

### Task B2: Delete sidepanel entrypoint (agent chat)

**Files:**

- Delete: `app/chrome-extension/entrypoints/sidepanel/` (entire directory)
- Modify: `app/chrome-extension/wxt.config.ts` (remove `side_panel` manifest block + `sidePanel` permission)

- [ ] **Step 1: Confirm scope of the deletion**

Run (Grep tool): pattern `entrypoints/sidepanel` in `app` and `packages`
Expected: matches only inside the sidepanel folder itself, and possibly the manifest config and the browser action that opens the side panel. If matches appear in other entrypoints (popup, background), read them first to understand what they do.

- [ ] **Step 2: Delete the sidepanel directory**

Run:

```powershell
Remove-Item -Recurse -Force app/chrome-extension/entrypoints/sidepanel
```

- [ ] **Step 3: Remove sidepanel from the manifest**

Edit `app/chrome-extension/wxt.config.ts`. Find:

```ts
    side_panel: {
      default_path: 'sidepanel.html',
    },
```

Delete that block.

In the same file, find the `permissions` array and remove the `'sidePanel'` entry plus its preceding comment lines:

```ts
      // Allow programmatic control of Chrome Side Panel
      'sidePanel',
```

- [ ] **Step 4: Remove background-side openers for the side panel**

Run (Grep tool): pattern `chrome\.sidePanel|openSidePanel|side_panel` in `app/chrome-extension/entrypoints/background`
Expected: 0–3 matches.

For each match, read the surrounding function and remove the side-panel-opening code path. If a whole helper module exists solely to open the side panel, delete the module and its imports.

- [ ] **Step 5: Build to verify nothing imports the deleted dir**

Run: `pnpm --filter workatomcp-extension build`
Expected: succeeds.

Fix any "Cannot resolve module" errors by searching the importer file and removing the dead import.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove sidepanel agent-chat entrypoint (not used by MCP clients)"
```

### Task B3: Delete web-editor-v2 and builder entrypoints

**Files:**

- Delete: `app/chrome-extension/entrypoints/web-editor-v2/` (entire directory)
- Delete: `app/chrome-extension/entrypoints/web-editor-v2.ts`
- Delete: `app/chrome-extension/entrypoints/builder/` (entire directory)
- Modify: `app/chrome-extension/wxt.config.ts` (remove `toggle_web_editor` keyboard command)

- [ ] **Step 1: Delete the three directories/files**

Run:

```powershell
Remove-Item -Recurse -Force app/chrome-extension/entrypoints/web-editor-v2
Remove-Item -Force app/chrome-extension/entrypoints/web-editor-v2.ts
Remove-Item -Recurse -Force app/chrome-extension/entrypoints/builder
```

- [ ] **Step 2: Remove the web-editor keyboard command from the manifest**

Edit `app/chrome-extension/wxt.config.ts`. Find:

```ts
      toggle_web_editor: {
        suggested_key: { default: 'Ctrl+Shift+O', mac: 'Command+Shift+O' },
        description: 'Toggle Web Editor mode',
      },
```

Delete this block.

- [ ] **Step 3: Remove any background handlers for `toggle_web_editor`**

Run (Grep tool): pattern `toggle_web_editor|web-editor` in `app/chrome-extension/entrypoints/background`
Expected: 0–5 matches.

For each match in a kept file, remove the dead handler/import.

- [ ] **Step 4: Build to verify**

Run: `pnpm --filter workatomcp-extension build`
Expected: succeeds.

Fix any leftover import errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove web-editor-v2 + builder entrypoints"
```

### Task B4: Delete quick-panel content script and its shared module

**Files:**

- Delete: `app/chrome-extension/entrypoints/quick-panel.content.ts`
- Delete: `app/chrome-extension/shared/quick-panel/` (entire directory)
- Modify: `app/chrome-extension/wxt.config.ts` (remove `toggle_quick_panel` keyboard command)

- [ ] **Step 1: Confirm shared/quick-panel/ is only used by the content script**

Run (Grep tool): pattern `shared/quick-panel` in `app/chrome-extension` excluding `shared/quick-panel/` itself
Expected: matches only in `entrypoints/quick-panel.content.ts` and possibly `entrypoints/background` for command wiring.

- [ ] **Step 2: Delete the files**

Run:

```powershell
Remove-Item -Force app/chrome-extension/entrypoints/quick-panel.content.ts
Remove-Item -Recurse -Force app/chrome-extension/shared/quick-panel
```

- [ ] **Step 3: Remove the keyboard command**

Edit `app/chrome-extension/wxt.config.ts`. Find:

```ts
      toggle_quick_panel: {
        suggested_key: { default: 'Ctrl+Shift+U', mac: 'Command+Shift+U' },
        description: 'Toggle Quick Panel AI Chat',
      },
```

Delete this block.

If the entire `commands: { ... }` map is now empty, delete the whole `commands` key.

- [ ] **Step 4: Remove background handler for `toggle_quick_panel`**

Run (Grep tool): pattern `toggle_quick_panel|quick-panel|quickPanel` in `app/chrome-extension/entrypoints/background`
Expected: matches in command listeners.

Remove each dead handler. If a whole module exists for quick-panel control, delete it.

- [ ] **Step 5: Build to verify**

Run: `pnpm --filter workatomcp-extension build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove quick-panel content overlay"
```

### Task B5: Remove unused dependencies from package.json

**Files:**

- Modify: `app/chrome-extension/package.json`

- [ ] **Step 1: Remove heavy deps that only the deleted entrypoints used**

Edit `app/chrome-extension/package.json`. Remove these lines from `dependencies`:

```json
"@anthropic-ai/claude-agent-sdk": "...",
"@vue-flow/background": "...",
"@vue-flow/controls": "...",
"@vue-flow/core": "...",
"@vue-flow/minimap": "...",
"@xenova/transformers": "...",
"hnswlib-wasm-static": "...",
"markstream-vue": "...",
"elkjs": "..."
```

(The native-server's `@anthropic-ai/claude-agent-sdk` entry is separate. Check if `app/native-server/package.json` also has it; if it's only used by sidepanel-related agent code that lived in the extension, remove it from native-server too. If native-server uses it for something else, keep it there.)

- [ ] **Step 2: Verify `date-fns` usage**

Run (Grep tool): pattern `from 'date-fns'` in `app/chrome-extension/{entrypoints,shared,utils,common}`
Expected: 0+ matches in still-present files.

If 0 matches → remove `"date-fns": "..."` from dependencies.
If non-zero matches → leave `date-fns` in dependencies.

- [ ] **Step 3: Verify `gifenc` is still needed**

Run (Grep tool): pattern `from 'gifenc'|require\(['"]gifenc` in `app/chrome-extension`
Expected: matches in `entrypoints/background/tools/browser/gif-recorder.ts` or `gif-enhanced-renderer.ts`.

If matches found → keep gifenc.
If 0 matches → remove gifenc from dependencies.

- [ ] **Step 4: Reinstall**

Run: `pnpm install`
Expected: lockfile updates; `node_modules` shrinks substantially.

- [ ] **Step 5: Full build to ensure nothing dangling**

Run: `pnpm build`
Expected: All packages build green.

- [ ] **Step 6: Commit**

```bash
git add app/chrome-extension/package.json pnpm-lock.yaml
git commit -m "chore: drop deps only used by removed entrypoints (transformers, vue-flow, claude-agent-sdk, etc.)"
```

### Task B6: Delete non-English locale bundles

**Files:**

- Delete: `app/chrome-extension/_locales/zh_CN/`
- Delete: `app/chrome-extension/_locales/zh_TW/`
- Delete: `app/chrome-extension/_locales/ja/`
- Delete: `app/chrome-extension/_locales/ko/`
- Delete: `app/chrome-extension/_locales/de/`

- [ ] **Step 1: Delete the 5 locale directories**

Run:

```powershell
Remove-Item -Recurse -Force app/chrome-extension/_locales/zh_CN
Remove-Item -Recurse -Force app/chrome-extension/_locales/zh_TW
Remove-Item -Recurse -Force app/chrome-extension/_locales/ja
Remove-Item -Recurse -Force app/chrome-extension/_locales/ko
Remove-Item -Recurse -Force app/chrome-extension/_locales/de
```

- [ ] **Step 2: Build and verify manifest**

Run: `pnpm --filter workatomcp-extension build`
Expected: succeeds.

Verify: `ls app/chrome-extension/.output/chrome-mv3/_locales`
Expected: only `en/` directory.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove non-English locale bundles (zh_CN, zh_TW, ja, ko, de)"
```

### Task B7: Delete tests that test deleted code

**Files:** dynamically discovered

- [ ] **Step 1: Find tests with imports from deleted modules**

Run (Grep tool): pattern `from.*['"](\.\.?/.*)?(sidepanel|web-editor|builder|quick-panel|vector-search|content-indexer|semantic-similarity-engine|vector-database|wasm-simd|@xenova/transformers|hnswlib-wasm-static|claude-agent-sdk|@vue-flow|markstream-vue|elkjs)` in `app/chrome-extension/tests`
Expected: 0–10 test files.

- [ ] **Step 2: Delete each test file that imports only from deleted modules**

For each file in the result, read it. If every imported module is deleted, delete the test file. If it imports a mix (some kept, some deleted), edit it to remove the deleted-module-dependent tests but keep the rest.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm --filter workatomcp-extension test`
Expected: all tests pass. If a test fails because it imports from a now-deleted module that grep missed, delete or edit that test.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: remove tests for deleted entrypoints and vector-search"
```

### Task B8: Block B acceptance gate

**Files:** none (verification only)

- [ ] **Step 1: Full build green**

Run: `pnpm build`
Expected: All 3 packages build successfully.

- [ ] **Step 2: All typechecks pass**

Run: `pnpm -r exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: All tests pass**

Run: `pnpm --filter workatomcp-extension test`
Expected: 0 failures.

- [ ] **Step 4: Bundle size dropped meaningfully**

Run: `du -sh app/chrome-extension/.output/chrome-mv3`
Expected: substantially smaller than the Task A1 baseline (target: <15MB; baseline was ~46MB).

If size is not meaningfully smaller, search for leftover heavy modules that are still imported by surviving code: `du -sh app/chrome-extension/.output/chrome-mv3/* | sort -h | tail -10`.

- [ ] **Step 5: Inspect the final entrypoints list**

Run: `ls app/chrome-extension/entrypoints`
Expected (surviving entrypoints):

- `background/`
- `content.ts`
- `element-picker.content.ts`
- `offscreen/`
- `options/`
- `popup/`
- `shared/`
- `styles/`
- `welcome/`

If anything from the "deleted" list still appears, repeat the relevant Block B task.

---

## Block C — Chinese-string cleanup

This block is a single subagent dispatch followed by verification. The subagent does ~50 files of mechanical translation work; doing it inline would burn ~50k tokens for no benefit.

### Task C1: Dispatch translation subagent

**Files:** modified by subagent (≈50 files across `app/chrome-extension` and elsewhere)

- [ ] **Step 1: Re-baseline the Chinese-character count after Block B's deletions**

Run (Grep tool): pattern `\p{Han}` in `app/`, `packages/` (use `multiline: false`, `output_mode: 'count'`)
Expected: an updated total — should be lower than 1078 because deleted entrypoints carried some.

Record this number — it's the subagent's target (must drop to 0).

- [ ] **Step 2: Dispatch the subagent**

Use the `Agent` tool with `subagent_type: 'general-purpose'`, `model: 'sonnet'`. Pass this prompt verbatim:

> Task: Remove all Chinese-character (CJK) text from WorkatoMCP source files. The repo is a Chrome extension + native messaging bridge fork; Chinese strings are upstream's narration of code.
>
> Scope: `app/` and `packages/` directories, file types `.ts`, `.tsx`, `.vue`, `.js`, `.json` (except files inside `_locales/`), `.md`. Skip `node_modules`, `.output`, `dist`, `.wxt`, `releases`, `generated-images`.
>
> For each Chinese-character occurrence:
>
> - **Default: delete the comment.** Per project conventions (CLAUDE.md), comments should explain WHY (non-obvious constraints), not WHAT. Most upstream Chinese comments narrate WHAT the code does — delete those.
> - **Translate to concise English** only when the comment encodes a real WHY: a hidden constraint, a workaround for a specific bug, a non-obvious invariant. Use ≤1 line.
> - **For Chinese in string literals** (rare): translate to English. If user-facing, ensure the i18n key (if any) is updated consistently.
>
> Workflow:
>
> 1. Use Grep to find all files with `\p{Han}` matches.
> 2. For each file, Read it, identify each Chinese occurrence, Edit per the WHY-vs-WHAT rule.
> 3. After each file, briefly note how many comments you deleted vs translated.
> 4. After ALL files done: run `Grep -P '\p{Han}'` across `app/` and `packages/` to verify 0 matches outside `_locales/`.
>
> Constraints:
>
> - Do NOT touch files under `_locales/` (those were already pruned to en only).
> - Do NOT introduce new functionality or refactor surrounding code. Pure comment/string surgery.
> - Do NOT run `git commit` — leave the working tree dirty for the parent session to review and commit.
> - Report the final delete-vs-translate tally per file.

- [ ] **Step 3: Spot-check 5 files where the subagent deleted ≥5 comments**

After the subagent reports done, read 5 of the files it modified (pick ones with the highest delete counts). Verify the deletions look right — no real WHY information was lost.

If you find a deletion that shouldn't have happened, re-Edit the file to restore a concise English version of the comment.

- [ ] **Step 4: Verify the acceptance gate**

Run (Grep tool): pattern `\p{Han}` in `app/`, `packages/` with `output_mode: 'count'`, glob excluding `_locales/**`
Expected: 0 matches.

If non-zero, identify the remaining files and edit them manually.

- [ ] **Step 5: Build, typecheck, test**

Run: `pnpm build && pnpm -r exec tsc --noEmit && pnpm --filter workatomcp-extension test`
Expected: All green. (Comment removal can't break runtime, but string-literal changes might affect any test that asserts on log output — fix as needed.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove or translate ~1000 upstream Chinese comments and strings"
```

---

## Block D — Logo generation and replacement

### Task D1: Generate 3 logo variants

**Files:**

- Create: `docs/logo-options/v1.png`
- Create: `docs/logo-options/v2.png`
- Create: `docs/logo-options/v3.png`

- [ ] **Step 1: Generate variants**

Invoke the `media-pipeline:image-generation` skill with this brief:

> Three logo variants for "WorkatoMCP" — a Chrome extension that bridges a user's Workato session to AI agents via MCP.
>
> Style requirements:
>
> - Simple, distinctive, modern
> - Must be recognizable at 16×16 pixels (so: a clean silhouette, not a complex scene)
> - Evokes "bridge / connection / automation flow"
> - DO NOT use Workato's actual brand colors (purple #4F39C9 family) or trademark
> - Neutral palette: dark slate (#1e293b) + a single accent (electric blue, teal, or amber — pick one per variant)
> - Square aspect, transparent background, padding so the mark doesn't touch edges
> - 1024×1024 PNG output
>
> Concept suggestions (mix and match across the 3 variants):
>
> - A stylized "W" rendered as two arrows meeting at a node
> - A bracket-like shape "⟨W⟩" suggesting MCP's protocol wrapping
> - Three connected dots forming a "W" silhouette (chain motif)

Save each variant to `docs/logo-options/v1.png`, `v2.png`, `v3.png`.

- [ ] **Step 2: Verify each variant survives 16×16 scaling**

For each PNG, use Sharp or an inline Node snippet to resize a copy to 16×16 and visually inspect (Read the resized PNG; multimodal preview shows the result).

If any variant is unreadable at 16×16, regenerate that variant with a simpler silhouette. Do NOT proceed to D2 until all three pass the readability check.

- [ ] **Step 3: Commit the candidates**

```bash
git add docs/logo-options/
git commit -m "chore: generate logo candidates for v1.3 branding"
```

### Task D2: User picks a variant; export to icon sizes

**Files:**

- Modify: `app/chrome-extension/public/icon/16.png`
- Modify: `app/chrome-extension/public/icon/32.png`
- Modify: `app/chrome-extension/public/icon/48.png`
- Modify: `app/chrome-extension/public/icon/96.png`
- Modify: `app/chrome-extension/public/icon/128.png`
- Create: `docs/logo.png` (the chosen master)
- Delete: `docs/logo-options/v{a,b}.png` (the two losers)

- [ ] **Step 1: Show the 3 variants to the user and get a pick**

Pause execution. Present the variants (the files are at `docs/logo-options/v1.png`, `v2.png`, `v3.png`). Ask the user: "Which variant — 1, 2, or 3? Or regenerate?"

If regenerate: go back to D1 with revised prompt and repeat.
If pick: proceed.

- [ ] **Step 2: Export the chosen variant to 5 PNG sizes**

Write a small Node script using `sharp` (already a transitive dep — verify via `pnpm why sharp` or install fresh if missing):

```js
import sharp from 'sharp';
const source = 'docs/logo-options/v<N>.png'; // replace <N>
const sizes = [16, 32, 48, 96, 128];
for (const size of sizes) {
  await sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(`app/chrome-extension/public/icon/${size}.png`);
}
```

Save as `scripts/export-logo.mjs`, run: `node scripts/export-logo.mjs`.
Expected: 5 PNGs at `app/chrome-extension/public/icon/`.

- [ ] **Step 3: Copy the chosen variant as the master**

Run:

```powershell
Copy-Item docs/logo-options/v<N>.png docs/logo.png
Remove-Item docs/logo-options/v1.png, docs/logo-options/v2.png, docs/logo-options/v3.png
Remove-Item docs/logo-options -ErrorAction SilentlyContinue
Remove-Item scripts/export-logo.mjs   # script was one-shot, no need to keep
```

- [ ] **Step 4: Build to confirm icons are bundled**

Run: `pnpm --filter workatomcp-extension build`
Expected: succeeds.

Verify: `ls app/chrome-extension/.output/chrome-mv3/icon`
Expected: 5 PNGs, dates updated to today.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: replace upstream icons with WorkatoMCP logo"
```

---

## Block E — End-to-end smoke + tag release

### Task E1: Manual smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Reload extension in Chrome**

Manual action by the user: Open `chrome://extensions`, find WorkatoMCP, click the reload icon.

Verify visually:

- The extension's name in the list reads "WorkatoMCP" (not "Chrome MCP Server")
- The toolbar icon shows the new logo
- The popup opens when clicked

- [ ] **Step 2: Verify the bridge launches and serves MCP**

The bridge auto-launches when the extension's first MCP request comes in. Trigger one:

Run: `curl -X POST http://127.0.0.1:12306/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'`
Expected: A JSON-RPC response with `result.serverInfo.name` and `protocolVersion` fields.

- [ ] **Step 3: Verify a workato\_\* tool still works (regression baseline)**

In Claude Code, call:

```
workato_pull_recipe(72652236)
```

Expected: ~350KB JSON returned with the recipe code tree (matches v1.0 baseline).

- [ ] **Step 4: Verify a chrome\_\* tool still works (regression baseline)**

In Claude Code, call:

```
chrome_screenshot({})
```

Expected: base64 PNG returned.

- [ ] **Step 5: Verify deleted UI surfaces are gone**

Try the keyboard shortcuts `Ctrl+Shift+O` and `Ctrl+Shift+U` — should do nothing now.
Try right-clicking the extension icon → there should be no "Open side panel" item.

### Task E2: Tag v1.3.0 and push

**Files:** none (git operations)

- [ ] **Step 1: Verify clean working tree**

Run: `git status`
Expected: `nothing to commit, working tree clean` (or only `pnpm-lock.yaml` if minor lockfile drift).

- [ ] **Step 2: Tag**

```bash
git tag -a v1.3.0 -m "v1.3.0 — rename to WorkatoMCP, prune upstream UI surfaces, drop Chinese strings, new logo"
```

- [ ] **Step 3: Push commits + tag**

```bash
git push origin master
git push origin v1.3.0
```

- [ ] **Step 4: Update memory**

Edit `C:\Users\Kiba0\.claude\projects\C--Work-Personal-WorkatoMCP\memory\project_v11_direction.md`:
Add a `**v1.3 status:**` block noting the rename, prune, branding, and what the new package names are. Future sessions should know the new identifiers.

---

## Self-review checklist

- [x] Spec coverage: every spec section (§1–9) maps to a Block A/B/C/D/E task.
- [x] No placeholders — every step has the exact command or code change.
- [x] Type consistency — package renames are consistent across every reference table.
- [x] Each commit builds green before the next task starts (explicit "build to verify" in every prune task).
- [x] Risks from spec §9 are mitigated by per-step verification commands.

## Acceptance criteria

The plan is complete when:

1. `git log --oneline master..HEAD` shows a clean sequence of rename, prune, cleanup, branding, and smoke commits.
2. `pnpm build` is green.
3. `Grep -P '\p{Han}'` over `app/` and `packages/` returns 0 matches (excluding `_locales/`).
4. Extension bundle is <15 MB (down from 46 MB).
5. Smoke tests E1.2 and E1.3 pass against a live workspace.
6. Tag `v1.3.0` is pushed to `origin`.
