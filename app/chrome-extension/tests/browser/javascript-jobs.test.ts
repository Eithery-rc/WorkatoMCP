import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The CDP layer is replaced by a stand-in that evaluates each expression in the
 * jsdom window, the way Runtime.evaluate with returnByValue would: the job
 * wrapper, the probe and the forget expression all run for real.
 */
const cdp = vi.hoisted(() => ({ hang: false, calls: [] as string[] }));

vi.mock('@/utils/cdp-session-manager', () => ({
  cdpSessionManager: {
    withSession: (_tabId: number, _owner: string, fn: () => Promise<unknown>) => fn(),
    sendCommand: async (_tabId: number, method: string, params: any) => {
      cdp.calls.push(method);
      if (cdp.hang) return new Promise(() => undefined);
      let value: unknown;
      try {
        value = (0, eval)(params.expression);
        if (params.awaitPromise) value = await value;
      } catch (error: any) {
        return {
          exceptionDetails: {
            text: 'Uncaught',
            exception: { className: error?.name, description: String(error) },
          },
        };
      }
      return value === undefined
        ? { result: { type: 'undefined' } }
        : { result: { type: typeof value, value: JSON.parse(JSON.stringify(value)) } };
    },
  },
}));

import { javascriptTool } from '@/entrypoints/background/tools/browser/javascript';

const chromeAny = globalThis.chrome as any;

function payloadOf(result: any) {
  return JSON.parse(result.content[0].text);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  cdp.hang = false;
  cdp.calls = [];
  chromeAny.tabs.get.mockImplementation(async (id: number) => ({ id, url: 'https://x.test/' }));
  delete (window as any).__mokutabJobs;
  delete (window as any).__ran;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('chrome_javascript async jobs', () => {
  it('returns the job id before the code runs, then delivers the result (one re-read)', async () => {
    const started = await javascriptTool.execute({
      tabId: 5,
      async_job: true,
      code: 'window.__ran = true; return "a=1; b=2";',
    });
    const start = payloadOf(started);
    expect(started.isError).toBe(false);
    expect(start).toMatchObject({ success: true, state: 'running', tabId: 5 });
    expect(start.job_id).toMatch(/^job_/);
    // The code runs from a timer, after the start evaluate has answered.
    expect((window as any).__ran).toBeUndefined();

    await tick();
    expect((window as any).__ran).toBe(true);

    const polled = await javascriptTool.execute({ tabId: 5, job_id: start.job_id });
    const done = payloadOf(polled);
    expect(polled.isError).toBe(false);
    // Inline delivery stays redacted, like a plain run.
    expect(done).toMatchObject({
      state: 'done',
      job_id: start.job_id,
      result: '[BLOCKED: Cookie/query string data]',
      redacted: true,
    });
    expect(typeof done.job_ms).toBe('number');
    expect(done.message).toBeUndefined();

    // A reply that never reached the agent can be read once more.
    await tick();
    expect(typeof (window as any).__mokutabJobs[start.job_id].delivered).toBe('number');
    const reread = await javascriptTool.execute({ tabId: 5, job_id: start.job_id });
    expect(reread.isError).toBe(false);
    expect(payloadOf(reread)).toMatchObject({ state: 'done', result: done.result });
    expect(payloadOf(reread).message).toMatch(/Second read/);

    await tick();
    expect((window as any).__mokutabJobs[start.job_id]).toBeUndefined();

    const again = await javascriptTool.execute({ tabId: 5, job_id: start.job_id });
    expect(again.isError).toBe(true);
    expect(payloadOf(again).error.message).toMatch(/already delivered/);
    expect(payloadOf(again).state).toBeUndefined();
  });

  it('refuses a re-read once the window has passed', async () => {
    const start = payloadOf(
      await javascriptTool.execute({ tabId: 5, async_job: true, code: 'return 7;' }),
    );
    await tick();
    expect(payloadOf(await javascriptTool.execute({ tabId: 5, job_id: start.job_id })).state).toBe(
      'done',
    );
    await tick();
    (window as any).__mokutabJobs[start.job_id].delivered = Date.now() - 61_000;

    const late = await javascriptTool.execute({ tabId: 5, job_id: start.job_id });
    expect(late.isError).toBe(true);
    expect(payloadOf(late).error.message).toMatch(/already delivered/);
    await tick();
    expect((window as any).__mokutabJobs[start.job_id]).toBeUndefined();
  });

  it('drops long-finished jobs nobody polled when a new job starts', async () => {
    (window as any).__mokutabJobs = {
      job_old: {
        state: 'done',
        value: 'x'.repeat(100),
        started: 1,
        finished: Date.now() - 31 * 60_000,
      },
      job_recent: { state: 'done', value: 1, started: 1, finished: Date.now() - 60_000 },
      job_running: { state: 'running', started: 1 },
    };
    await javascriptTool.execute({ tabId: 5, async_job: true, code: 'return 1;' });
    const store = (window as any).__mokutabJobs;
    expect(store.job_old).toBeUndefined();
    expect(store.job_recent).toBeDefined();
    expect(store.job_running).toBeDefined();
  });

  it('delivers the value unredacted when the bridge asks for raw output', async () => {
    const start = payloadOf(
      await javascriptTool.execute({ tabId: 5, async_job: true, code: 'return "a=1; b=2";' }),
    );
    await tick();
    const done = payloadOf(
      await javascriptTool.execute({ tabId: 5, job_id: start.job_id, rawOutput: true }),
    );
    expect(done).toMatchObject({ state: 'done', result: 'a=1; b=2' });
    expect(done.redacted).toBeUndefined();
  });

  it('reports a job that threw as an error with its message', async () => {
    const start = payloadOf(
      await javascriptTool.execute({
        tabId: 5,
        async_job: true,
        code: 'await null; throw new Error("boom");',
      }),
    );
    await tick();
    const failed = await javascriptTool.execute({ tabId: 5, job_id: start.job_id });
    expect(failed.isError).toBe(true);
    expect(payloadOf(failed)).toMatchObject({
      success: false,
      state: 'error',
      error: { kind: 'runtime_error' },
    });
    expect(payloadOf(failed).error.message).toContain('boom');
  });

  it('waits up to wait_ms for a running job', async () => {
    const start = payloadOf(
      await javascriptTool.execute({
        tabId: 5,
        async_job: true,
        code: 'await new Promise((r) => setTimeout(r, 300)); return 42;',
      }),
    );
    const first = payloadOf(await javascriptTool.execute({ tabId: 5, job_id: start.job_id }));
    expect(first.state).toBe('running');
    const waited = payloadOf(
      await javascriptTool.execute({ tabId: 5, job_id: start.job_id, wait_ms: 3000 }),
    );
    expect(waited).toMatchObject({ state: 'done', result: '42' });
  });

  it('calls a job lost when the page store is gone (navigation or reload)', async () => {
    const start = payloadOf(
      await javascriptTool.execute({ tabId: 5, async_job: true, code: 'return 1;' }),
    );
    delete (window as any).__mokutabJobs;
    const lost = await javascriptTool.execute({ tabId: 5, job_id: start.job_id });
    expect(lost.isError).toBe(true);
    expect(payloadOf(lost)).toMatchObject({ state: 'lost' });
    expect(payloadOf(lost).error.message).toMatch(/navigated or reloaded/);
  });

  it('reports busy when the page cannot answer the probe', async () => {
    const start = payloadOf(
      await javascriptTool.execute({ tabId: 5, async_job: true, code: 'return 1;' }),
    );
    cdp.hang = true;
    vi.useFakeTimers();
    const pending = javascriptTool.execute({ tabId: 5, job_id: start.job_id });
    await vi.advanceTimersByTimeAsync(3000);
    const busy = await pending;
    expect(busy.isError).toBe(false);
    expect(payloadOf(busy)).toMatchObject({ success: true, state: 'busy' });
    expect(payloadOf(busy).message).toMatch(/main thread is blocked/);
  });

  it('refuses a poll from another tab', async () => {
    const start = payloadOf(
      await javascriptTool.execute({ tabId: 5, async_job: true, code: 'return 1;' }),
    );
    const wrong = await javascriptTool.execute({ tabId: 6, job_id: start.job_id });
    expect(wrong.isError).toBe(true);
    expect(payloadOf(wrong).error.message).toMatch(/started in tab 5, not tab 6/);
  });

  it('reports a syntax error at start and registers nothing', async () => {
    const started = await javascriptTool.execute({
      tabId: 5,
      async_job: true,
      code: 'return (;',
    });
    expect(started.isError).toBe(true);
    expect(payloadOf(started).error.kind).toBe('syntax_error');
    expect(Object.keys((window as any).__mokutabJobs || {})).toHaveLength(0);
  });

  it('validates the parameter combinations', async () => {
    const both = await javascriptTool.execute({ tabId: 5, code: 'return 1', job_id: 'job_x' });
    expect(both.isError).toBe(true);
    const neither = await javascriptTool.execute({ tabId: 5 });
    expect(neither.isError).toBe(true);
    const withUids = await javascriptTool.execute({
      tabId: 5,
      code: 'return 1',
      async_job: true,
      uids: [3],
    });
    expect(withUids.isError).toBe(true);
    expect(cdp.calls).toHaveLength(0);
  });
});

describe('chrome_javascript raw output', () => {
  it('returns a plain run unredacted with rawOutput, redacted without', async () => {
    const raw = payloadOf(
      await javascriptTool.execute({ tabId: 5, code: 'return "a=1; b=2";', rawOutput: true }),
    );
    expect(raw.result).toBe('a=1; b=2');
    expect(raw.redacted).toBeUndefined();

    const inline = payloadOf(
      await javascriptTool.execute({ tabId: 5, code: 'return "a=1; b=2";' }),
    );
    expect(inline.result).toBe('[BLOCKED: Cookie/query string data]');
    expect(inline.redacted).toBe(true);
  });

  it('formats a non-string raw value as indented JSON', async () => {
    const raw = payloadOf(
      await javascriptTool.execute({
        tabId: 5,
        code: 'return { token: "t", n: 1 };',
        rawOutput: true,
      }),
    );
    expect(raw.result).toBe(JSON.stringify({ token: 't', n: 1 }, null, 2));
  });
});
