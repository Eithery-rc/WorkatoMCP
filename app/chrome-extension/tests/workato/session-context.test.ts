import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertExpectedContext,
  assertTabContext,
  buildContextBlockText,
  fetchSessionContextInPage,
  getTabContext,
  invalidateTabContext,
  maybeAppendContextBlock,
  peekTabContext,
  resetSessionContextInvalidationForTests,
  SESSION_CONTEXT_TTL_MS,
} from '@/entrypoints/background/tools/workato/session-context';

// --------------------------------------------------------------------------
// The in-page read
// --------------------------------------------------------------------------

describe('fetchSessionContextInPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubAuthUser(body: unknown, status = 200) {
    const fetchMock = vi.fn(async () => ({
      status,
      text: async () => JSON.stringify(body),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('slims auth_user.json to the routing fields', async () => {
    const fetchMock = stubAuthUser({
      result: {
        logged_user_id: 7,
        current_team: { id: 5150, name: 'Acme prod', group_name: 'admin' },
        current_environment: 'production',
        teams: [{ id: 1 }],
      },
    });

    const result = await fetchSessionContextInPage();

    expect(result).toEqual({
      ok: true,
      host: location.host,
      workspace_id: 5150,
      workspace_name: 'Acme prod',
      environment: 'production',
      user_id: 7,
    });
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/web_api/auth_user.json');
    expect(options).toMatchObject({
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
  });

  it('normalizes an object environment to a string', async () => {
    stubAuthUser({
      result: {
        logged_user_id: 7,
        current_team: { id: 5150, name: 'Acme prod' },
        current_environment: { id: 22, name: 'test', type: 'test' },
      },
    });

    const result = await fetchSessionContextInPage();
    expect(result).toMatchObject({ ok: true, environment: 'test' });
  });

  it('normalizes a numeric environment id to a string', async () => {
    stubAuthUser({
      result: { logged_user_id: 7, current_team: { id: 5150 }, current_environment: 22 },
    });

    const result = await fetchSessionContextInPage();
    expect(result).toMatchObject({ ok: true, environment: '22', workspace_name: null });
  });

  it('reports an unauthenticated tab instead of inventing a workspace', async () => {
    stubAuthUser({ result: { authenticated: false } });

    const result = await fetchSessionContextInPage();
    expect(result).toMatchObject({ ok: false, failure: { stage: 'auth' } });
  });

  it('reports an HTTP failure with the status', async () => {
    stubAuthUser({ error: 'nope' }, 403);

    const result = await fetchSessionContextInPage();
    expect(result).toMatchObject({ ok: false, failure: { stage: 'http', status: 403 } });
  });
});

// --------------------------------------------------------------------------
// The service-worker cache
// --------------------------------------------------------------------------

interface UpdatedListener {
  (tabId: number, changeInfo: { url?: string }): void;
}

const updatedListeners: UpdatedListener[] = [];
const removedListeners: ((tabId: number) => void)[] = [];
let executeScript: ReturnType<typeof vi.fn>;
let authUser: Record<string, unknown>;

function pageResult() {
  const team = authUser.current_team as { id?: number; name?: string } | undefined;
  return [
    {
      result: {
        ok: true,
        host: 'app.workato.com',
        workspace_id: team?.id ?? null,
        workspace_name: team?.name ?? null,
        environment: (authUser.current_environment as string | undefined) ?? null,
        user_id: 7,
      },
    },
  ];
}

beforeEach(() => {
  updatedListeners.length = 0;
  removedListeners.length = 0;
  invalidateTabContext();
  resetSessionContextInvalidationForTests();
  authUser = { current_team: { id: 5150, name: 'Acme prod' }, current_environment: 'production' };
  executeScript = vi.fn(async () => pageResult());
  (globalThis as unknown as { chrome: unknown }).chrome = {
    scripting: { executeScript },
    tabs: {
      query: vi.fn(async () => [{ id: 42, url: 'https://app.workato.com/recipes/1' }]),
      get: vi.fn(async (tabId: number) => ({
        id: tabId,
        url: 'https://app.workato.com/recipes/1',
      })),
      onUpdated: { addListener: vi.fn((fn: UpdatedListener) => updatedListeners.push(fn)) },
      onRemoved: { addListener: vi.fn((fn: (tabId: number) => void) => removedListeners.push(fn)) },
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('getTabContext', () => {
  it('reads the tab once and serves the cache inside the TTL', async () => {
    const first = await getTabContext(42);
    const second = await getTabContext(42);

    expect(first).toEqual(second);
    expect(first.workspace_id).toBe(5150);
    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  it('re-reads the tab once the entry is older than maxAgeMs', async () => {
    const context = await getTabContext(42);
    // Age the entry rather than the clock: the cache stores fetched_at.
    (context as { fetched_at: number }).fetched_at = Date.now() - SESSION_CONTEXT_TTL_MS - 1;

    await getTabContext(42);
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it('force re-reads even when the entry is fresh', async () => {
    await getTabContext(42);
    await getTabContext(42, { force: true });
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it('caches per tab', async () => {
    await getTabContext(42);
    await getTabContext(43);
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it('drops the entry when the tab navigates', async () => {
    await getTabContext(42);
    expect(peekTabContext(42)).toBeDefined();
    expect(updatedListeners.length).toBe(1);

    updatedListeners[0](42, { url: 'https://app.eu.workato.com/recipes/9' });

    expect(peekTabContext(42)).toBeUndefined();
    await getTabContext(42);
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it('keeps the entry for a tab update that is not a navigation', async () => {
    await getTabContext(42);
    updatedListeners[0](42, {});
    expect(peekTabContext(42)).toBeDefined();
  });

  it('drops the entry when the tab closes', async () => {
    await getTabContext(42);
    removedListeners[0](42);
    expect(peekTabContext(42)).toBeUndefined();
  });

  it('does not cache a failed read', async () => {
    executeScript = vi.fn(async () => [
      { result: { ok: false, failure: { stage: 'auth', message: 'not authenticated' } } },
    ]);
    (globalThis as unknown as { chrome: any }).chrome.scripting.executeScript = executeScript;

    await expect(getTabContext(42)).rejects.toMatchObject({
      name: 'WorkatoDispatchError',
      code: 'UnexpectedShape',
    });
    expect(peekTabContext(42)).toBeUndefined();
  });
});

describe('assertTabContext', () => {
  it('passes when every named field matches', async () => {
    await expect(
      assertTabContext(42, { host: 'app.workato.com', workspace_id: 5150 }),
    ).resolves.toMatchObject({ workspace_id: 5150 });
  });

  it('ignores fields the caller did not pin', async () => {
    await expect(assertTabContext(42, {})).resolves.toMatchObject({ tab_id: 42 });
  });

  it('names expected and actual for a workspace mismatch', async () => {
    await expect(assertTabContext(42, { workspace_id: 9999 })).rejects.toMatchObject({
      name: 'WorkatoDispatchError',
      code: 'ContextMismatch',
    });
    await expect(assertTabContext(42, { workspace_id: 9999 })).rejects.toThrow(
      /workspace_id expected 9999, actual 5150 \("Acme prod"\)/,
    );
  });

  it('names expected and actual for a host mismatch', async () => {
    await expect(assertTabContext(42, { host: 'app.eu.workato.com' })).rejects.toThrow(
      /host expected app\.eu\.workato\.com, actual app\.workato\.com/,
    );
  });

  it('names expected and actual for an environment mismatch', async () => {
    await expect(assertTabContext(42, { environment: 'test' })).rejects.toThrow(
      /environment expected test, actual production/,
    );
  });
});

describe('assertExpectedContext', () => {
  it('does nothing without an expected_context', async () => {
    await expect(assertExpectedContext({}, 42)).resolves.toBeUndefined();
    await expect(assertExpectedContext(undefined, 42)).resolves.toBeUndefined();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('does nothing for an empty expected_context', async () => {
    await expect(assertExpectedContext({ expected_context: {} }, 42)).resolves.toBeUndefined();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('refuses a call aimed at another workspace', async () => {
    await expect(
      assertExpectedContext({ expected_context: { workspace_id: 9999 } }, 42),
    ).rejects.toMatchObject({ code: 'ContextMismatch' });
  });
});

describe('buildContextBlockText', () => {
  const base = {
    tab_id: 42,
    host: 'app.workato.com',
    workspace_id: 5150,
    workspace_name: 'Acme prod',
    environment: 'production',
    user_id: 7,
    fetched_at: Date.now(),
  };

  it('is one compact JSON object under 200 bytes', () => {
    const text = buildContextBlockText(base);
    expect(text.startsWith('{"context":')).toBe(true);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(200);
    expect(JSON.parse(text).context).toEqual({
      tab_id: 42,
      host: 'app.workato.com',
      workspace_id: 5150,
      workspace_name: 'Acme prod',
      environment: 'production',
    });
  });

  it('drops the workspace name rather than overflow the ceiling', () => {
    const text = buildContextBlockText({ ...base, workspace_name: 'x'.repeat(400) });
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(200);
    expect(JSON.parse(text).context.workspace_name).toBeUndefined();
    expect(JSON.parse(text).context.workspace_id).toBe(5150);
  });
});

describe('maybeAppendContextBlock', () => {
  const ok = () => ({
    content: [{ type: 'text' as const, text: '{"recipe_id":1}' }],
    isError: false,
  });

  it('appends the context of the explicitly targeted tab', async () => {
    const result = await maybeAppendContextBlock('workato_recipe_status', { tabId: 42 }, ok());
    expect(result.content).toHaveLength(2);
    expect(JSON.parse((result.content[1] as { text: string }).text).context).toMatchObject({
      tab_id: 42,
      workspace_id: 5150,
    });
  });

  it('resolves the tab when the call did not name one', async () => {
    const result = await maybeAppendContextBlock('workato_recipe_status', {}, ok());
    expect(result.content).toHaveLength(2);
  });

  it('leaves non-Workato tools, errors and the context tool itself alone', async () => {
    expect((await maybeAppendContextBlock('get_windows_and_tabs', {}, ok())).content).toHaveLength(
      1,
    );
    expect(
      (await maybeAppendContextBlock('workato_session_context', {}, ok())).content,
    ).toHaveLength(1);
    expect((await maybeAppendContextBlock('workato_list_profiles', {}, ok())).content).toHaveLength(
      1,
    );
    const failure = { content: [{ type: 'text' as const, text: 'boom' }], isError: true };
    expect(
      (await maybeAppendContextBlock('workato_recipe_status', {}, failure)).content,
    ).toHaveLength(1);
  });

  it('skips a windowId-targeted call, whose tab is not knowable here', async () => {
    const result = await maybeAppendContextBlock('workato_recipe_status', { windowId: 3 }, ok());
    expect(result.content).toHaveLength(1);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('never turns a failure to read the context into a failed call', async () => {
    executeScript = vi.fn(async () => {
      throw new Error('tab is gone');
    });
    (globalThis as unknown as { chrome: any }).chrome.scripting.executeScript = executeScript;

    const result = await maybeAppendContextBlock('workato_recipe_status', { tabId: 42 }, ok());
    expect(result.content).toHaveLength(1);
    expect(result.isError).toBe(false);
  });
});
