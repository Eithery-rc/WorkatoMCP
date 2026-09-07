/**
 * @fileoverview The lookup-table, data-table and workflow-app write tools now
 * verify the bridge-injected `expected_context` before they touch anything.
 *
 * Two things are pinned here: the guard itself (a no-op without an
 * expected_context, ContextMismatch on a mismatch), and that each write handler
 * actually calls it, because a guard nobody invokes is worse than no guard: it
 * reads as covered.
 *
 * The chrome mock follows session-context.test.ts: one Workato tab (id 42) in
 * workspace 5150 / production, with the in-page read stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertExpectedContext,
  invalidateTabContext,
  resetSessionContextInvalidationForTests,
} from '@/entrypoints/background/tools/workato/session-context';
import {
  WorkatoLookupTableRowCreateTool,
  WorkatoLookupTableDeleteTool,
} from '@/entrypoints/background/tools/workato-lookup/handlers';
import {
  WorkatoDataTableRowUpdateTool,
  WorkatoDataTableDeleteTool,
} from '@/entrypoints/background/tools/workato-data-table/handlers';
import { workatoLcapPageDeleteTool } from '@/entrypoints/background/tools/workato-lcap/handlers';

/** The workspace the mocked tab 42 is actually signed in to. */
const ACTUAL = { workspace_id: 5150, workspace_name: 'Acme prod', environment: 'production' };

/** A context the tab does NOT match. */
const OTHER_WORKSPACE = { workspace_id: 9999, environment: 'production' };

let executeScript: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invalidateTabContext();
  resetSessionContextInvalidationForTests();
  executeScript = vi.fn(async () => [
    {
      result: {
        ok: true,
        host: 'app.workato.com',
        workspace_id: ACTUAL.workspace_id,
        workspace_name: ACTUAL.workspace_name,
        environment: ACTUAL.environment,
        user_id: 7,
      },
    },
  ]);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    scripting: { executeScript },
    debugger: {
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({})),
      onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
      onDetach: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 42, url: 'https://app.workato.com/recipes/1' }]),
      get: vi.fn(async (tabId: number) => ({
        id: tabId,
        url: 'https://app.workato.com/recipes/1',
      })),
      onUpdated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('assertExpectedContext', () => {
  it('is a no-op when the caller pinned nothing', async () => {
    await expect(assertExpectedContext({}, 42)).resolves.toBeUndefined();
    await expect(assertExpectedContext(undefined, 42)).resolves.toBeUndefined();
    await expect(assertExpectedContext({ expected_context: {} }, 42)).resolves.toBeUndefined();
    // No pin, no read: the guard must not cost a round trip on every write.
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('passes when the tab is the workspace the caller expects', async () => {
    await expect(
      assertExpectedContext({ expected_context: { workspace_id: 5150 } }, 42),
    ).resolves.toBeUndefined();
  });

  it('throws ContextMismatch naming both sides', async () => {
    await expect(
      assertExpectedContext({ expected_context: OTHER_WORKSPACE }, 42),
    ).rejects.toMatchObject({ name: 'WorkatoDispatchError', code: 'ContextMismatch' });
    await expect(assertExpectedContext({ expected_context: OTHER_WORKSPACE }, 42)).rejects.toThrow(
      /workspace_id expected 9999, actual 5150/,
    );
  });
});

/**
 * Each entry is a write tool plus the minimum valid args. The call must fail
 * with ContextMismatch and must never reach the page, which is what the
 * executeScript call count proves: exactly one read (the context probe) and no
 * write dispatch.
 */
const WRITE_TOOLS: Array<{
  label: string;
  tool: { execute: (args: any) => Promise<any> };
  args: object;
}> = [
  {
    label: 'workato_lookup_table_row_create',
    tool: WorkatoLookupTableRowCreateTool,
    args: { table_id: 7, row: { Key: 'v' } },
  },
  {
    label: 'workato_lookup_table_delete',
    tool: WorkatoLookupTableDeleteTool,
    args: { table_id: 7, confirm: true },
  },
  {
    label: 'workato_data_table_row_update',
    tool: WorkatoDataTableRowUpdateTool,
    args: { table_id: 'abc', record_id: 'r1', row: { Name: 'v' } },
  },
  {
    label: 'workato_data_table_delete',
    tool: WorkatoDataTableDeleteTool,
    args: { table_id: 'abc', confirm: true },
  },
  {
    label: 'workato_lcap_page_delete',
    tool: workatoLcapPageDeleteTool,
    args: { page_id: 12, confirm: true },
  },
];

describe('write tools verify the pinned context', () => {
  for (const entry of WRITE_TOOLS) {
    it(`${entry.label} refuses a call aimed at another workspace`, async () => {
      const result = await entry.tool.execute({
        ...entry.args,
        tabId: 42,
        expected_context: OTHER_WORKSPACE,
      });

      expect(result.isError).toBe(true);
      const text = result.content.map((block: { text?: string }) => block.text ?? '').join('\n');
      // These families wrap the dispatch error in their own '<tool> failed:'
      // prefix rather than reprinting its code, so match the message itself.
      expect(text).toMatch(/is not the Workato context this call expects/);
      expect(text).toMatch(/workspace_id expected 9999, actual 5150/);
      expect(text).toMatch(/Nothing was changed/);
      // One executeScript: the context probe. The write never ran.
      expect(executeScript).toHaveBeenCalledTimes(1);
    });
  }
});
