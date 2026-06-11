import { afterEach, describe, expect, it, vi } from 'vitest';

import { setVersionCommentInPage } from '@/entrypoints/background/tools/workato/set-version-comment';

describe('setVersionCommentInPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = 'XSRF-TOKEN-V2=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('puts the version comment with Workato session credentials and csrf', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => ({
      status: 200,
      text: async () => JSON.stringify({ result: 5 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await setVersionCommentInPage(73348440, 5, 'Schema fixes');

    expect(result).toEqual({
      ok: true,
      recipe_id: 73348440,
      version: 5,
      comment: 'Schema fixes',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('/recipes/73348440/versions/5.json');
    expect(options).toMatchObject({
      method: 'PUT',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json; charset=utf-8',
        'x-csrf-token': 'csrf token',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      comment: 'Schema fixes',
    });
  });

  it('reports a shape failure when the result is not a number', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ result: { unexpected: true } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await setVersionCommentInPage(73348440, 5, 'Schema fixes');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.stage).toBe('shape');
    }
  });
});
