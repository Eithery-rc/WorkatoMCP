import { afterEach, describe, expect, it, vi } from 'vitest';

import { renameRecipeInPage } from '@/entrypoints/background/tools/workato/rename-recipe';

describe('renameRecipeInPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = 'XSRF-TOKEN-V2=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('puts the new recipe name with Workato session credentials and csrf', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          result: {
            flow: {
              name: 'LGCY | REC | ObitPortal File Listener2',
              version_no: 3,
              updated_at: '2026-05-22T02:22:56.313-07:00',
              code_errors: [],
              job_report_config_errors: [],
              requirements_errors: [],
            },
            folders: [
              { id: 31487337, name: 'ObitPortal Integrations' },
              { id: 31241502, name: 'Recipes' },
            ],
          },
        }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await renameRecipeInPage(
      72893761,
      'LGCY | REC | ObitPortal File Listener2',
      'client-uuid',
    );

    expect(result).toEqual({
      ok: true,
      recipe_id: 72893761,
      name: 'LGCY | REC | ObitPortal File Listener2',
      version_no: 3,
      updated_at: '2026-05-22T02:22:56.313-07:00',
      code_errors: [],
      job_report_config_errors: [],
      requirements_errors: [],
      folders: [
        { id: 31487337, name: 'ObitPortal Integrations' },
        { id: 31241502, name: 'Recipes' },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('/recipes/72893761.json');
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
    expect((options as RequestInit).headers).not.toHaveProperty('content-encoding');
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      flow: { name: 'LGCY | REC | ObitPortal File Listener2' },
      client_uuid: 'client-uuid',
      error_format: 'json',
    });
  });
});
