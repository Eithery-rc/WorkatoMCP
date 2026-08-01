# WorkatoMCP v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four read-only discovery MCP tools (`workato_search_recipes`, `workato_search_connections`, `workato_get_connection`, `workato_list_jobs`) so agents can find recipes, connections, and jobs by themselves rather than needing IDs handed to them.

**Architecture:** Each tool reuses v1's `findWorkatoTab` + `runInWorkatoTab` dispatch, calls a thin `fetch()`-based in-page function (plain `function` returning `.then()` chains — never `async`/`await`, per v1 pitfalls memory), and shapes the response through pure helpers. Two new pure helpers: `buildSlimRecipe`/`buildSlimConnection` (response shaping) and `stripConnectionSecrets` (recursive denylist for auth material).

**Tech Stack:** TypeScript, WXT extension framework, pnpm workspaces, Vitest. Same as v1.

**Spec:** `docs/superpowers/specs/2026-05-12-workatomcp-v11-design.md` (commit `151fe93`).
**Endpoint reference (source of truth for URLs/params):** `docs/superpowers/specs/2026-05-12-v11-discovery-endpoints.md` (commit `4fb476f`).
**v1 design (architecture context):** `docs/superpowers/specs/2026-05-11-workatomcp-design.md`.

**Important constraints carried over from v1:**

- In-page functions passed to `chrome.scripting.executeScript({func})` MUST be plain `function` declarations returning `Promise.then()` chains. **NEVER `async function`** — WXT/Vite transpiles those into a sync wrapper that calls a hoisted `_<name>` helper, which doesn't survive `.toString()` serialization (causes `ReferenceError: _<name> is not defined` in the page). All four in-page functions in this plan follow that pattern.
- Targeted typechecking ONLY (`pnpm --filter chrome-mcp-shared exec tsc --noEmit` for shared, `pnpm --filter chrome-mcp-server exec tsc --noEmit 2>&1 | Select-String "<your-file>"` for chrome-extension). Root-level `pnpm typecheck` surfaces 115 pre-existing upstream errors that are not v1.1's concern.
- Conventional commits — commitlint will reject anything else. Use `feat:`, `test:`, `docs:`, `fix:`, `chore:`.
- **DO NOT** add "🤖 Generated with Claude Code" or "Co-Authored-By: Claude..." lines to commit messages.
- Primary shell is PowerShell on Windows.

---

## Task 1: Register four new tool names + schemas in the shared package

**Files:**

- Modify: `packages/shared/src/tools.ts`

The shared package exposes `TOOL_NAMES.WORKATO.*` constants used by the extension to dispatch tool calls, and `TOOL_SCHEMAS` array consumed by the bridge to answer MCP `tools/list`. Both packages depend on this.

- [ ] **Step 1: Add four new names to `TOOL_NAMES.WORKATO`**

Open `packages/shared/src/tools.ts`. The `WORKATO` namespace is currently at lines 47-50:

```ts
  WORKATO: {
    PULL_RECIPE: 'workato_pull_recipe',
    JOB_TRACE: 'workato_job_trace',
  },
```

Change it to:

```ts
  WORKATO: {
    PULL_RECIPE: 'workato_pull_recipe',
    JOB_TRACE: 'workato_job_trace',
    SEARCH_RECIPES: 'workato_search_recipes',
    SEARCH_CONNECTIONS: 'workato_search_connections',
    GET_CONNECTION: 'workato_get_connection',
    LIST_JOBS: 'workato_list_jobs',
  },
```

- [ ] **Step 2: Append four schema entries to `TOOL_SCHEMAS`**

Find the end of the `TOOL_SCHEMAS` array (look for the JOB_TRACE entry, then the closing `];`). Insert these four entries right before the closing `];`:

```ts
  {
    name: TOOL_NAMES.WORKATO.SEARCH_RECIPES,
    description:
      'Search Workato recipes by name. Returns a paginated list of recipes ' +
      '(20 per page, server-capped). Optional folder_id scopes the search. ' +
      'Optional text does a name substring match across the workspace. ' +
      'Pass full=true for the raw 24-key Workato response shape. ' +
      'Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Name substring search. Omit or empty for all recipes.',
        },
        folder_id: {
          type: 'number',
          description: 'Numeric folder id to scope the search.',
        },
        page: {
          type: 'number',
          description: '1-based page number. Default 1. Workato returns 20 items per page (server-capped).',
          default: 1,
        },
        sort: {
          type: 'string',
          enum: ['latest_activity', 'name', 'updated_at', 'created_at'],
          description: 'Sort order. Default latest_activity.',
          default: 'latest_activity',
        },
        full: {
          type: 'boolean',
          description: 'If true, return the raw Workato response shape instead of the slim shape.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.SEARCH_CONNECTIONS,
    description:
      'Search Workato connections by name. Same paginated endpoint as ' +
      'workato_search_recipes but filters to connections. Note: text= ' +
      'matches connection NAMES, not the provider field. To find all ' +
      'salesforce connections, either search a name pattern or page through ' +
      'all and filter client-side on the per-item provider field. Requires ' +
      'an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Connection name substring search.',
        },
        folder_id: {
          type: 'number',
          description: 'Numeric folder id to scope the search.',
        },
        page: {
          type: 'number',
          description: '1-based page number. Default 1. 20 items per page.',
          default: 1,
        },
        sort: {
          type: 'string',
          enum: ['latest_activity', 'name', 'updated_at'],
          description: 'Sort order. Default latest_activity.',
          default: 'latest_activity',
        },
        full: {
          type: 'boolean',
          description: 'If true, return raw Workato shape instead of slim shape.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.GET_CONNECTION,
    description:
      'Fetch a single Workato connection by id. Returns metadata ' +
      '(id, name, provider, recipe_count, authorization_status, ' +
      'dates) plus a config object containing per-provider settings ' +
      'with secret-shaped keys/values stripped (auth tokens, passwords, ' +
      'API keys, JWTs, long opaque tokens). The strip applies even with ' +
      'full=true — there is no escape hatch for secrets. Requires an ' +
      'open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        connection_id: {
          type: 'number',
          description: 'Numeric Workato connection id.',
        },
        full: {
          type: 'boolean',
          description: 'If true, return the secret-stripped raw response instead of the slim metadata+config shape.',
          default: false,
        },
      },
      required: ['connection_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.LIST_JOBS,
    description:
      "List jobs for a Workato recipe. Tool auto-walks Workato's cursor " +
      'pagination under the hood up to `limit` (default 25, max 100). ' +
      'Supports server-side filters: status (singular), query (full-text ' +
      'against title/error), started_at window, group_by_master_job. ' +
      'For paging past `limit`, pass cursor (the next_cursor from the ' +
      'previous response). Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description: 'Numeric Workato recipe id.',
        },
        limit: {
          type: 'number',
          description: 'Max jobs to return. 1..100, default 25. Tool auto-walks Workato pagination cursor to fulfill.',
          default: 25,
          minimum: 1,
          maximum: 100,
        },
        status: {
          type: 'string',
          description: "Server-side status filter. Use 'failed', 'succeeded', 'pending', etc. SINGULAR — statuses[] is silently ignored.",
        },
        query: {
          type: 'string',
          description: 'Full-text search against job title and error message.',
        },
        started_at: {
          type: 'string',
          enum: ['7.days', '30.days', 'all'],
          description: 'Time window for job start time. Default behavior is server-defined.',
        },
        group_by_master_job: {
          type: 'boolean',
          description: 'Collapse retry chains under their master job.',
          default: false,
        },
        cursor: {
          type: 'string',
          description: "Job id to resume from. Pass the next_cursor from a previous response to page forward.",
        },
        full: {
          type: 'boolean',
          description: 'If true, return raw concatenated pages instead of the slim shape.',
          default: false,
        },
      },
      required: ['recipe_id'],
    },
  },
```

- [ ] **Step 3: Build the shared package**

```powershell
cd C:\Work\Personal\WorkatoMCP
pnpm build:shared
```

Expected: shared package builds without errors. CJS + ESM + DTS bundles emitted to `packages/shared/dist/`.

- [ ] **Step 4: Targeted typecheck**

```powershell
pnpm --filter chrome-mcp-shared exec tsc --noEmit
```

Expected: exit 0, no output. The MCP SDK's `Tool` type accepts string-typed properties.

- [ ] **Step 5: Commit**

```powershell
git add packages/shared/src/tools.ts
git commit -m "feat: declare v1.1 discovery tool schemas (search/get/list)"
```

---

## Task 2: Implement `stripConnectionSecrets` pure helper (TDD)

**Files:**

- Create: `app/chrome-extension/entrypoints/background/tools/workato/strip-secrets.ts`
- Create: `app/chrome-extension/tests/workato/strip-secrets.test.ts`

Pure function with zero dependencies. Tests drive the implementation. Used by `workato_get_connection` (Task 6).

- [ ] **Step 1: Write the failing tests**

Create `app/chrome-extension/tests/workato/strip-secrets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripConnectionSecrets } from '../../entrypoints/background/tools/workato/strip-secrets';

describe('stripConnectionSecrets', () => {
  describe('exact-match keys', () => {
    it('drops auth_token, refresh_token, password, client_secret', () => {
      const input = {
        id: 1,
        auth_token: 'abc',
        refresh_token: 'def',
        password: 'hunter2',
        client_secret: 'shh',
      };
      const out = stripConnectionSecrets(input) as Record<string, unknown>;
      expect(out).toEqual({ id: 1 });
    });

    it('matches case-insensitively', () => {
      const input = { id: 1, AUTH_TOKEN: 'abc', Password: 'hunter2' };
      const out = stripConnectionSecrets(input) as Record<string, unknown>;
      expect(out).toEqual({ id: 1 });
    });

    it('drops jwt, bearer, certificate, signing_key', () => {
      const input = {
        id: 1,
        jwt: 'x',
        bearer: 'y',
        certificate: 'z',
        signing_key: 'k',
      };
      expect(stripConnectionSecrets(input)).toEqual({ id: 1 });
    });
  });

  describe('suffix match', () => {
    it('drops keys ending in _token, _secret, _key, _password', () => {
      const input = {
        id: 1,
        api_secret_key: 'x',
        webhook_signature: 'y',
        my_token: 'z',
        admin_password: 'w',
      };
      expect(stripConnectionSecrets(input)).toEqual({ id: 1 });
    });

    it('keeps signing_key_algorithm (does not end in _key)', () => {
      const input = { id: 1, signing_key_algorithm: 'RS256' };
      expect(stripConnectionSecrets(input)).toEqual({ id: 1, signing_key_algorithm: 'RS256' });
    });

    it('drops signing_key (ends in _key)', () => {
      const input = { id: 1, signing_key: 'long-secret-stuff' };
      expect(stripConnectionSecrets(input)).toEqual({ id: 1 });
    });
  });

  describe('prefix match', () => {
    it('drops encrypted_* and hashed_*', () => {
      const input = {
        id: 1,
        encrypted_blob: 'abc',
        hashed_password: 'def',
        regular_field: 'kept',
      };
      expect(stripConnectionSecrets(input)).toEqual({ id: 1, regular_field: 'kept' });
    });
  });

  describe('value-shape guard', () => {
    it('drops innocent-keyed JWT strings', () => {
      const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_part_here_abc';
      const input = { id: 1, hint: jwt };
      const out = stripConnectionSecrets(input) as Record<string, unknown>;
      expect(out).toEqual({ id: 1 });
    });

    it('drops innocent-keyed long hex strings', () => {
      const hex = 'a'.repeat(40);
      const input = { id: 1, fingerprint: hex };
      const out = stripConnectionSecrets(input) as Record<string, unknown>;
      expect(out).toEqual({ id: 1 });
    });

    it('keeps ordinary URL strings (have colons/dots not in base64 alphabet)', () => {
      const input = { id: 1, instance_url: 'https://acme.my.salesforce.com/services/data/v62.0' };
      expect(stripConnectionSecrets(input)).toEqual(input);
    });

    it('keeps short opaque strings (under threshold)', () => {
      const input = { id: 1, sandbox_id: 'sbx_123' };
      expect(stripConnectionSecrets(input)).toEqual(input);
    });
  });

  describe('nested objects and arrays', () => {
    it('recurses into nested objects', () => {
      const input = {
        id: 1,
        auth: { client_id: 'public', client_secret: 'shh', expires_at: '2026-01-01' },
      };
      expect(stripConnectionSecrets(input)).toEqual({
        id: 1,
        auth: { client_id: 'public', expires_at: '2026-01-01' },
      });
      // Note: client_id is in the EXACT_KEYS denylist, so it gets stripped too.
    });

    it('recurses into arrays of objects', () => {
      const input = {
        id: 1,
        accounts: [
          { id: 'a', api_key: 'secret-a' },
          { id: 'b', api_key: 'secret-b' },
        ],
      };
      expect(stripConnectionSecrets(input)).toEqual({
        id: 1,
        accounts: [{ id: 'a' }, { id: 'b' }],
      });
    });

    it('preserves non-secret primitives', () => {
      expect(stripConnectionSecrets({ a: 1, b: true, c: null, d: 'short' })).toEqual({
        a: 1,
        b: true,
        c: null,
        d: 'short',
      });
    });
  });
});
```

- [ ] **Step 2: Run the tests — expect them to fail (file doesn't exist yet)**

```powershell
cd C:\Work\Personal\WorkatoMCP\app\chrome-extension
pnpm vitest run tests/workato/strip-secrets.test.ts
```

Expected: vitest reports the file's import target doesn't exist (`Failed to resolve import "...strip-secrets"`).

- [ ] **Step 3: Write the implementation**

Create `app/chrome-extension/entrypoints/background/tools/workato/strip-secrets.ts`:

```ts
/**
 * Strip auth material from a Workato connection response.
 *
 * Applied recursively to all nested objects/arrays. Drops:
 *   - Object keys matching an exact-name denylist (e.g. auth_token, password, jwt).
 *   - Object keys ending in known secret-suffixes (_token, _secret, _key, ...).
 *   - Object keys starting with known secret-prefixes (encrypted_, hashed_).
 *   - String values whose shape matches a known secret format (JWT, long hex,
 *     long opaque base64) — even when the key looks innocent.
 *
 * Stripped fields are REMOVED (not nulled/redacted) so agents can test
 * `key in obj` to detect their absence cleanly.
 */

const SECRET_EXACT_KEYS = new Set<string>([
  'auth_token',
  'refresh_token',
  'access_token',
  'oauth_token',
  'id_token',
  'client_secret',
  'client_id',
  'api_key',
  'api_secret',
  'private_key',
  'password',
  'passphrase',
  'secret',
  'signature',
  'signing_key',
  'jwt',
  'bearer',
  'session_token',
  'certificate',
  'cert',
  'encrypted_data',
  'ssh_key',
  'totp_secret',
  'mfa_secret',
]);

const SECRET_SUFFIXES = [
  '_token',
  '_secret',
  '_key',
  '_password',
  '_signature',
  '_credential',
  '_credentials',
  '_passphrase',
  '_cert',
  '_certificate',
  '_jwt',
  '_bearer',
  '_hash',
];

const SECRET_PREFIXES = ['encrypted_', 'hashed_'];

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HEX_RE = /^[A-Fa-f0-9]{40,}$/;
const BASE64ISH_RE = /^[A-Za-z0-9_+/=]{60,}$/;

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SECRET_EXACT_KEYS.has(lower)) return true;
  if (SECRET_SUFFIXES.some((s) => lower.endsWith(s))) return true;
  if (SECRET_PREFIXES.some((p) => lower.startsWith(p))) return true;
  return false;
}

function isSecretShapedString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return JWT_RE.test(value) || HEX_RE.test(value) || BASE64ISH_RE.test(value);
}

export function stripConnectionSecrets(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stripConnectionSecrets);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(k)) continue;
    if (typeof v === 'string' && isSecretShapedString(v)) continue;
    out[k] = stripConnectionSecrets(v);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests — expect all to pass**

```powershell
cd C:\Work\Personal\WorkatoMCP\app\chrome-extension
pnpm vitest run tests/workato/strip-secrets.test.ts
```

Expected: all 14 tests pass.

- [ ] **Step 5: Targeted typecheck**

```powershell
pnpm --filter chrome-mcp-server exec tsc --noEmit 2>&1 | Select-String "strip-secrets"
```

Expected: no matches (file is type-clean).

- [ ] **Step 6: Commit**

```powershell
git add app/chrome-extension/entrypoints/background/tools/workato/strip-secrets.ts app/chrome-extension/tests/workato/strip-secrets.test.ts
git commit -m "feat: add stripConnectionSecrets helper with denylist + value-shape guard"
```

---

## Task 3: Implement `buildSlimRecipe` / `buildSlimConnection` pure helpers (TDD)

**Files:**

- Create: `app/chrome-extension/entrypoints/background/tools/workato/slim-asset.ts`
- Create: `app/chrome-extension/tests/workato/slim-asset.test.ts`

Pure response-shaping helpers. Tests use real fixtures captured during endpoint research.

- [ ] **Step 1: Write the failing tests**

Create `app/chrome-extension/tests/workato/slim-asset.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildSlimRecipe,
  buildSlimConnection,
} from '../../entrypoints/background/tools/workato/slim-asset';

const RECIPE_FIXTURE = {
  asset_type: 'recipe',
  id: 72652236,
  folder_id: 28075001,
  project_id: 199094,
  name: 'Roman Testing of [SFDC] REC | Asset Base Creation (SID and SNR)',
  state: 'active',
  running: false,
  last_run_at: '2026-05-11T09:54:54.243-07:00',
  job_succeeded_count: 50,
  job_failed_count: 2,
  trigger_application: 'salesforce',
  trigger_business_object: 'new_custom_object',
  action_applications: ['salesforce', 'netsuite'],
  updated_at: '2026-05-11T11:58:11.414-07:00',
  created_at: '2026-04-22T10:00:00.000-07:00',
  tags: [],
  latest_activity: { event_type: 'updated', timestamp: '...', user_name: 'Roman' },
};

const CONNECTION_FIXTURE = {
  asset_type: 'connection',
  id: 14474811,
  folder_id: 19006924,
  project_id: 199094,
  name: '[SFDC] CONN | Avid SIT Sandbox',
  provider: 'salesforce',
  authorization_status: 'success',
  authorized_at: '2026-05-01T10:00:00.000-07:00',
  connection_lost_at: null,
  connection_lost_reason: null,
  recipe_count: 42,
  updated_at: '2026-05-06T06:41:05.974-07:00',
  latest_activity: { event_type: 'connection_connected', timestamp: '...', user_name: 'Roman' },
  tags: [],
};

describe('buildSlimRecipe', () => {
  it('extracts the 12 documented fields from a full recipe item', () => {
    const slim = buildSlimRecipe(RECIPE_FIXTURE);
    expect(slim).toEqual({
      id: 72652236,
      name: 'Roman Testing of [SFDC] REC | Asset Base Creation (SID and SNR)',
      folder_id: 28075001,
      project_id: 199094,
      running: false,
      state: 'active',
      last_run_at: '2026-05-11T09:54:54.243-07:00',
      job_succeeded_count: 50,
      job_failed_count: 2,
      trigger_application: 'salesforce',
      trigger_business_object: 'new_custom_object',
      action_applications: ['salesforce', 'netsuite'],
    });
  });

  it('falls back to sensible defaults for missing fields', () => {
    const slim = buildSlimRecipe({});
    expect(slim).toEqual({
      id: 0,
      name: '',
      folder_id: 0,
      project_id: 0,
      running: false,
      state: '',
      last_run_at: null,
      job_succeeded_count: 0,
      job_failed_count: 0,
      trigger_application: '',
      trigger_business_object: '',
      action_applications: [],
    });
  });

  it('preserves null last_run_at (never-run recipe)', () => {
    const slim = buildSlimRecipe({ ...RECIPE_FIXTURE, last_run_at: null });
    expect(slim.last_run_at).toBeNull();
  });

  it('coerces non-array action_applications to []', () => {
    const slim = buildSlimRecipe({ ...RECIPE_FIXTURE, action_applications: undefined });
    expect(slim.action_applications).toEqual([]);
  });
});

describe('buildSlimConnection', () => {
  it('extracts the 11 documented fields from a full connection item', () => {
    const slim = buildSlimConnection(CONNECTION_FIXTURE);
    expect(slim).toEqual({
      id: 14474811,
      name: '[SFDC] CONN | Avid SIT Sandbox',
      provider: 'salesforce',
      folder_id: 19006924,
      project_id: 199094,
      recipe_count: 42,
      authorization_status: 'success',
      authorized_at: '2026-05-01T10:00:00.000-07:00',
      connection_lost_at: null,
      connection_lost_reason: null,
      updated_at: '2026-05-06T06:41:05.974-07:00',
    });
  });

  it('falls back to sensible defaults for missing fields', () => {
    const slim = buildSlimConnection({});
    expect(slim).toEqual({
      id: 0,
      name: '',
      provider: '',
      folder_id: 0,
      project_id: 0,
      recipe_count: 0,
      authorization_status: '',
      authorized_at: null,
      connection_lost_at: null,
      connection_lost_reason: null,
      updated_at: '',
    });
  });

  it('preserves a lost-connection payload', () => {
    const slim = buildSlimConnection({
      ...CONNECTION_FIXTURE,
      authorization_status: 'failed',
      connection_lost_at: '2026-05-10T00:00:00.000-07:00',
      connection_lost_reason: 'token revoked',
    });
    expect(slim.authorization_status).toBe('failed');
    expect(slim.connection_lost_at).toBe('2026-05-10T00:00:00.000-07:00');
    expect(slim.connection_lost_reason).toBe('token revoked');
  });
});
```

- [ ] **Step 2: Run the tests — expect them to fail**

```powershell
cd C:\Work\Personal\WorkatoMCP\app\chrome-extension
pnpm vitest run tests/workato/slim-asset.test.ts
```

Expected: import-target-missing error.

- [ ] **Step 3: Write the implementation**

Create `app/chrome-extension/entrypoints/background/tools/workato/slim-asset.ts`:

```ts
/**
 * Pure helpers to shape recipe and connection list items into the v1.1 slim
 * shape. No I/O, no Chrome APIs — safe to unit-test with fixtures.
 *
 * Source: /web_api/mixed_assets.json items with asset_type=recipe or
 * asset_type=connection respectively. See spec §4.1, §4.2 and
 * docs/superpowers/specs/2026-05-12-v11-discovery-endpoints.md for the
 * full per-item shapes Workato returns.
 */

export interface RecipeListItem {
  id?: number;
  name?: string;
  folder_id?: number;
  project_id?: number;
  running?: boolean;
  state?: string;
  last_run_at?: string | null;
  job_succeeded_count?: number;
  job_failed_count?: number;
  trigger_application?: string;
  trigger_business_object?: string;
  action_applications?: string[];
  [k: string]: unknown;
}

export interface ConnectionListItem {
  id?: number;
  name?: string;
  provider?: string;
  folder_id?: number;
  project_id?: number;
  recipe_count?: number;
  authorization_status?: string;
  authorized_at?: string | null;
  connection_lost_at?: string | null;
  connection_lost_reason?: string | null;
  updated_at?: string;
  [k: string]: unknown;
}

export interface SlimRecipe {
  id: number;
  name: string;
  folder_id: number;
  project_id: number;
  running: boolean;
  state: string;
  last_run_at: string | null;
  job_succeeded_count: number;
  job_failed_count: number;
  trigger_application: string;
  trigger_business_object: string;
  action_applications: string[];
}

export interface SlimConnection {
  id: number;
  name: string;
  provider: string;
  folder_id: number;
  project_id: number;
  recipe_count: number;
  authorization_status: string;
  authorized_at: string | null;
  connection_lost_at: string | null;
  connection_lost_reason: string | null;
  updated_at: string;
}

export function buildSlimRecipe(item: RecipeListItem): SlimRecipe {
  return {
    id: Number(item.id ?? 0),
    name: String(item.name ?? ''),
    folder_id: Number(item.folder_id ?? 0),
    project_id: Number(item.project_id ?? 0),
    running: Boolean(item.running),
    state: String(item.state ?? ''),
    last_run_at: item.last_run_at ?? null,
    job_succeeded_count: Number(item.job_succeeded_count ?? 0),
    job_failed_count: Number(item.job_failed_count ?? 0),
    trigger_application: String(item.trigger_application ?? ''),
    trigger_business_object: String(item.trigger_business_object ?? ''),
    action_applications: Array.isArray(item.action_applications)
      ? item.action_applications.map(String)
      : [],
  };
}

export function buildSlimConnection(item: ConnectionListItem): SlimConnection {
  return {
    id: Number(item.id ?? 0),
    name: String(item.name ?? ''),
    provider: String(item.provider ?? ''),
    folder_id: Number(item.folder_id ?? 0),
    project_id: Number(item.project_id ?? 0),
    recipe_count: Number(item.recipe_count ?? 0),
    authorization_status: String(item.authorization_status ?? ''),
    authorized_at: item.authorized_at ?? null,
    connection_lost_at: item.connection_lost_at ?? null,
    connection_lost_reason: item.connection_lost_reason ?? null,
    updated_at: String(item.updated_at ?? ''),
  };
}
```

- [ ] **Step 4: Run the tests**

```powershell
cd C:\Work\Personal\WorkatoMCP\app\chrome-extension
pnpm vitest run tests/workato/slim-asset.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Targeted typecheck**

```powershell
pnpm --filter chrome-mcp-server exec tsc --noEmit 2>&1 | Select-String "slim-asset"
```

Expected: no matches.

- [ ] **Step 6: Commit**

```powershell
git add app/chrome-extension/entrypoints/background/tools/workato/slim-asset.ts app/chrome-extension/tests/workato/slim-asset.test.ts
git commit -m "feat: add buildSlimRecipe and buildSlimConnection pure helpers"
```

---

## Task 4: Implement `workato_search_recipes` tool

**Files:**

- Create: `app/chrome-extension/entrypoints/background/tools/workato/search-recipes.ts`

Tool class + in-page function. Mirrors v1's `pull-recipe.ts` structure.

- [ ] **Step 1: Write the implementation**

Create `app/chrome-extension/entrypoints/background/tools/workato/search-recipes.ts`:

```ts
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';
import { buildSlimRecipe, type RecipeListItem } from './slim-asset';

interface SearchRecipesArgs {
  text?: string;
  folder_id?: number;
  page?: number;
  sort?: 'latest_activity' | 'name' | 'updated_at' | 'created_at';
  full?: boolean;
}

interface RawSearchResponse {
  result?: {
    items?: unknown[];
    count?: number;
    page?: number;
    per_page?: number;
  };
}

interface InPageResult {
  ok: boolean;
  raw?: RawSearchResponse;
  failure?: {
    stage: 'search' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

/**
 * Runs in the Workato tab's MAIN world. Plain function returning a Promise
 * chain — DO NOT add async/await (see workato/csrf.ts comment + v1 pitfalls).
 */
function searchRecipesInPage(
  text: string,
  folderId: number | null,
  page: number,
  sort: string,
): Promise<InPageResult> {
  const params = new URLSearchParams();
  params.set('asset_type', 'recipe');
  params.set('sort_term', sort);
  params.set('page', String(page));
  if (text) params.set('text', text);
  if (folderId !== null) params.set('folder_id', String(folderId));
  const url = `/web_api/mixed_assets.json?${params.toString()}`;
  const fetchOpts: RequestInit = {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  };

  return fetch(url, fetchOpts).then((r) =>
    r.text().then((bodyText) => {
      if (r.status < 200 || r.status >= 300) {
        return {
          ok: false,
          failure: {
            stage: 'search' as const,
            status: r.status,
            body_excerpt: bodyText.slice(0, 1024),
            message: `GET ${url} returned HTTP ${r.status}`,
          },
        };
      }
      let json: unknown = null;
      try {
        json = JSON.parse(bodyText);
      } catch (e) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 1024),
            message: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        };
      }
      const result = (json as RawSearchResponse).result;
      if (!result || !Array.isArray(result.items)) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 1024),
            message: 'Unexpected response shape — missing result.items array.',
          },
        };
      }
      return { ok: true, raw: json as RawSearchResponse };
    }),
  );
}

class WorkatoSearchRecipesTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.SEARCH_RECIPES;

  async execute(args: SearchRecipesArgs): Promise<ToolResult> {
    try {
      const text = typeof args?.text === 'string' ? args.text : '';
      const folderId =
        typeof args?.folder_id === 'number' && Number.isFinite(args.folder_id)
          ? args.folder_id
          : null;
      const page =
        typeof args?.page === 'number' && Number.isFinite(args.page) && args.page >= 1
          ? Math.floor(args.page)
          : 1;
      const sort = args?.sort ?? 'latest_activity';
      const full = args?.full === true;

      const tab = await findWorkatoTab();
      const result = await runInWorkatoTab(tab.tabId, searchRecipesInPage, [
        text,
        folderId,
        page,
        sort,
      ]);

      if (!result.ok) {
        return createErrorResponse(
          `WorkatoApiError (${result.failure?.stage}): ${result.failure?.message}` +
            (result.failure?.body_excerpt
              ? `\n--- body excerpt ---\n${result.failure.body_excerpt}`
              : ''),
        );
      }

      const raw = result.raw!.result!;
      const payload = full
        ? raw
        : {
            count: Number(raw.count ?? 0),
            page: Number(raw.page ?? page),
            per_page: Number(raw.per_page ?? 20),
            recipes: (raw.items ?? []).map((item) => buildSlimRecipe(item as RecipeListItem)),
          };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_search_recipes failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoSearchRecipesTool = new WorkatoSearchRecipesTool();
```

- [ ] **Step 2: Targeted typecheck**

```powershell
pnpm --filter chrome-mcp-server exec tsc --noEmit 2>&1 | Select-String "search-recipes"
```

Expected: no matches.

- [ ] **Step 3: Verify bundler emits a plain function (not `_searchRecipesInPage`)**

After build, this verification is in Task 8 (after registration). For now, the source code uses `function searchRecipesInPage(...)` not `async function`, which matches the v1-validated pattern.

- [ ] **Step 4: Commit**

```powershell
git add app/chrome-extension/entrypoints/background/tools/workato/search-recipes.ts
git commit -m "feat: implement workato_search_recipes tool"
```

---

## Task 5: Implement `workato_search_connections` tool

**Files:**

- Create: `app/chrome-extension/entrypoints/background/tools/workato/search-connections.ts`

Near-identical structure to Task 4, with `asset_type=connection` and `buildSlimConnection`.

- [ ] **Step 1: Write the implementation**

Create `app/chrome-extension/entrypoints/background/tools/workato/search-connections.ts`:

```ts
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';
import { buildSlimConnection, type ConnectionListItem } from './slim-asset';

interface SearchConnectionsArgs {
  text?: string;
  folder_id?: number;
  page?: number;
  sort?: 'latest_activity' | 'name' | 'updated_at';
  full?: boolean;
}

interface RawSearchResponse {
  result?: {
    items?: unknown[];
    count?: number;
    page?: number;
    per_page?: number;
  };
}

interface InPageResult {
  ok: boolean;
  raw?: RawSearchResponse;
  failure?: {
    stage: 'search' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

function searchConnectionsInPage(
  text: string,
  folderId: number | null,
  page: number,
  sort: string,
): Promise<InPageResult> {
  const params = new URLSearchParams();
  params.set('asset_type', 'connection');
  params.set('sort_term', sort);
  params.set('page', String(page));
  if (text) params.set('text', text);
  if (folderId !== null) params.set('folder_id', String(folderId));
  const url = `/web_api/mixed_assets.json?${params.toString()}`;
  const fetchOpts: RequestInit = {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  };

  return fetch(url, fetchOpts).then((r) =>
    r.text().then((bodyText) => {
      if (r.status < 200 || r.status >= 300) {
        return {
          ok: false,
          failure: {
            stage: 'search' as const,
            status: r.status,
            body_excerpt: bodyText.slice(0, 1024),
            message: `GET ${url} returned HTTP ${r.status}`,
          },
        };
      }
      let json: unknown = null;
      try {
        json = JSON.parse(bodyText);
      } catch (e) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 1024),
            message: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        };
      }
      const result = (json as RawSearchResponse).result;
      if (!result || !Array.isArray(result.items)) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 1024),
            message: 'Unexpected response shape — missing result.items array.',
          },
        };
      }
      return { ok: true, raw: json as RawSearchResponse };
    }),
  );
}

class WorkatoSearchConnectionsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.SEARCH_CONNECTIONS;

  async execute(args: SearchConnectionsArgs): Promise<ToolResult> {
    try {
      const text = typeof args?.text === 'string' ? args.text : '';
      const folderId =
        typeof args?.folder_id === 'number' && Number.isFinite(args.folder_id)
          ? args.folder_id
          : null;
      const page =
        typeof args?.page === 'number' && Number.isFinite(args.page) && args.page >= 1
          ? Math.floor(args.page)
          : 1;
      const sort = args?.sort ?? 'latest_activity';
      const full = args?.full === true;

      const tab = await findWorkatoTab();
      const result = await runInWorkatoTab(tab.tabId, searchConnectionsInPage, [
        text,
        folderId,
        page,
        sort,
      ]);

      if (!result.ok) {
        return createErrorResponse(
          `WorkatoApiError (${result.failure?.stage}): ${result.failure?.message}` +
            (result.failure?.body_excerpt
              ? `\n--- body excerpt ---\n${result.failure.body_excerpt}`
              : ''),
        );
      }

      const raw = result.raw!.result!;
      const payload = full
        ? raw
        : {
            count: Number(raw.count ?? 0),
            page: Number(raw.page ?? page),
            per_page: Number(raw.per_page ?? 20),
            connections: (raw.items ?? []).map((item) =>
              buildSlimConnection(item as ConnectionListItem),
            ),
          };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_search_connections failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoSearchConnectionsTool = new WorkatoSearchConnectionsTool();
```

- [ ] **Step 2: Targeted typecheck**

```powershell
pnpm --filter chrome-mcp-server exec tsc --noEmit 2>&1 | Select-String "search-connections"
```

Expected: no matches.

- [ ] **Step 3: Commit**

```powershell
git add app/chrome-extension/entrypoints/background/tools/workato/search-connections.ts
git commit -m "feat: implement workato_search_connections tool"
```

---

## Task 6: Implement `workato_get_connection` tool

**Files:**

- Create: `app/chrome-extension/entrypoints/background/tools/workato/get-connection.ts`

Fetches `/connections/<id>.json` (legacy route, NOT under `/web_api/`), runs `stripConnectionSecrets` on the response, and composes a slim metadata+config shape.

- [ ] **Step 1: Write the implementation**

Create `app/chrome-extension/entrypoints/background/tools/workato/get-connection.ts`:

```ts
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';
import { stripConnectionSecrets } from './strip-secrets';

interface GetConnectionArgs {
  connection_id: number;
  full?: boolean;
}

interface InPageResult {
  ok: boolean;
  raw?: { result?: Record<string, unknown> };
  failure?: {
    stage: 'fetch' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

function getConnectionInPage(connectionId: number): Promise<InPageResult> {
  const url = `/connections/${connectionId}.json`;
  const fetchOpts: RequestInit = {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  };

  return fetch(url, fetchOpts).then((r) =>
    r.text().then((bodyText) => {
      if (r.status < 200 || r.status >= 300) {
        return {
          ok: false,
          failure: {
            stage: 'fetch' as const,
            status: r.status,
            body_excerpt: bodyText.slice(0, 1024),
            message: `GET ${url} returned HTTP ${r.status}`,
          },
        };
      }
      let json: unknown = null;
      try {
        json = JSON.parse(bodyText);
      } catch (e) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 1024),
            message: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        };
      }
      const result = (json as { result?: Record<string, unknown> }).result;
      if (!result || typeof result !== 'object') {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 1024),
            message: 'Unexpected response shape — missing result object.',
          },
        };
      }
      return { ok: true, raw: { result } };
    }),
  );
}

const SLIM_KEYS = [
  'id',
  'name',
  'provider',
  'folder_id',
  'project_id',
  'recipe_count',
  'authorization_status',
  'authorized_at',
  'connection_lost_at',
  'connection_lost_reason',
  'created_at',
  'updated_at',
] as const;

class WorkatoGetConnectionTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.GET_CONNECTION;

  async execute(args: GetConnectionArgs): Promise<ToolResult> {
    try {
      if (typeof args?.connection_id !== 'number' || !Number.isFinite(args.connection_id)) {
        return createErrorResponse('Param [connection_id] must be a finite number');
      }
      const full = args?.full === true;

      const tab = await findWorkatoTab();
      const result = await runInWorkatoTab(tab.tabId, getConnectionInPage, [args.connection_id]);

      if (!result.ok) {
        return createErrorResponse(
          `WorkatoApiError (${result.failure?.stage}): ${result.failure?.message}` +
            (result.failure?.body_excerpt
              ? `\n--- body excerpt ---\n${result.failure.body_excerpt}`
              : ''),
        );
      }

      // Strip secrets BEFORE either slim or full shaping. No escape hatch.
      const stripped = stripConnectionSecrets(result.raw!.result) as Record<string, unknown>;

      let payload: Record<string, unknown>;
      if (full) {
        payload = stripped;
      } else {
        const slim: Record<string, unknown> = {};
        for (const key of SLIM_KEYS) {
          if (key in stripped) slim[key] = stripped[key];
        }
        const config: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(stripped)) {
          if (!(SLIM_KEYS as readonly string[]).includes(k)) {
            config[k] = v;
          }
        }
        slim.config = config;
        payload = slim;
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_get_connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoGetConnectionTool = new WorkatoGetConnectionTool();
```

- [ ] **Step 2: Targeted typecheck**

```powershell
pnpm --filter chrome-mcp-server exec tsc --noEmit 2>&1 | Select-String "get-connection"
```

Expected: no matches.

- [ ] **Step 3: Commit**

```powershell
git add app/chrome-extension/entrypoints/background/tools/workato/get-connection.ts
git commit -m "feat: implement workato_get_connection with mandatory secret strip"
```

---

## Task 7: Implement `workato_list_jobs` tool with cursor auto-walk

**Files:**

- Create: `app/chrome-extension/entrypoints/background/tools/workato/list-jobs.ts`

The most complex of the four — handles cursor pagination via Workato's `offset_job_id` mechanism, auto-walks under the hood up to `limit` (max 100), and surfaces a `next_cursor` when more pages remain.

- [ ] **Step 1: Write the implementation**

Create `app/chrome-extension/entrypoints/background/tools/workato/list-jobs.ts`:

```ts
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';

interface ListJobsArgs {
  recipe_id: number;
  limit?: number;
  status?: string;
  query?: string;
  started_at?: string;
  group_by_master_job?: boolean;
  cursor?: string;
  full?: boolean;
}

interface RawJobsPage {
  job_count?: number;
  job_scope_count?: number;
  job_succeeded_count?: number;
  job_failed_count?: number;
  job_offset_count?: number;
  job_per_page?: number;
  jobs?: Array<Record<string, unknown>>;
}

interface InPageResult {
  ok: boolean;
  pages?: RawJobsPage[];
  failure?: {
    stage: 'meta' | 'page' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

const PER_PAGE = 25;
const HARD_CAP = 100;

/**
 * In-page function. Plain function returning a Promise chain — DO NOT add
 * async/await. Recurses via .then() to walk pages until limit reached.
 */
function listJobsInPage(
  recipeId: number,
  limit: number,
  status: string | null,
  query: string | null,
  startedAt: string | null,
  groupByMaster: boolean,
  startCursor: string | null,
): Promise<InPageResult> {
  function buildUrl(cursor: string | null): string {
    const params = new URLSearchParams();
    params.set('per_page', String(PER_PAGE));
    if (cursor) {
      params.set('offset_job_id', cursor);
      params.set('prev', 'false');
    }
    if (status) params.set('status', status);
    if (query) params.set('query', query);
    if (startedAt) params.set('started_at', startedAt);
    if (groupByMaster) params.set('group_by_master_job', 'true');
    return `/web_api/recipes/${recipeId}/jobs.json?${params.toString()}`;
  }

  const fetchOpts: RequestInit = {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  };

  function fetchPage(
    cursor: string | null,
  ): Promise<{ ok: true; page: RawJobsPage } | { ok: false; failure: InPageResult['failure'] }> {
    const url = buildUrl(cursor);
    return fetch(url, fetchOpts).then((r) =>
      r.text().then((bodyText) => {
        if (r.status < 200 || r.status >= 300) {
          return {
            ok: false as const,
            failure: {
              stage: 'page' as const,
              status: r.status,
              body_excerpt: bodyText.slice(0, 1024),
              message: `GET ${url} returned HTTP ${r.status}`,
            },
          };
        }
        let json: RawJobsPage;
        try {
          json = JSON.parse(bodyText) as RawJobsPage;
        } catch (e) {
          return {
            ok: false as const,
            failure: {
              stage: 'shape' as const,
              body_excerpt: bodyText.slice(0, 1024),
              message: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
            },
          };
        }
        if (!Array.isArray(json.jobs)) {
          return {
            ok: false as const,
            failure: {
              stage: 'shape' as const,
              body_excerpt: bodyText.slice(0, 1024),
              message: 'Unexpected response shape — missing jobs array.',
            },
          };
        }
        return { ok: true as const, page: json };
      }),
    );
  }

  function loop(cursor: string | null, pagesAcc: RawJobsPage[]): Promise<InPageResult> {
    return fetchPage(cursor).then((res) => {
      if (!res.ok) {
        // First-page failure is 'meta' stage (no pages collected yet).
        const failure = res.failure!;
        if (pagesAcc.length === 0 && failure.stage === 'page') {
          failure.stage = 'meta';
        }
        return { ok: false, failure };
      }
      const pages = pagesAcc.concat(res.page);
      const collected = pages.reduce((n, p) => n + (p.jobs?.length ?? 0), 0);
      const reachedLimit = collected >= limit;
      const lastPage = (res.page.jobs?.length ?? 0) < PER_PAGE;
      const reachedCap = collected >= HARD_CAP;
      if (reachedLimit || lastPage || reachedCap) {
        return { ok: true, pages };
      }
      const lastJob = res.page.jobs![res.page.jobs!.length - 1];
      const nextCursor = lastJob && typeof lastJob.id === 'string' ? lastJob.id : null;
      if (!nextCursor) return { ok: true, pages };
      return loop(nextCursor, pages);
    });
  }

  return loop(startCursor, []);
}

interface SlimJob {
  id: string;
  status: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  error_summary?: string;
  error_line_number?: number;
  title: string;
  report: { col_0: string; col_1: string; col_2: string };
}

function shapeSlimJob(raw: Record<string, unknown>): SlimJob {
  const started = String(raw.started_at ?? '');
  const completed = String(raw.completed_at ?? '');
  const rawDuration =
    started && completed ? new Date(completed).getTime() - new Date(started).getTime() : 0;
  const duration_ms = Number.isFinite(rawDuration) ? rawDuration : 0;
  const err = raw.error as Record<string, unknown> | undefined;
  const report = (raw.report as Record<string, unknown> | undefined) ?? {};
  return {
    id: String(raw.id ?? ''),
    status: String(raw.status ?? 'unknown'),
    started_at: started,
    completed_at: completed,
    duration_ms,
    error_summary: err?.message ? String(err.message) : undefined,
    error_line_number: typeof err?.line_number === 'number' ? err.line_number : undefined,
    title: String(raw.title ?? ''),
    report: {
      col_0: String(report.custom_column_0 ?? ''),
      col_1: String(report.custom_column_1 ?? ''),
      col_2: String(report.custom_column_2 ?? ''),
    },
  };
}

class WorkatoListJobsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.LIST_JOBS;

  async execute(args: ListJobsArgs): Promise<ToolResult> {
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse('Param [recipe_id] must be a finite number');
      }
      const limit =
        typeof args?.limit === 'number' && Number.isFinite(args.limit) && args.limit >= 1
          ? Math.min(Math.floor(args.limit), 100)
          : 25;
      const status = typeof args?.status === 'string' && args.status ? args.status : null;
      const query = typeof args?.query === 'string' && args.query ? args.query : null;
      const startedAt =
        typeof args?.started_at === 'string' && args.started_at ? args.started_at : null;
      const groupByMaster = args?.group_by_master_job === true;
      const cursor = typeof args?.cursor === 'string' && args.cursor ? args.cursor : null;
      const full = args?.full === true;

      const tab = await findWorkatoTab();
      const result = await runInWorkatoTab(tab.tabId, listJobsInPage, [
        args.recipe_id,
        limit,
        status,
        query,
        startedAt,
        groupByMaster,
        cursor,
      ]);

      if (!result.ok) {
        return createErrorResponse(
          `WorkatoApiError (${result.failure?.stage}): ${result.failure?.message}` +
            (result.failure?.body_excerpt
              ? `\n--- body excerpt ---\n${result.failure.body_excerpt}`
              : ''),
        );
      }

      const pages = result.pages!;
      const allJobs: Array<Record<string, unknown>> = [];
      for (const p of pages) {
        for (const j of p.jobs ?? []) allJobs.push(j);
      }
      // Truncate to limit (in case the last page overshot).
      const trimmedJobs = allJobs.slice(0, limit);
      const lastPage = pages[pages.length - 1] ?? {};
      const meta = {
        total: Number(lastPage.job_count ?? 0),
        scope: Number(lastPage.job_scope_count ?? 0),
        succeeded: Number(lastPage.job_succeeded_count ?? 0),
        failed: Number(lastPage.job_failed_count ?? 0),
      };
      // Compute next_cursor only when more remains (scope > collected and last page was full).
      const collected = trimmedJobs.length;
      const lastPageJobs = lastPage.jobs ?? [];
      const lastPageFull = lastPageJobs.length >= PER_PAGE;
      const moreRemains = meta.scope > collected && lastPageFull;
      const lastJobId =
        moreRemains && trimmedJobs.length > 0
          ? String(trimmedJobs[trimmedJobs.length - 1]?.id ?? '')
          : '';
      const nextCursor = moreRemains && lastJobId ? lastJobId : undefined;

      const payload = full
        ? { ...meta, next_cursor: nextCursor, pages, jobs: trimmedJobs }
        : {
            ...meta,
            next_cursor: nextCursor,
            jobs: trimmedJobs.map(shapeSlimJob),
          };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_list_jobs failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoListJobsTool = new WorkatoListJobsTool();
```

- [ ] **Step 2: Targeted typecheck**

```powershell
pnpm --filter chrome-mcp-server exec tsc --noEmit 2>&1 | Select-String "list-jobs"
```

Expected: no matches.

- [ ] **Step 3: Commit**

```powershell
git add app/chrome-extension/entrypoints/background/tools/workato/list-jobs.ts
git commit -m "feat: implement workato_list_jobs with cursor auto-walk up to limit"
```

---

## Task 8: Register the four new tools in the workato barrel + verify build

**Files:**

- Modify: `app/chrome-extension/entrypoints/background/tools/workato/index.ts`

The upstream `tools/index.ts` already spreads `...workatoTools` (from v1's Task 9). All we add here are the four new re-exports.

- [ ] **Step 1: Modify the barrel**

Open `app/chrome-extension/entrypoints/background/tools/workato/index.ts`. It currently reads:

```ts
export { workatoPullRecipeTool } from './pull-recipe';
export { workatoJobTraceTool } from './job-trace';
```

Change to:

```ts
export { workatoPullRecipeTool } from './pull-recipe';
export { workatoJobTraceTool } from './job-trace';
export { workatoSearchRecipesTool } from './search-recipes';
export { workatoSearchConnectionsTool } from './search-connections';
export { workatoGetConnectionTool } from './get-connection';
export { workatoListJobsTool } from './list-jobs';
```

- [ ] **Step 2: Build the shared package + extension**

```powershell
cd C:\Work\Personal\WorkatoMCP
pnpm build:shared
pnpm build:extension
```

Expected: shared package builds; extension builds via WXT to `app/chrome-extension/.output/chrome-mv3/`. No errors related to Workato code.

- [ ] **Step 3: CRITICAL — verify the bundler emits plain functions, not `_<name>` wrappers**

This is the v1 pitfall that bit us before (commit `efef944`). Run:

```powershell
Select-String -Path "app/chrome-extension/.output/chrome-mv3/background.js" -Pattern "_searchRecipesInPage|_searchConnectionsInPage|_getConnectionInPage|_listJobsInPage"
```

Expected: **no matches**. If any match appears, the bundler transpiled an async function declaration into a wrapper that won't survive serialization — the source file must contain a plain `function name(...)`, not `async function name(...)`.

If matches appear: open the source file, find any `async function` you wrote inadvertently, change it to `function` + `Promise.then()` chain. Rebuild.

Then verify the plain functions ARE present:

```powershell
Select-String -Path "app/chrome-extension/.output/chrome-mv3/background.js" -Pattern "function searchRecipesInPage|function searchConnectionsInPage|function getConnectionInPage|function listJobsInPage"
```

Expected: exactly 4 matches (one per function).

- [ ] **Step 4: Commit**

```powershell
git add app/chrome-extension/entrypoints/background/tools/workato/index.ts
git commit -m "feat: register v1.1 discovery tools in extension barrel"
```

---

## Task 9: Stub future write tool (create-connection)

**Files:**

- Create: `app/chrome-extension/entrypoints/background/tools/workato/create-connection.stub.ts`

Documentation-only file. Not exported from the barrel, not registered. Matches v1's approach (`push-recipe.stub.ts` etc.).

- [ ] **Step 1: Write the stub**

Create `app/chrome-extension/entrypoints/background/tools/workato/create-connection.stub.ts`:

```ts
/**
 * PLANNED v1.2+ — NOT WIRED, NOT REGISTERED.
 *
 * workato_create_connection — POST /connections.json
 *
 * Body shape (reverse-engineer before implementing):
 *   {
 *     "connection": {
 *       "name": "<display name>",
 *       "provider": "<adapter id, e.g. 'salesforce', 'netsuite'>",
 *       "folder_id": <int>,
 *       "input": { ...per-provider config + auth params... }
 *     }
 *   }
 *
 * Headers: content-type: application/json; charset=utf-8,
 *          x-csrf-token: <decoded XSRF-TOKEN-V2 — see csrf.ts>,
 *          x-requested-with: XMLHttpRequest.
 *
 * Safety rules to enforce in code:
 *
 *   1. NEVER LOG OR ECHO THE INPUT BLOB — it contains the user's
 *      credentials. The tool's success response must report only
 *      the new connection id + provider, NOT what was sent.
 *   2. RESPONSE SECRET-STRIPPING — apply stripConnectionSecrets()
 *      (see ./strip-secrets.ts) to the creation response before
 *      returning. Workato may echo back the auth params; agents
 *      must not see them.
 *   3. PROVIDER VALIDATION — Workato accepts any provider string
 *      but invalid ones produce confusing 422s. Maintain an
 *      allowlist of verified providers (start with the 10 seen in
 *      v1.1 reverse-engineering: salesforce, netsuite, sftp, sap,
 *      pgp, rest, onprem_files, azure_blob_storage, steelbrick,
 *      workato_app) and reject unknowns with a clear error.
 *
 * Failure modes:
 *   - 401/403 → session expired; user must re-auth.
 *   - 422 → invalid input shape; surface the validation errors verbatim.
 *
 * Open questions before implementation:
 *   - Does Workato echo the auth_token in the create response?
 *   - Is there a separate `/connections/<id>/authorize` step for OAuth
 *     providers, or does the create response include the auth URL?
 */
export const PLANNED_CREATE_CONNECTION_NOTES = true;
```

- [ ] **Step 2: Verify the stub is unreachable**

Use Grep to confirm only the stub itself references `PLANNED_CREATE_CONNECTION_NOTES`:

```powershell
Get-ChildItem -Recurse -Include *.ts app/, packages/ |
  Where-Object { $_.Name -notlike '*.stub.ts' } |
  Select-String -Pattern 'PLANNED_CREATE_CONNECTION_NOTES'
```

Expected: zero matches (no non-stub file references the constant).

- [ ] **Step 3: Targeted typecheck**

```powershell
pnpm --filter chrome-mcp-server exec tsc --noEmit 2>&1 | Select-String "create-connection"
```

Expected: no matches.

- [ ] **Step 4: Commit**

```powershell
git add app/chrome-extension/entrypoints/background/tools/workato/create-connection.stub.ts
git commit -m "docs: capture planned workato_create_connection endpoint as stub"
```

---

## Task 10: Update README with v1.1 tools and smoke test checklist

**Files:**

- Modify: `README.md`

Append the four new tools to the v1 tool list, document the per-tool input/output shapes, and add a v1.1 manual smoke test section to the existing checklist.

- [ ] **Step 1: Read the current README to find the right insertion points**

Open `README.md`. Locate the section heading `## v1 tools` and the section `## Manual smoke test`. New content slots in below the v1 entries and below the v1 smoke list.

- [ ] **Step 2: Update the v1 tools section heading**

Change `## v1 tools` to `## v1 tools (shipped)` and add a new section `## v1.1 tools (shipped)` right after the existing `workato_job_trace` block. Content of the new section:

```markdown
## v1.1 tools (shipped)

All four are read-only, all return a slim shape by default with `full: true` for raw, all require an open Workato tab.

### `workato_search_recipes`
```

input: { text?, folder_id?, page?, sort?, full? }
output: { count, page, per_page: 20, recipes: [{ id, name, folder_id, project_id, running, state, last_run_at, job_succeeded_count, job_failed_count, trigger_application, trigger_business_object, action_applications }] }

```

Workato caps pagination at 20 items/page server-side. Step through with `page: N`.

### `workato_search_connections`

```

input: { text?, folder_id?, page?, sort?, full? }
output: { count, page, per_page: 20, connections: [{ id, name, provider, folder_id, project_id, recipe_count, authorization_status, authorized_at, connection_lost_at, connection_lost_reason, updated_at }] }

```

`text=` matches connection NAMES, not the `provider` field. For "all my Salesforce connections" search by name pattern (e.g. "SFDC") or page through and filter client-side.

### `workato_get_connection`

```

input: { connection_id, full? }
output: { id, name, provider, folder_id, project_id, recipe_count, authorization_status, authorized_at, connection_lost_at, connection_lost_reason, created_at, updated_at, config: <per-provider config with secret-shaped keys stripped> }

```

**Auth material is always stripped, including under `full: true`.** Agents that need a token must reuse the user's existing session (in-tab fetch via this MCP), not extract one from this tool.

### `workato_list_jobs`

```

input: { recipe_id, limit?, status?, query?, started_at?, group_by_master_job?, cursor?, full? }
output: { total, scope, succeeded, failed, next_cursor?, jobs: [{ id, status, started_at, completed_at, duration_ms, error_summary?, error_line_number?, title, report: { col_0, col_1, col_2 } }] }

```

Tool auto-walks Workato's cursor pagination under the hood up to `limit` (default 25, max 100). For more results, pass `cursor: <prev next_cursor>`. Server-side filters: singular `status` (`failed`/`succeeded`/etc.), `query` (full-text against title and error), `started_at` window, `group_by_master_job`.
```

- [ ] **Step 3: Extend the manual smoke test section**

Find `## Manual smoke test` in the README. Append a new sub-section right after the existing v1 smoke steps:

```markdown
### v1.1 smoke test additions

Run after the v1 smoke test passes:

7. **search_recipes by name** — `workato_search_recipes({ text: "<a known recipe name>" })` → verify `count >= 1`, slim shape includes the recipe id you expected.
8. **search_recipes pagination** — `workato_search_recipes({})` then `workato_search_recipes({ page: 2 })` → verify the two pages have distinct first ids.
9. **search_connections** — `workato_search_connections({ text: "salesforce" })` → verify all matches have `provider === 'salesforce'` OR a name containing "salesforce"/"sfdc" (text matches the name, not the provider).
10. **get_connection metadata** — `workato_get_connection({ connection_id: <known id> })` → verify slim shape has the documented metadata fields plus `config`. Critically, **grep the output for any value matching `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`** (JWT shape), `^[A-Fa-f0-9]{40,}$` (long hex), or `^[A-Za-z0-9_+/=]{60,}$` (long opaque base64). **Expected: zero matches.**
11. **get_connection with full=true** — `workato_get_connection({ connection_id: <known id>, full: true })` → repeat the secret-shaped-value grep. Still zero matches. The strip applies in full mode.
12. **list_jobs default** — `workato_list_jobs({ recipe_id: <known id> })` → verify returns up to 25 jobs, `total` matches lifetime count, `next_cursor` set if more remain.
13. **list_jobs auto-walk** — `workato_list_jobs({ recipe_id: <known id>, limit: 50 })` → verify exactly 50 jobs returned (tool walked 2 internal pages of 25).
14. **list_jobs status filter** — `workato_list_jobs({ recipe_id: <known id>, status: "failed" })` → verify `scope < total` and only `status: "failed"` jobs returned.
15. **list_jobs cursor resume** — call `workato_list_jobs({ recipe_id, limit: 25 })`, take its `next_cursor`, then `workato_list_jobs({ recipe_id, limit: 25, cursor: <that> })` → verify the second call returns the next 25 jobs (distinct ids from the first call).
16. **Provider denylist audit** — for each adapter present in your workspace (run `workato_search_connections({ sort: 'updated_at' })` and collect distinct `provider` values), call `workato_get_connection({ connection_id: <one id per provider> })` and run the secret-shape grep from step 10. Zero matches across all providers.
```

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: document v1.1 tools and add smoke test checklist"
```

---

## Task 11: Manual end-to-end smoke test

This is not code — it's the human verification gate before v1.1 is considered shipped. The user (Roman) runs this in a real Chrome tab against a real Workato workspace.

**Prerequisites:** v1 already installed and working from earlier (extension loaded at `app/chrome-extension/.output/chrome-mv3`, bridge running, MCP client registered at `http://127.0.0.1:12306/mcp`, Workato tab open and signed in).

- [ ] **Step 1: Clean rebuild**

```powershell
cd C:\Work\Personal\WorkatoMCP
pnpm clean:dist
pnpm build
```

Expected: shared, native, extension all build cleanly.

- [ ] **Step 2: Reload the extension in Chrome**

`chrome://extensions/` → find "Chrome MCP Server" → click the circular reload icon. Then click the toolbar icon and confirm **Service Running (Port: 12306)**. If Disconnected, click Connect.

- [ ] **Step 3: Reload the MCP client**

In Claude Code: `/reload-plugins`, then restart the session if needed so the new tool schemas (`workato_search_recipes`, `workato_search_connections`, `workato_get_connection`, `workato_list_jobs`) are visible as `mcp__workato__*`.

- [ ] **Step 4: Run the README smoke checklist (v1.1 section)**

Execute each step (7-16) in the README's smoke test checklist. Pay particular attention to the secret-shape grep audit in steps 10, 11, and 16 — those gate the secret-strip guarantee for `workato_get_connection`.

- [ ] **Step 5: If everything passes, push and tag**

```powershell
git push origin master
git tag v1.1.0
git push origin v1.1.0
```

- [ ] **Step 6: Update the v1.1 direction memory to mark shipped**

Edit `C:\Users\Kiba0\.claude\projects\C--Work-Personal-WorkatoMCP\memory\project_v11_direction.md` — change `**v1.1 direction (user-stated, not yet brainstormed)**` heading to `**v1.1 status:** Shipped <date>. Tools landed: search_recipes, search_connections, get_connection, list_jobs.`

---

## Out of scope (do NOT add to v1.1)

These come up naturally during implementation. Resist:

- Write tools (push_recipe, run_soql, schema_derive, create_connection). Stubs only.
- Per-provider typed config schemas for `get_connection` — denylist suffices for v1.1.
- Project / folder listing tools. Adjacent but not on the critical path.
- Server-side state/provider filters — Workato doesn't expose them; agents filter client-side.
- Auto-walk for searches — agents step pages explicitly with `page=`.
- Rebranding upstream `chrome-mcp-*` package names. Adds rebase pain for no v1.1 user-visible benefit.
- Chrome Web Store packaging. Same call as v1 — load-unpacked only.
