import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A timed-out dispatch is not a failed call: the POST may well have landed.
 * tab-dispatch auto-retries by default for short timeouts, which is safe for a
 * read and doubles a write, so workato_call_action must opt out for anything
 * its own gate does not classify read-only.
 */

const dispatch = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; options: unknown }>,
}));

vi.mock('@/entrypoints/background/tools/workato/tab-dispatch', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/entrypoints/background/tools/workato/tab-dispatch')>();
  return {
    ...actual,
    findWorkatoTab: vi.fn(async () => ({
      tabId: 42,
      host: 'app.workato.com',
      origin: 'https://app.workato.com',
    })),
    runInWorkatoTab: vi.fn(
      async (
        _tabId: number,
        func: (...fnArgs: never[]) => unknown,
        _args: unknown[],
        options?: unknown,
      ) => {
        dispatch.calls.push({ name: func.name, options });
        return { ok: true, raw: { result: { records: [] } } };
      },
    ),
  };
});

import { workatoCallActionTool } from '@/entrypoints/background/tools/workato/call-action';

beforeEach(() => {
  dispatch.calls.length = 0;
});

describe('workato_call_action dispatch options', () => {
  it('disables the auto-retry for an action that is not classified read-only', async () => {
    const result = await workatoCallActionTool.execute({
      connection_id: 19092754,
      action_name: 'create_record',
      input: { sobject_name: 'Account' },
      allow_writes: true,
    });

    expect(result.isError).toBe(false);
    expect(dispatch.calls[0].options).toMatchObject({ retryOnTimeout: false });
  });

  it('keeps the auto-retry for a read action', async () => {
    await workatoCallActionTool.execute({
      connection_id: 19092754,
      action_name: 'search_records',
      input: { sobject_name: 'Account' },
    });

    expect(dispatch.calls[0].options).toMatchObject({ retryOnTimeout: true });
  });

  it('refuses a write without allow_writes before dispatching anything', async () => {
    const result = await workatoCallActionTool.execute({
      connection_id: 19092754,
      action_name: 'create_record',
      input: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text as string).toContain('WorkatoUnsafeAction');
    expect(dispatch.calls).toHaveLength(0);
  });
});
