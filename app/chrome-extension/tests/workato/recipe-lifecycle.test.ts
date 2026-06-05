import { afterEach, describe, expect, it, vi } from 'vitest';

import { changeRecipeLifecycleInPage } from '@/entrypoints/background/tools/workato/recipe-lifecycle';

describe('changeRecipeLifecycleInPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = 'XSRF-TOKEN-V2=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('posts start with an empty body', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => ({
      status: 200,
      text: async () => JSON.stringify({ status: 'enqueued' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await changeRecipeLifecycleInPage(73147057, 'start', false);

    expect(result).toEqual({
      ok: true,
      recipe_id: 73147057,
      action: 'start',
      status: 'enqueued',
    });
    const [url, options] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('/web_api/recipes/73147057/start.json');
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': 'csrf token',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: '{}',
    });
  });

  it('posts stop with force when requested', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => ({
      status: 200,
      text: async () => JSON.stringify({ status: 'enqueued' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await changeRecipeLifecycleInPage(73147057, 'stop', true);

    expect(result).toEqual({
      ok: true,
      recipe_id: 73147057,
      action: 'stop',
      status: 'enqueued',
    });
    const [url, options] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('/web_api/recipes/73147057/stop.json');
    expect(JSON.parse(options.body as string)).toEqual({ force: true });
  });

  it('surfaces Workato error details from a 2xx JSON error response', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        text: async () =>
          JSON.stringify({ error: { details: { active_dependent_recipes_count: [1] } } }),
      })),
    );

    const result = await changeRecipeLifecycleInPage(73147057, 'stop', false);

    expect(result).toEqual({
      ok: false,
      failure: {
        stage: 'workato',
        message: 'Workato returned an error while trying to stop recipe 73147057',
        details: { active_dependent_recipes_count: [1] },
      },
    });
  });
});
