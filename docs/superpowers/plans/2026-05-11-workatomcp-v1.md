# WorkatoMCP v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor `hangwin/mcp-chrome` into this repo and add two read-only MCP tools (`workato_pull_recipe`, `workato_job_trace`) that an AI agent can call to drive a logged-in Workato browser session.

**Architecture:** Hard fork of mcp-chrome's pnpm monorepo (3 packages: `chrome-mcp-shared` schemas, `chrome-mcp-server` extension, `mcp-chrome-bridge` native bridge). New Workato tools land as a self-contained subfolder under the extension's tool tree, plus name+schema entries in the shared package. We touch upstream files in exactly two places: `packages/shared/src/tools.ts` (add WORKATO entries) and `app/chrome-extension/entrypoints/background/tools/index.ts` (spread `workatoTools` into the registry).

**Tech Stack:** TypeScript, WXT (extension framework), pnpm workspaces, Vitest (extension tests), MCP SDK over native-messaging-host bridge that the existing `mcp-chrome-bridge` exposes on `http://127.0.0.1:12306/mcp`.

**Source-of-truth reference:** Workato HTTP endpoint shapes come from `C:\Users\Kiba0\.claude\skills\workato-recipe\SKILL.md`. Do not re-derive them — copy.

**Spec:** `docs/superpowers/specs/2026-05-11-workatomcp-design.md`

---

## Task 1: Vendor upstream mcp-chrome

**Files:**
- Create: everything from upstream `hangwin/mcp-chrome@master` except `.git/` and its `LICENSE` (we keep both repos' LICENSE files — see step 4)
- Preserve: this repo's existing `docs/`, `generated-images/`, and `.git/`

The repo currently has one commit (the spec) and one untracked folder (`generated-images/`). We're going to layer upstream's tree on top without disturbing either.

All commands in this task use **PowerShell** (the user's primary shell). Bash equivalents are available via the Bash tool if needed.

- [ ] **Step 1: Clone upstream to a scratch location**

```powershell
git clone --depth 1 https://github.com/hangwin/mcp-chrome.git "$env:TEMP\mcp-chrome-upstream"
```

Expected: clone succeeds, `$env:TEMP\mcp-chrome-upstream\app\chrome-extension\` exists.

- [ ] **Step 2: Copy upstream files into the repo, excluding upstream's `.git`**

```powershell
robocopy "$env:TEMP\mcp-chrome-upstream" "C:\Work\Personal\WorkatoMCP" /E /XD .git
```

Note: `robocopy` exits with code 1 on success (it means "files copied OK") — that's NOT an error. Anything ≥ 8 is a real failure. PowerShell may surface the non-zero exit; ignore unless `$LASTEXITCODE` ≥ 8.

Expected: `app/`, `packages/`, root `package.json`, `pnpm-workspace.yaml` (or similar), `README.md` (upstream's), etc. all appear. `docs/` and `generated-images/` are untouched (no collision). Our `.git/` is untouched.

- [ ] **Step 3: Rename upstream's README to make room for ours later**

```powershell
Move-Item C:\Work\Personal\WorkatoMCP\README.md C:\Work\Personal\WorkatoMCP\README.upstream.md
Move-Item C:\Work\Personal\WorkatoMCP\README_zh.md C:\Work\Personal\WorkatoMCP\README.upstream.zh.md
```

Our top-level `README.md` will be written in Task 11. Keeping the upstream READMEs as `*.upstream.md` preserves attribution and is honest about the fork lineage.

- [ ] **Step 4: Move upstream LICENSE so it's clearly the *upstream* license**

```powershell
Move-Item C:\Work\Personal\WorkatoMCP\LICENSE C:\Work\Personal\WorkatoMCP\LICENSE.upstream
```

mcp-chrome is MIT — we keep their copyright notice intact. We'll add our own `LICENSE` (also MIT, our copyright) in Task 11 alongside the new README.

- [ ] **Step 5: Install deps**

```bash
cd C:/Work/Personal/WorkatoMCP
pnpm install
```

Expected: pnpm installs all 5 workspace packages (`chrome-mcp-shared`, `chrome-mcp-server`, `mcp-chrome-bridge`, `@chrome-mcp/wasm-simd`, and the root). If pnpm complains about pre/post scripts, add `enable-pre-post-scripts=true` to `.npmrc` per the spec §11.

- [ ] **Step 6: Verify upstream still builds and typechecks cleanly**

```bash
pnpm build:shared
pnpm typecheck
```

Expected: shared package builds without errors; typecheck across all workspaces returns 0. If typecheck fails on a file we haven't touched, STOP and report — we need a clean baseline before adding code on top.

- [ ] **Step 7: Commit the vendored snapshot**

```bash
git add -A
git commit -m "chore: vendor hangwin/mcp-chrome upstream

Snapshot of github.com/hangwin/mcp-chrome@master. Adding Workato-specific
tools in subsequent commits. Upstream README/LICENSE renamed to
README.upstream.md / LICENSE.upstream to preserve attribution."
```

Expected: single large commit with the upstream tree. Verify with `git log --oneline -3`:

```
<sha> chore: vendor hangwin/mcp-chrome upstream
<sha> Add v1 design spec for WorkatoMCP
```

---

## Task 2: Add WORKATO tool names and schemas to shared package

**Files:**
- Modify: `packages/shared/src/tools.ts`

The shared package is where the bridge (`mcp-chrome-bridge`) reads tool schemas to respond to MCP `tools/list`, and where the extension reads tool *names* to dispatch incoming `tools/call` requests. Both packages import from `chrome-mcp-shared`. Both new tools live here.

- [ ] **Step 1: Add a `WORKATO` namespace to `TOOL_NAMES`**

In `packages/shared/src/tools.ts`, find the `TOOL_NAMES` object (it contains a `BROWSER` and `RECORD_REPLAY` namespace today). Add a `WORKATO` namespace below `RECORD_REPLAY`:

```ts
export const TOOL_NAMES = {
  BROWSER: { /* ...existing, unchanged... */ },
  RECORD_REPLAY: { /* ...existing, unchanged... */ },
  WORKATO: {
    PULL_RECIPE: 'workato_pull_recipe',
    JOB_TRACE: 'workato_job_trace',
  },
};
```

- [ ] **Step 2: Add `TOOL_SCHEMAS` entries for both Workato tools**

At the end of the `TOOL_SCHEMAS` array (right before the closing `];`), append:

```ts
  {
    name: TOOL_NAMES.WORKATO.PULL_RECIPE,
    description:
      "Fetch a Workato recipe's full code tree plus version metadata. Read-only. " +
      'Requires an open Workato tab (*.workato.com or *.workato.is) using the same ' +
      "session as the recipe's account.",
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description:
            'Numeric Workato recipe id, e.g. 72449879. Found in the recipe URL: ' +
            'app.workato.com/recipes/<recipe_id>-<slug>.',
        },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.JOB_TRACE,
    description:
      "Fetch a Workato job's per-step execution trace. Read-only. Returns a slimmed " +
      'shape by default (step list, status, error, truncated input/output). Pass ' +
      'full=true to get raw responses for both the job metadata and line details ' +
      'endpoints. Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description: 'Numeric Workato recipe id the job belongs to (required).',
        },
        job_id: {
          type: ['string', 'number'],
          description:
            'Workato job id. May be string or number depending on source; both accepted.',
        },
        full: {
          type: 'boolean',
          description:
            'If true, return raw responses instead of the slim shape. Default false.',
          default: false,
        },
      },
      required: ['recipe_id', 'job_id'],
    },
  },
```

- [ ] **Step 3: Rebuild the shared package**

```bash
cd C:/Work/Personal/WorkatoMCP
pnpm build:shared
```

Expected: shared package builds; no TS errors. The build emits to `packages/shared/dist/` (or whatever its `tsconfig.json` `outDir` is — verify with `ls packages/shared/dist/`).

- [ ] **Step 4: Verify the bridge sees the new schemas**

```bash
pnpm typecheck
```

Expected: 0 errors. (The native server imports `TOOL_SCHEMAS` from the shared package; if our additions break its types we'd see it here.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tools.ts
git commit -m "feat: declare workato_pull_recipe and workato_job_trace tool schemas"
```

---

## Task 3: Create Workato tab-dispatch helper

**Files:**
- Create: `app/chrome-extension/entrypoints/background/tools/workato/tab-dispatch.ts`

This module owns "find a Workato tab and run a fetch inside it." Both v1 tools call it. Future write tools (push) will extend it with tab-state checks (refusing to fire while the recipe is open in `/edit`), but v1 keeps it simple.

- [ ] **Step 1: Create the `workato/` folder**

```bash
mkdir -p app/chrome-extension/entrypoints/background/tools/workato
```

- [ ] **Step 2: Write `tab-dispatch.ts`**

Create `app/chrome-extension/entrypoints/background/tools/workato/tab-dispatch.ts`:

```ts
/**
 * Find a Workato tab and dispatch a fetch in its MAIN-world context so the
 * page's session cookies travel with the request.
 *
 * Selection algorithm (from spec §6):
 *   1. Query tabs matching *.workato.com or *.workato.is.
 *   2. If zero matches  -> TabNotFound.
 *   3. If matches span >1 distinct host -> MultipleWorkatoHosts.
 *   4. Otherwise pick tabs[0].
 */

const WORKATO_URL_PATTERNS = ['*://*.workato.com/*', '*://*.workato.is/*'];

export class WorkatoDispatchError extends Error {
  constructor(
    public code:
      | 'TabNotFound'
      | 'MultipleWorkatoHosts'
      | 'ScriptExecutionFailed'
      | 'UnexpectedShape',
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkatoDispatchError';
  }
}

export interface WorkatoTabInfo {
  tabId: number;
  host: string;
  origin: string;
}

export async function findWorkatoTab(): Promise<WorkatoTabInfo> {
  const tabs = await chrome.tabs.query({ url: WORKATO_URL_PATTERNS });

  if (tabs.length === 0) {
    throw new WorkatoDispatchError(
      'TabNotFound',
      'No Workato tab open. Open https://app.workato.com (or your region) in Chrome ' +
        'and sign in before calling this tool.',
    );
  }

  const usable = tabs.filter((t): t is chrome.tabs.Tab & { id: number; url: string } =>
    typeof t.id === 'number' && typeof t.url === 'string',
  );

  if (usable.length === 0) {
    throw new WorkatoDispatchError(
      'TabNotFound',
      'Found Workato tabs but none have an id and url Chrome will let us script into.',
    );
  }

  const distinctHosts = new Set(usable.map((t) => new URL(t.url).host));
  if (distinctHosts.size > 1) {
    throw new WorkatoDispatchError(
      'MultipleWorkatoHosts',
      `Multiple Workato hosts open at once (${[...distinctHosts].join(', ')}). ` +
        'Close all but one before calling this tool.',
      { hosts: [...distinctHosts] },
    );
  }

  const tab = usable[0];
  const url = new URL(tab.url);
  return { tabId: tab.id, host: url.host, origin: url.origin };
}

/**
 * Run `func(...args)` in the MAIN world of the given tab and return its result.
 * `func` must be self-contained (no captured closures) because Chrome serializes
 * it to a string before executing.
 */
export async function runInWorkatoTab<TArgs extends unknown[], TResult>(
  tabId: number,
  func: (...args: TArgs) => Promise<TResult> | TResult,
  args: TArgs,
): Promise<TResult> {
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: func as (...a: unknown[]) => unknown,
      args: args as unknown[],
    });
  } catch (err) {
    throw new WorkatoDispatchError(
      'ScriptExecutionFailed',
      `chrome.scripting.executeScript failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!results || results.length === 0) {
    throw new WorkatoDispatchError(
      'ScriptExecutionFailed',
      'chrome.scripting.executeScript returned no result frames.',
    );
  }

  const first = results[0];
  if (first.result === undefined) {
    throw new WorkatoDispatchError(
      'ScriptExecutionFailed',
      'In-page script returned undefined. The function likely threw before returning.',
    );
  }

  return first.result as TResult;
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app/chrome-extension/entrypoints/background/tools/workato/tab-dispatch.ts
git commit -m "feat: add Workato tab-dispatch helper"
```

---

## Task 4: Test tab-dispatch

**Files:**
- Create: `app/chrome-extension/tests/workato/tab-dispatch.test.ts`

`runInWorkatoTab` is mostly a thin wrapper around `chrome.scripting.executeScript`; testing it adds little. `findWorkatoTab` has all the branching — that's what we test.

- [ ] **Step 1: Write the failing test**

Create `app/chrome-extension/tests/workato/tab-dispatch.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findWorkatoTab, WorkatoDispatchError } from
  '../../entrypoints/background/tools/workato/tab-dispatch';

type Tab = chrome.tabs.Tab;
const mockTabs: Tab[] = [];

beforeEach(() => {
  mockTabs.length = 0;
  // @ts-expect-error stub global chrome for tests
  globalThis.chrome = {
    tabs: {
      query: vi.fn(async () => mockTabs.slice()),
    },
  };
});

function tab(id: number, url: string): Tab {
  return { id, url } as Tab;
}

describe('findWorkatoTab', () => {
  it('throws TabNotFound when no tabs match', async () => {
    await expect(findWorkatoTab()).rejects.toMatchObject({
      name: 'WorkatoDispatchError',
      code: 'TabNotFound',
    });
  });

  it('returns the single matching tab', async () => {
    mockTabs.push(tab(1, 'https://app.workato.com/recipes/123'));
    const info = await findWorkatoTab();
    expect(info).toEqual({
      tabId: 1,
      host: 'app.workato.com',
      origin: 'https://app.workato.com',
    });
  });

  it('returns the first tab when many tabs share one host', async () => {
    mockTabs.push(tab(1, 'https://app.workato.com/recipes/123'));
    mockTabs.push(tab(2, 'https://app.workato.com/jobs'));
    const info = await findWorkatoTab();
    expect(info.tabId).toBe(1);
  });

  it('throws MultipleWorkatoHosts when tabs span >1 distinct host', async () => {
    mockTabs.push(tab(1, 'https://app.workato.com/recipes/123'));
    mockTabs.push(tab(2, 'https://app.eu.workato.com/recipes/999'));
    await expect(findWorkatoTab()).rejects.toMatchObject({
      name: 'WorkatoDispatchError',
      code: 'MultipleWorkatoHosts',
    });
  });

  it('throws TabNotFound when matching tabs have no id/url', async () => {
    mockTabs.push({ id: undefined, url: 'https://app.workato.com/' } as Tab);
    await expect(findWorkatoTab()).rejects.toMatchObject({
      code: 'TabNotFound',
    });
  });

  it('is a WorkatoDispatchError instance with details', async () => {
    mockTabs.push(tab(1, 'https://app.workato.com/'));
    mockTabs.push(tab(2, 'https://app.workato.is/'));
    try {
      await findWorkatoTab();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkatoDispatchError);
      expect((err as WorkatoDispatchError).details?.hosts).toEqual(
        expect.arrayContaining(['app.workato.com', 'app.workato.is']),
      );
    }
  });
});
```

- [ ] **Step 2: Run the test (expect fail/pass)**

```bash
cd app/chrome-extension
pnpm vitest run tests/workato/tab-dispatch.test.ts
```

Expected: all 6 tests pass. (The implementation already exists from Task 3; we wrote it test-first in the sense that the test was the specification — if any test fails, fix `tab-dispatch.ts`, not the test.)

If the `pnpm vitest` command isn't recognized, check `app/chrome-extension/package.json` for the script name (probably `test` or `vitest`). If no script exists yet, run via `npx vitest run tests/workato/tab-dispatch.test.ts` from `app/chrome-extension/`.

- [ ] **Step 3: Commit**

```bash
git add app/chrome-extension/tests/workato/tab-dispatch.test.ts
git commit -m "test: cover Workato tab selection branches"
```

---

## Task 5: Create CSRF helper

**Files:**
- Create: `app/chrome-extension/entrypoints/background/tools/workato/csrf.ts`

CSRF isn't needed for v1's two GET-only tools, but lands now so future POST/PUT tools (push, soql, schema-derive) don't have to re-introduce it later. Per spec §7 it's literally one function.

- [ ] **Step 1: Write `csrf.ts`**

Create `app/chrome-extension/entrypoints/background/tools/workato/csrf.ts`:

```ts
/**
 * Decode the XSRF-TOKEN-V2 cookie into the value Workato expects as the
 * `x-csrf-token` header on mutating requests.
 *
 * This function is intended to be passed into chrome.scripting.executeScript;
 * it must be self-contained and not rely on any imports. v1 does not use it
 * (pull and job_trace are GET-only), but future push/soql/schema-derive tools
 * will.
 */
export function readCsrfFromCookieInPage(): string {
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith('XSRF-TOKEN-V2='))
    ?.split('=')
    .slice(1)
    .join('=') ?? '';
  return decodeURIComponent(raw);
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/chrome-extension/entrypoints/background/tools/workato/csrf.ts
git commit -m "feat: add CSRF cookie decoder helper (unused in v1, used by future write tools)"
```

---

## Task 6: Implement `workato_pull_recipe` tool

**Files:**
- Create: `app/chrome-extension/entrypoints/background/tools/workato/pull-recipe.ts`

Per spec §5.1: two GETs against `/recipes/<id>.json` and `/recipes/<id>/code.json`. Combine into a `{ recipe_id, code, version }` result.

- [ ] **Step 1: Write `pull-recipe.ts`**

Create `app/chrome-extension/entrypoints/background/tools/workato/pull-recipe.ts`:

```ts
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';

interface PullRecipeArgs {
  recipe_id: number;
}

interface InPageResult {
  ok: boolean;
  /** present when ok=true */
  code?: unknown;
  version?: {
    version_no: number;
    name: string;
    folder_id: number;
    config: string;
    visibility_private: boolean;
    description: string;
    worker_concurrency: number;
    job_data_retention_policy: string;
  };
  /** present when ok=false */
  failure?: {
    stage: 'meta' | 'code' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

/**
 * Function executed in the Workato tab's MAIN world. Self-contained — no captures.
 */
async function pullInPage(recipeId: number): Promise<InPageResult> {
  async function getJson(url: string): Promise<{ status: number; bodyText: string; json: unknown }> {
    const r = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    const bodyText = await r.text();
    let json: unknown = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      /* keep raw body for diagnostics */
    }
    return { status: r.status, bodyText, json };
  }

  const meta = await getJson(`/recipes/${recipeId}.json?error_format=json`);
  if (meta.status < 200 || meta.status >= 300) {
    return {
      ok: false,
      failure: {
        stage: 'meta',
        status: meta.status,
        body_excerpt: meta.bodyText.slice(0, 1024),
        message: `GET /recipes/${recipeId}.json returned HTTP ${meta.status}`,
      },
    };
  }

  const code = await getJson(
    `/recipes/${recipeId}/code.json?mode=view&hideHeader=false&noBorderRadius=false&banHotkeys=false`,
  );
  if (code.status < 200 || code.status >= 300) {
    return {
      ok: false,
      failure: {
        stage: 'code',
        status: code.status,
        body_excerpt: code.bodyText.slice(0, 1024),
        message: `GET /recipes/${recipeId}/code.json returned HTTP ${code.status}`,
      },
    };
  }

  // Shape: meta.result.recipe_data.flow.{version_no,name,folder_id,config,...}
  //        code.result === "<stringified JSON of code tree>"
  // (See SKILL.md "Core endpoints" table.)
  const flow = (meta.json as any)?.result?.recipe_data?.flow;
  const codeStr = (code.json as any)?.result;
  if (!flow || typeof codeStr !== 'string') {
    return {
      ok: false,
      failure: {
        stage: 'shape',
        body_excerpt: JSON.stringify({
          meta_keys: Object.keys((meta.json as any) ?? {}),
          code_keys: Object.keys((code.json as any) ?? {}),
        }).slice(0, 1024),
        message:
          'Unexpected response shape — missing result.recipe_data.flow or result string. ' +
          'Workato API may have drifted; check SKILL.md.',
      },
    };
  }

  let parsedCode: unknown;
  try {
    parsedCode = JSON.parse(codeStr);
  } catch (e) {
    return {
      ok: false,
      failure: {
        stage: 'shape',
        body_excerpt: codeStr.slice(0, 1024),
        message: `JSON.parse(code.result) failed: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }

  return {
    ok: true,
    code: parsedCode,
    version: {
      version_no: Number(flow.version_no),
      name: String(flow.name ?? ''),
      folder_id: Number(flow.folder_id),
      config: typeof flow.config === 'string' ? flow.config : JSON.stringify(flow.config ?? {}),
      visibility_private: Boolean(flow.visibility_private),
      description: String(flow.description ?? ''),
      worker_concurrency: Number(flow.worker_concurrency ?? 1),
      job_data_retention_policy: String(flow.job_data_retention_policy ?? 'default'),
    },
  };
}

class WorkatoPullRecipeTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.PULL_RECIPE;

  async execute(args: PullRecipeArgs): Promise<ToolResult> {
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse('Param [recipe_id] must be a finite number');
      }

      const tab = await findWorkatoTab();
      const result = await runInWorkatoTab(tab.tabId, pullInPage, [args.recipe_id]);

      if (!result.ok) {
        return createErrorResponse(
          `WorkatoApiError (${result.failure?.stage}): ${result.failure?.message}` +
            (result.failure?.body_excerpt ? `\n--- body excerpt ---\n${result.failure.body_excerpt}` : ''),
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              recipe_id: args.recipe_id,
              code: result.code,
              version: result.version,
            }),
          },
        ],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_pull_recipe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoPullRecipeTool = new WorkatoPullRecipeTool();
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors. If `@/common/tool-handler` or `../base-browser` imports fail, verify the alias by looking at how the existing `app/chrome-extension/entrypoints/background/tools/browser/inject-script.ts` imports them — match exactly.

- [ ] **Step 3: Commit**

```bash
git add app/chrome-extension/entrypoints/background/tools/workato/pull-recipe.ts
git commit -m "feat: implement workato_pull_recipe tool"
```

---

## Task 7: Implement `workato_job_trace` tool + slim transform

**Files:**
- Create: `app/chrome-extension/entrypoints/background/tools/workato/slim-trace.ts`
- Create: `app/chrome-extension/entrypoints/background/tools/workato/job-trace.ts`

Slim transform is split into its own file because (a) it's a pure function — easiest to test in isolation, and (b) keeping it out of the executor class makes the executor easier to read.

- [ ] **Step 1: Write `slim-trace.ts`**

Create `app/chrome-extension/entrypoints/background/tools/workato/slim-trace.ts`:

```ts
/**
 * Pure helpers that reshape Workato's verbose job-trace responses into the
 * slim shape v1 returns by default. No I/O, no Chrome APIs — safe to unit-test
 * with fixtures.
 *
 * Endpoint shapes documented in SKILL.md "Pull job report" section.
 */

const SUMMARY_LIMIT = 500;

function summarize(value: unknown): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length <= SUMMARY_LIMIT) return s;
  return s.slice(0, SUMMARY_LIMIT) + '...';
}

export interface RawMetaResponse {
  result?: {
    job?: {
      id?: string | number;
      status?: string;
      started_at?: string;
      completed_at?: string;
      error?: {
        message?: string;
        error_type?: string;
        line_number?: number;
        adapter?: string;
        action?: string;
      };
    };
    recipe?: {
      id?: number;
      name?: string;
      version_no?: number;
    };
  };
}

export interface RawLineDetailsResponse {
  line_details?: Array<{
    recipe_line_number?: number;
    adapter_name?: string;
    adapter_operation?: string;
    input?: unknown;
    output?: unknown;
  }>;
  lines_truncated?: boolean;
  kms_error?: boolean;
}

export interface SlimTrace {
  job_id: string | number;
  recipe: { id: number; name: string; version_no: number };
  status: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  error?: {
    message: string;
    error_type: string;
    line_number: number;
    adapter: string;
    action: string;
  };
  steps: Array<{
    recipe_line_number: number;
    adapter_name: string;
    adapter_operation: string;
    input_summary: string;
    output_summary: string;
  }>;
  lines_truncated: boolean;
  kms_error: boolean;
}

export function buildSlimTrace(
  jobId: string | number,
  meta: RawMetaResponse,
  lineDetails: RawLineDetailsResponse,
): SlimTrace {
  const job = meta.result?.job ?? {};
  const recipe = meta.result?.recipe ?? {};

  const started = job.started_at ?? '';
  const finished = job.completed_at ?? '';
  const duration_ms =
    started && finished ? new Date(finished).getTime() - new Date(started).getTime() : 0;

  return {
    job_id: jobId,
    recipe: {
      id: Number(recipe.id ?? 0),
      name: String(recipe.name ?? ''),
      version_no: Number(recipe.version_no ?? 0),
    },
    status: String(job.status ?? 'unknown'),
    started_at: started,
    completed_at: finished,
    duration_ms,
    error: job.error
      ? {
          message: String(job.error.message ?? ''),
          error_type: String(job.error.error_type ?? ''),
          line_number: Number(job.error.line_number ?? -1),
          adapter: String(job.error.adapter ?? ''),
          action: String(job.error.action ?? ''),
        }
      : undefined,
    steps: (lineDetails.line_details ?? []).map((l) => ({
      recipe_line_number: Number(l.recipe_line_number ?? -1),
      adapter_name: String(l.adapter_name ?? ''),
      adapter_operation: String(l.adapter_operation ?? ''),
      input_summary: summarize(l.input),
      output_summary: summarize(l.output),
    })),
    lines_truncated: Boolean(lineDetails.lines_truncated),
    kms_error: Boolean(lineDetails.kms_error),
  };
}
```

- [ ] **Step 2: Write `job-trace.ts`**

Create `app/chrome-extension/entrypoints/background/tools/workato/job-trace.ts`:

```ts
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';
import { buildSlimTrace, type RawMetaResponse, type RawLineDetailsResponse } from './slim-trace';

interface JobTraceArgs {
  recipe_id: number;
  job_id: string | number;
  full?: boolean;
}

interface InPageResult {
  ok: boolean;
  meta?: RawMetaResponse;
  lineDetails?: RawLineDetailsResponse;
  failure?: {
    stage: 'meta' | 'line_details';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

async function tracePageFn(recipeId: number, jobId: string | number): Promise<InPageResult> {
  async function getJson(url: string): Promise<{ status: number; bodyText: string; json: unknown }> {
    const r = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    const bodyText = await r.text();
    let json: unknown = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      /* swallow */
    }
    return { status: r.status, bodyText, json };
  }

  const meta = await getJson(`/web_api/recipes/${recipeId}/jobs/${jobId}`);
  if (meta.status < 200 || meta.status >= 300) {
    return {
      ok: false,
      failure: {
        stage: 'meta',
        status: meta.status,
        body_excerpt: meta.bodyText.slice(0, 1024),
        message: `GET /web_api/recipes/${recipeId}/jobs/${jobId} returned HTTP ${meta.status}`,
      },
    };
  }

  const trace = await getJson(
    `/web_api/recipes/${recipeId}/jobs/${jobId}/line_details?stringify_big_numbers=true`,
  );
  if (trace.status < 200 || trace.status >= 300) {
    return {
      ok: false,
      failure: {
        stage: 'line_details',
        status: trace.status,
        body_excerpt: trace.bodyText.slice(0, 1024),
        message: `GET /line_details returned HTTP ${trace.status}`,
      },
    };
  }

  return {
    ok: true,
    meta: meta.json as RawMetaResponse,
    lineDetails: trace.json as RawLineDetailsResponse,
  };
}

class WorkatoJobTraceTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.JOB_TRACE;

  async execute(args: JobTraceArgs): Promise<ToolResult> {
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse('Param [recipe_id] must be a finite number');
      }
      if (args?.job_id === undefined || args.job_id === null) {
        return createErrorResponse('Param [job_id] is required');
      }
      const full = args.full === true;

      const tab = await findWorkatoTab();
      const result = await runInWorkatoTab(tab.tabId, tracePageFn, [args.recipe_id, args.job_id]);

      if (!result.ok) {
        return createErrorResponse(
          `WorkatoApiError (${result.failure?.stage}): ${result.failure?.message}` +
            (result.failure?.body_excerpt ? `\n--- body excerpt ---\n${result.failure.body_excerpt}` : ''),
        );
      }

      const payload = full
        ? { job_id: args.job_id, meta: result.meta, line_details: result.lineDetails }
        : buildSlimTrace(args.job_id, result.meta!, result.lineDetails!);

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_job_trace failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoJobTraceTool = new WorkatoJobTraceTool();
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app/chrome-extension/entrypoints/background/tools/workato/slim-trace.ts \
        app/chrome-extension/entrypoints/background/tools/workato/job-trace.ts
git commit -m "feat: implement workato_job_trace tool with slim-by-default transform"
```

---

## Task 8: Test slim-trace transform

**Files:**
- Create: `app/chrome-extension/tests/workato/slim-trace.test.ts`

- [ ] **Step 1: Write the tests**

Create `app/chrome-extension/tests/workato/slim-trace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSlimTrace } from
  '../../entrypoints/background/tools/workato/slim-trace';

const META_OK = {
  result: {
    job: {
      id: 42,
      status: 'succeeded',
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:00:01.500Z',
    },
    recipe: { id: 7, name: 'My Recipe', version_no: 3 },
  },
};

const META_FAILED = {
  result: {
    job: {
      id: 99,
      status: 'failed',
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:00:02.000Z',
      error: {
        message: 'NetSuite write failed',
        error_type: 'AdapterError',
        line_number: 7,
        adapter: 'netsuite',
        action: 'add_record',
      },
    },
    recipe: { id: 7, name: 'My Recipe', version_no: 3 },
  },
};

const LINES = {
  line_details: [
    {
      recipe_line_number: 0,
      adapter_name: 'salesforce',
      adapter_operation: 'new_updated_object',
      input: { sobject: 'Account' },
      output: { Id: '001xxx', Name: 'Acme' },
    },
    {
      recipe_line_number: 1,
      adapter_name: 'netsuite',
      adapter_operation: 'add_record',
      input: { huge: 'x'.repeat(2000) },
      output: { ok: true },
    },
  ],
  lines_truncated: false,
  kms_error: false,
};

describe('buildSlimTrace', () => {
  it('shapes a succeeded job', () => {
    const slim = buildSlimTrace(42, META_OK, LINES);
    expect(slim.job_id).toBe(42);
    expect(slim.status).toBe('succeeded');
    expect(slim.duration_ms).toBe(1500);
    expect(slim.error).toBeUndefined();
    expect(slim.recipe).toEqual({ id: 7, name: 'My Recipe', version_no: 3 });
    expect(slim.steps).toHaveLength(2);
    expect(slim.steps[0].adapter_name).toBe('salesforce');
  });

  it('includes error block when job failed', () => {
    const slim = buildSlimTrace(99, META_FAILED, LINES);
    expect(slim.status).toBe('failed');
    expect(slim.error?.message).toBe('NetSuite write failed');
    expect(slim.error?.line_number).toBe(7);
  });

  it('truncates large input_summary to 500 chars + ellipsis', () => {
    const slim = buildSlimTrace(42, META_OK, LINES);
    const big = slim.steps[1].input_summary;
    expect(big.length).toBeLessThanOrEqual(503); // 500 + '...'
    expect(big.endsWith('...')).toBe(true);
  });

  it('passes through lines_truncated and kms_error flags', () => {
    const slim = buildSlimTrace(1, META_OK, { ...LINES, lines_truncated: true, kms_error: true });
    expect(slim.lines_truncated).toBe(true);
    expect(slim.kms_error).toBe(true);
  });

  it('handles missing line_details safely', () => {
    const slim = buildSlimTrace(1, META_OK, {});
    expect(slim.steps).toEqual([]);
    expect(slim.lines_truncated).toBe(false);
  });

  it('handles missing job/recipe fields with sensible defaults', () => {
    const slim = buildSlimTrace('abc', {}, {});
    expect(slim.job_id).toBe('abc');
    expect(slim.status).toBe('unknown');
    expect(slim.recipe).toEqual({ id: 0, name: '', version_no: 0 });
    expect(slim.duration_ms).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd app/chrome-extension
pnpm vitest run tests/workato/slim-trace.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/chrome-extension/tests/workato/slim-trace.test.ts
git commit -m "test: cover slim-trace shaping for succeeded/failed/truncated jobs"
```

---

## Task 9: Create Workato barrel + register tools in main registry

**Files:**
- Create: `app/chrome-extension/entrypoints/background/tools/workato/index.ts`
- Modify: `app/chrome-extension/entrypoints/background/tools/index.ts`

- [ ] **Step 1: Write the barrel file**

Create `app/chrome-extension/entrypoints/background/tools/workato/index.ts`:

```ts
export { workatoPullRecipeTool } from './pull-recipe';
export { workatoJobTraceTool } from './job-trace';
```

This barrel only exports tools we want **registered**. Future-tool stubs (Task 10) live in this folder but are NOT re-exported from this index, so they cannot be reached via the registry.

- [ ] **Step 2: Read the existing extension tool registry**

Open `app/chrome-extension/entrypoints/background/tools/index.ts`. It currently looks like:

```ts
import { createErrorResponse } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import * as browserTools from './browser';
import { flowRunTool, listPublishedFlowsTool } from './record-replay';

const tools = { ...browserTools, flowRunTool, listPublishedFlowsTool } as any;
const toolsMap = new Map(Object.values(tools).map((tool: any) => [tool.name, tool]));
// ...
```

- [ ] **Step 3: Add the Workato import and spread**

Modify `app/chrome-extension/entrypoints/background/tools/index.ts`:

Change:
```ts
import * as browserTools from './browser';
import { flowRunTool, listPublishedFlowsTool } from './record-replay';

const tools = { ...browserTools, flowRunTool, listPublishedFlowsTool } as any;
```

To:
```ts
import * as browserTools from './browser';
import * as workatoTools from './workato';
import { flowRunTool, listPublishedFlowsTool } from './record-replay';

const tools = { ...browserTools, ...workatoTools, flowRunTool, listPublishedFlowsTool } as any;
```

Exactly two lines added (one import, one spread). No other edits.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Build the extension**

```bash
pnpm build:shared && pnpm build:extension
```

Expected: extension builds to `app/chrome-extension/.output/` (or wherever WXT outputs — confirm by listing the directory after build). No errors.

- [ ] **Step 6: Commit**

```bash
git add app/chrome-extension/entrypoints/background/tools/workato/index.ts \
        app/chrome-extension/entrypoints/background/tools/index.ts
git commit -m "feat: register workato tools in extension tool registry"
```

---

## Task 10: Stub future tools (not registered)

**Files:**
- Create: `app/chrome-extension/entrypoints/background/tools/workato/push-recipe.stub.ts`
- Create: `app/chrome-extension/entrypoints/background/tools/workato/run-soql.stub.ts`
- Create: `app/chrome-extension/entrypoints/background/tools/workato/schema-derive.stub.ts`

Per spec §9. These files exist so future implementation work has the endpoint research checked in alongside the codebase. They are NOT exported from `workato/index.ts`, NOT in `TOOL_NAMES.WORKATO`, NOT in `TOOL_SCHEMAS`. They are unreachable from the running system — pure documentation that happens to be in `.ts` form so IDEs can lint it.

- [ ] **Step 1: Write `push-recipe.stub.ts`**

Create `app/chrome-extension/entrypoints/background/tools/workato/push-recipe.stub.ts`:

```ts
/**
 * PLANNED v1.1+ — NOT WIRED, NOT REGISTERED.
 *
 * workato_push_recipe — PUT /recipes/<id>.json
 *
 * Body shape (top-level keys are exactly flow / client_uuid / error_format —
 * NOT {recipe: {...}}):
 *
 *   {
 *     "flow": {
 *       "name", "description", "visibility_private", "curated",
 *       "last_version_no": <int — must equal current server version>,
 *       "code":   "<stringified JSON of code tree>",
 *       "config": "<stringified JSON of connector accounts — usually unchanged>",
 *       "copy_in_progress": false,
 *       "worker_concurrency": 1,
 *       "folder_id": <int>,
 *       "job_data_retention_policy": "default"
 *     },
 *     "client_uuid": "<uuid v4>",
 *     "error_format": "json"
 *   }
 *
 * Headers: content-type: application/json; charset=utf-8,
 *          x-csrf-token: <decoded XSRF-TOKEN-V2 cookie — see csrf.ts>,
 *          x-requested-with: XMLHttpRequest.
 *
 * DO NOT GZIP THE BODY — Workato accepts uncompressed; gzipping breaks if
 * encoding is wrong.
 *
 * Safety rules to enforce in code, not just docs:
 *
 *   1. PULL-BEFORE-PUSH — tool requires caller to pass a version_no obtained
 *      from a recent workato_pull_recipe. Stale last_version_no → 409.
 *   2. BACKUP-BEFORE-PUSH — write the pre-push state to
 *      .workato/<id>.before.<ts>.json before the PUT.
 *   3. REJECT WHILE /edit OPEN — chrome.tabs.query for the recipe's edit URL;
 *      if found, refuse with RecipeOpenInEditMode. Editor caches the recipe
 *      in memory; saving in the UI after a programmatic push silently
 *      overwrites our edits (server version_no advances but field changes
 *      disappear).
 *   4. NO flow.config MUTATION unless caller explicitly passes
 *      allow_config_changes: true.
 *   5. NO mutation of flow.id / version_no outside the documented role.
 *
 * Failure modes:
 *   - 409 → version mismatch; re-pull, re-apply edits, retry once.
 *   - 401/403 → session expired; user must re-auth.
 *   - 200 with non-empty result.flow.code_errors or .requirements_errors →
 *     semantic rejection; surface the errors.
 */
export const PLANNED_PUSH_RECIPE_NOTES = true;
```

- [ ] **Step 2: Write `run-soql.stub.ts`**

Create `app/chrome-extension/entrypoints/background/tools/workato/run-soql.stub.ts`:

```ts
/**
 * PLANNED v1.1+ — NOT WIRED, NOT REGISTERED.
 *
 * workato_run_soql — POST /utils/sample_to_schema.json
 *
 * Headers: content-type: application/json,
 *          x-csrf-token: <decoded XSRF-TOKEN-V2 — see csrf.ts>,
 *          x-requested-with: XMLHttpRequest.
 *
 * Body:
 *   { "sample": "<SOQL>", "type": "soql", "shared_account_id": <int> }
 *
 * Response:
 *   { "result": { "schema": [...], "sample": [ {row}, ... ] } }
 *
 * Caveats:
 *   - Hard-capped to ~100-150 rows server-side. Surface this in the response.
 *   - 422 → almost always stale CSRF. Re-read cookie and retry ONCE before
 *     failing (don't paste the token into the function literal; read it from
 *     document.cookie at call time so it's always fresh).
 *   - 403 → session expired; user must re-log into Workato.
 *   - Empty sample: [] with status 200 → SOQL returned no rows OR the query
 *     is malformed (Workato may swallow the SF error). Caller decides.
 *   - shared_account_id is the connection id. Find it on
 *     /connections/<id>/extended_schema.json or in any recipe step's account_id.
 *   - Treat as read-only — no DML through this endpoint.
 *   - Workato logs every call — don't loop tightly.
 */
export const PLANNED_RUN_SOQL_NOTES = true;
```

- [ ] **Step 3: Write `schema-derive.stub.ts`**

Create `app/chrome-extension/entrypoints/background/tools/workato/schema-derive.stub.ts`:

```ts
/**
 * PLANNED v1.1+ — NOT WIRED, NOT REGISTERED.
 *
 * workato_schema_derive — same endpoint as workato_run_soql
 * (POST /utils/sample_to_schema.json), but the tool returns only
 * result.schema (the field definitions in the same shape Workato writes into
 * extended_output_schema on actions), discarding result.sample (rows).
 *
 * Useful for "what does this SObject's schema look like?" without dumping
 * up to 150 rows of data.
 *
 * Same auth, same failure modes as workato_run_soql.
 */
export const PLANNED_SCHEMA_DERIVE_NOTES = true;
```

- [ ] **Step 4: Verify these are unreachable**

Use the Grep tool with pattern `PLANNED_PUSH_RECIPE_NOTES|PLANNED_RUN_SOQL_NOTES|PLANNED_SCHEMA_DERIVE_NOTES`, glob `**/*.ts`, then ignore the three `.stub.ts` files themselves.

Or, in PowerShell:

```powershell
Get-ChildItem -Recurse -Include *.ts app/, packages/ |
  Where-Object { $_.Name -notlike '*.stub.ts' } |
  Select-String -Pattern 'PLANNED_PUSH_RECIPE_NOTES|PLANNED_RUN_SOQL_NOTES|PLANNED_SCHEMA_DERIVE_NOTES'
```

Expected: zero matches. The stubs are not imported by any non-stub file.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/chrome-extension/entrypoints/background/tools/workato/*.stub.ts
git commit -m "docs: capture planned push/soql/schema-derive endpoint notes as stubs"
```

---

## Task 11: Write top-level README and LICENSE

**Files:**
- Create: `README.md` (top-level)
- Create: `LICENSE`

- [ ] **Step 1: Write the top-level README**

Create `C:\Work\Personal\WorkatoMCP\README.md`:

```markdown
# WorkatoMCP

A Chrome extension + local MCP bridge that exposes typed Workato recipe operations to AI agents (Claude Code, Claude Desktop, etc.) by piggybacking on the user's already-authenticated Workato browser session.

Forked from [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome) — see `README.upstream.md` for the parent project, and `LICENSE.upstream` for its MIT license.

## v1 tools

Both are read-only and require an open Workato tab.

### `workato_pull_recipe`

```
input:  { recipe_id: number }
output: { recipe_id, code: <parsed flow tree>, version: { version_no, name, folder_id, ... } }
```

### `workato_job_trace`

```
input:  { recipe_id: number, job_id: string|number, full?: boolean }
output (default): { job_id, recipe, status, started_at, completed_at, duration_ms, error?, steps[], lines_truncated, kms_error }
output (full=true): { job_id, meta: <raw>, line_details: <raw> }
```

Per-step `input_summary` / `output_summary` are truncated to 500 chars. Pass `full: true` for the raw responses.

## Install (dev)

1. `pnpm install`
2. `pnpm build`
3. Chrome → `chrome://extensions/` → enable Developer mode → "Load unpacked" → select `app/chrome-extension/.output/chrome-mv3` (or whatever folder WXT emitted — check `app/chrome-extension/.output/`).
4. Start the bridge: `pnpm dev:native` (or the production equivalent — confirm from `app/native-server/package.json`). Bridge listens on `http://127.0.0.1:12306/mcp`.
5. Register in your MCP client. Example for Claude Code (`~/.claude/mcp.json` or equivalent):

```json
{
  "mcpServers": {
    "workato": {
      "transport": "http",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

If pnpm v7+ skips postinstall scripts, add to `.npmrc`:

```
enable-pre-post-scripts=true
```

## Manual smoke test

After loading the extension and starting the bridge:

1. Open Chrome and sign in to Workato (`https://app.workato.com` or your region).
2. Open any recipe — note its numeric id from the URL.
3. From an MCP client, call `workato_pull_recipe({ recipe_id: <id> })`. Verify `version.version_no` is a positive integer and `code` is an object.
4. Pick a recent job for that recipe. Call `workato_job_trace({ recipe_id: <id>, job_id: <jid> })`. Verify `steps[]` is non-empty (or that `error` is set if the job failed).
5. Repeat with `full: true` — verify `meta` and `line_details` keys are populated with raw responses.

## Tab selection

The tools auto-discover a Workato tab (`*.workato.com` or `*.workato.is`).

- Zero matching tabs → `TabNotFound` (open Workato first).
- Tabs across multiple distinct hosts (e.g. US + EU at the same time) → `MultipleWorkatoHosts` (close one).
- One or more tabs on the same host → uses the first.

## Planned v1.1+

Documented as stub files under `app/chrome-extension/entrypoints/background/tools/workato/*.stub.ts`:

- `workato_push_recipe` — recipe write (with pull-before-push, last_version_no lock, /edit-tab refusal).
- `workato_run_soql` — SOQL passthrough via the schema-derivation endpoint.
- `workato_schema_derive` — schema-only result from the same endpoint.

Full design rationale: `docs/superpowers/specs/2026-05-11-workatomcp-design.md`.

## Repo layout

```
WorkatoMCP/
├── app/
│   ├── chrome-extension/                              # MV3 extension (WXT)
│   │   └── entrypoints/background/tools/
│   │       ├── browser/      (upstream)
│   │       ├── record-replay/(upstream)
│   │       └── workato/      (THIS FORK — pull, trace, csrf, tab-dispatch)
│   └── native-server/                                  # local bridge :12306
├── packages/
│   ├── shared/        (TOOL_NAMES.WORKATO + TOOL_SCHEMAS additions live here)
│   └── wasm-simd/     (upstream)
├── docs/superpowers/
│   ├── specs/2026-05-11-workatomcp-design.md
│   └── plans/2026-05-11-workatomcp-v1.md
└── README.upstream.md  / LICENSE.upstream             (parent project)
```

## License

MIT. See `LICENSE` (this fork) and `LICENSE.upstream` (parent project, mcp-chrome).
```

- [ ] **Step 2: Write the LICENSE**

Create `C:\Work\Personal\WorkatoMCP\LICENSE`:

```
MIT License

Copyright (c) 2026 Roman Chikalenko

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

This project is a fork of hangwin/mcp-chrome. The original work's MIT license
is preserved at LICENSE.upstream and applies to all unmodified files vendored
from that project.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: add WorkatoMCP README and fork-attribution LICENSE"
```

---

## Task 12: Final end-to-end smoke test

This task is not code — it's the manual verification gate before declaring v1 done. It runs in a real browser against real Workato.

**Prerequisites:** the user is signed in to a Workato account they have permission to read recipes from. Pick a recipe and a recent job ahead of time.

- [ ] **Step 1: Clean build**

```bash
cd C:/Work/Personal/WorkatoMCP
pnpm clean:dist
pnpm build
```

Expected: shared → extension → native server all build cleanly.

- [ ] **Step 2: Load the extension**

In Chrome:
1. Navigate to `chrome://extensions/`
2. Toggle "Developer mode" on (top right)
3. Click "Load unpacked"
4. Pick the folder `app/chrome-extension/.output/chrome-mv3` (confirm path by `ls app/chrome-extension/.output/`)
5. Verify the extension appears with no red errors

- [ ] **Step 3: Start the bridge**

```bash
pnpm dev:native
```

(If `dev:native` isn't suitable for a smoke test, use whatever start command `app/native-server/package.json` defines for production — `pnpm --filter mcp-chrome-bridge start` or similar.)

Expected: bridge logs "listening on 127.0.0.1:12306" or equivalent. Leave running.

- [ ] **Step 4: Register the bridge in an MCP client**

Use Claude Code or Claude Desktop. Add to MCP config:

```json
{
  "mcpServers": {
    "workato": { "transport": "http", "url": "http://127.0.0.1:12306/mcp" }
  }
}
```

Restart the client. Verify both `workato_pull_recipe` and `workato_job_trace` appear in the tool list.

- [ ] **Step 5: Open Workato in Chrome**

Navigate to `https://app.workato.com` (or your region's URL). Sign in. Open the recipe you pre-selected.

- [ ] **Step 6: Run pull**

From the MCP client:

```
workato_pull_recipe({ "recipe_id": <your recipe id> })
```

Expected: returns a `{ recipe_id, code: <object>, version: { version_no: <int>, name, folder_id, ... } }` payload. `version.version_no` should match what you see in the recipe URL/UI.

- [ ] **Step 7: Run trace (slim)**

Pick a recent job for the same recipe.

```
workato_job_trace({ "recipe_id": <id>, "job_id": "<job id>" })
```

Expected: slim response with `status`, `recipe`, `steps[]` populated. If the job failed, `error` should be present.

- [ ] **Step 8: Run trace (full)**

```
workato_job_trace({ "recipe_id": <id>, "job_id": "<job id>", "full": true })
```

Expected: response includes `meta` and `line_details` keys with raw API shapes.

- [ ] **Step 9: Negative test — no Workato tab**

Close all Workato tabs. Call `workato_pull_recipe({ "recipe_id": <id> })`.

Expected: error response mentioning `TabNotFound`.

- [ ] **Step 10: Negative test — multiple hosts**

Open both a `*.workato.com` tab and a `*.workato.is` tab (or two regions). Call any Workato tool.

Expected: error response mentioning `MultipleWorkatoHosts`.

- [ ] **Step 11: Final commit (tag v1)**

If everything above passed:

```bash
git tag v1.0.0-rc1
git log --oneline | head -20
```

Expected: a clean commit history from the spec → vendor → schemas → dispatch → tools → tests → registry → stubs → README → tag.

---

## Out of scope (do NOT add to v1)

These come up naturally during implementation. Resist:

- Push, SOQL, schema-derive implementations (stubs only — they're v1.1+).
- Multi-region tab disambiguation arg (`region: "us"|"eu"`). v1 just errors.
- Caching. v1 hits Workato fresh every call.
- Tab manipulation (opening, focusing, navigating). v1 fails with TabNotFound if the right tab isn't open.
- Recipe diffing or merging. Return the raw tree.
- Rebranding upstream `chrome-mcp-*` package names. Adds rebase pain for no v1 user-visible benefit.
- Chrome Web Store packaging. v1 is load-unpacked only.
