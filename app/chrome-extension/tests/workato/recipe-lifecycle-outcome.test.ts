import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Outcome reporting for workato_start_recipe / workato_stop_recipe.
 *
 * These drive the tool's execute() with tab-dispatch mocked, because the whole
 * point of the change is what happens AFTER the POST: Workato answers 202 even
 * for a recipe that cannot start, so a start that does not flip has to read
 * /web_api/recipes/<id>/state.json before it can claim anything.
 */

const dispatch = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown[]; options: unknown }>,
  handlers: new Map<string, (args: unknown[]) => unknown>(),
}));

vi.mock('@/entrypoints/background/tools/workato/tab-dispatch', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/entrypoints/background/tools/workato/tab-dispatch')>();
  return {
    ...actual,
    findWorkatoTab: vi.fn(async (tabId?: number) => ({
      tabId: tabId ?? 42,
      host: 'app.workato.com',
      origin: 'https://app.workato.com',
    })),
    runInWorkatoTab: vi.fn(
      async (
        _tabId: number,
        func: (...fnArgs: never[]) => unknown,
        args: unknown[],
        options?: unknown,
      ) => {
        dispatch.calls.push({ name: func.name, args, options });
        const handler = dispatch.handlers.get(func.name);
        if (!handler) throw new Error(`no in-page stub registered for ${func.name}`);
        return handler(args);
      },
    ),
  };
});

import {
  workatoStartRecipeTool,
  workatoStopRecipeTool,
} from '@/entrypoints/background/tools/workato/recipe-lifecycle';

function lastJson(text: string): Record<string, unknown> {
  const lines = text.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

function statusStub(running: boolean, state: string) {
  return () => ({
    ok: true,
    status: {
      recipe_id: 82145420,
      name: 'MCP probe',
      running,
      state,
      version_no: 2,
      last_run_at: null,
      stopped_at: null,
      stop_reason: null,
      stopped_for_error: null,
      job_succeeded_count: 0,
      job_failed_count: 0,
    },
  });
}

const ACCOUNT_ID_STATE = {
  ok: true,
  state: 'stopped',
  error: {
    details: {
      code_errors: [],
      config_errors: [[1, [['account_id', null, "can't be blank"]]]],
      param_errors: [],
      requirements_errors: [],
    },
  },
};

const CONNECTIONS_RAW = {
  ok: true,
  recipe: {
    recipe_id: 82145420,
    name: 'MCP probe',
    state: 'stopped',
    running: false,
    version_no: 2,
  },
  entries: [{ provider: 'salesforce', name: 'salesforce', account_id: null }],
  connections: {},
  connection_errors: {},
  meta_required: { salesforce: true },
};

beforeEach(() => {
  dispatch.calls.length = 0;
  dispatch.handlers.clear();
  dispatch.handlers.set('changeRecipeLifecycleInPage', (args) => ({
    ok: true,
    recipe_id: args[0],
    action: args[1],
    status: 'enqueued',
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

async function runWithTimers<T>(promise: Promise<T>, ms: number): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return promise;
}

describe('start outcome', () => {
  it('reports state_reached when the recipe flips to running', async () => {
    dispatch.handlers.set('fetchRecipeStatusInPage', statusStub(true, 'running'));

    const result = await workatoStartRecipeTool.execute({
      recipe_id: 82145420,
      wait: true,
      wait_timeout_ms: 1000,
    });

    expect(result.isError).toBe(false);
    const payload = lastJson(result.content[0].text as string);
    expect(payload.outcome).toBe('state_reached');
    expect(payload.state_flipped).toBe(true);
    expect(dispatch.calls.some((c) => c.name === 'fetchRecipeActivationStateInPage')).toBe(false);
  });

  it('returns an error naming the offending line, field and connection when Workato refused', async () => {
    vi.useFakeTimers();
    dispatch.handlers.set('fetchRecipeStatusInPage', statusStub(false, 'stopped'));
    dispatch.handlers.set('fetchRecipeActivationStateInPage', () => ACCOUNT_ID_STATE);
    dispatch.handlers.set('fetchRecipeConnectionsInPage', () => CONNECTIONS_RAW);

    const result = await runWithTimers(
      workatoStartRecipeTool.execute({
        recipe_id: 82145420,
        wait: true,
        wait_timeout_ms: 1000,
      }),
      1500,
    );

    expect(result.isError).toBe(true);
    const text = result.content[0].text as string;
    expect(text).toContain('FAILED');
    expect(text).toContain('line 1 field account_id');
    expect(text).toContain('adapter salesforce');

    const payload = lastJson(text);
    expect(payload.outcome).toBe('failed');
    expect(payload.state_flipped).toBe(false);
    expect(payload.start_error).toMatchObject({
      state: 'stopped',
      config_errors: [
        { line_number: 1, field: 'account_id', value: null, message: "can't be blank" },
      ],
    });
    expect((payload.connections as { healthy: boolean }).healthy).toBe(false);
  });

  it('reports accepted, not failed, when the state did not flip and Workato recorded no error', async () => {
    vi.useFakeTimers();
    dispatch.handlers.set('fetchRecipeStatusInPage', statusStub(false, 'stopped'));
    dispatch.handlers.set('fetchRecipeActivationStateInPage', () => ({
      ok: true,
      state: 'stopped',
      error: null,
    }));

    const result = await runWithTimers(
      workatoStartRecipeTool.execute({
        recipe_id: 82145420,
        wait: true,
        wait_timeout_ms: 1000,
      }),
      1500,
    );

    expect(result.isError).toBe(false);
    const text = result.content[0].text as string;
    expect(text).toContain('NOT verified');
    const payload = lastJson(text);
    expect(payload.outcome).toBe('accepted');
    expect(payload.start_error).toBeUndefined();
    expect(dispatch.calls.some((c) => c.name === 'fetchRecipeConnectionsInPage')).toBe(false);
  });

  it('says the diagnosis itself failed rather than claiming a clean start', async () => {
    vi.useFakeTimers();
    dispatch.handlers.set('fetchRecipeStatusInPage', statusStub(false, 'stopped'));
    dispatch.handlers.set('fetchRecipeActivationStateInPage', () => ({
      ok: false,
      failure: { stage: 'fetch', status: 500, message: 'GET state.json returned HTTP 500' },
    }));

    const result = await runWithTimers(
      workatoStartRecipeTool.execute({
        recipe_id: 82145420,
        wait: true,
        wait_timeout_ms: 1000,
      }),
      1500,
    );

    const payload = lastJson(result.content[0].text as string);
    expect(payload.outcome).toBe('accepted');
    expect(String(payload.diagnosis_error)).toContain('HTTP 500');
  });

  it('reports accepted without a wait, and does not read the activation state', async () => {
    const result = await workatoStartRecipeTool.execute({ recipe_id: 82145420 });

    expect(result.isError).toBe(false);
    const payload = lastJson(result.content[0].text as string);
    expect(payload.outcome).toBe('accepted');
    expect(payload.state_flipped).toBeUndefined();
    expect(dispatch.calls.map((c) => c.name)).toEqual(['changeRecipeLifecycleInPage']);
  });
});

describe('stop outcome', () => {
  it('reports state_reached when the recipe flips to stopped', async () => {
    dispatch.handlers.set('fetchRecipeStatusInPage', statusStub(false, 'stopped'));

    const result = await workatoStopRecipeTool.execute({
      recipe_id: 82145420,
      wait: true,
      wait_timeout_ms: 1000,
    });

    const payload = lastJson(result.content[0].text as string);
    expect(payload.outcome).toBe('state_reached');
  });

  it('reports accepted on a non-flip and never reads the start-failure record', async () => {
    vi.useFakeTimers();
    dispatch.handlers.set('fetchRecipeStatusInPage', statusStub(true, 'running'));

    const result = await runWithTimers(
      workatoStopRecipeTool.execute({
        recipe_id: 82145420,
        wait: true,
        wait_timeout_ms: 1000,
      }),
      1500,
    );

    expect(result.isError).toBe(false);
    const payload = lastJson(result.content[0].text as string);
    expect(payload.outcome).toBe('accepted');
    expect(payload.state_flipped).toBe(false);
    expect(dispatch.calls.some((c) => c.name === 'fetchRecipeActivationStateInPage')).toBe(false);
  });

  it('does not auto-retry the lifecycle write on a dispatch timeout', async () => {
    await workatoStopRecipeTool.execute({ recipe_id: 82145420 });
    const write = dispatch.calls.find((c) => c.name === 'changeRecipeLifecycleInPage');
    expect(write?.options).toMatchObject({ retryOnTimeout: false });
  });
});
