/**
 * @fileoverview loadRecipeSnapshot: the metadata/code handshake around the
 * snapshot cache. The in-page fetcher is replaced by a stub that behaves the
 * way pullInPage does (metadata always, code only when the version is not one
 * the caller already holds), so the caching, the version pin and the
 * if_version short circuit are exercised without a browser.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/entrypoints/background/tools/workato/tab-dispatch', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/entrypoints/background/tools/workato/tab-dispatch')>();
  return { ...actual, runInWorkatoTab: vi.fn() };
});

import { runInWorkatoTab } from '@/entrypoints/background/tools/workato/tab-dispatch';
import { loadRecipeSnapshot } from '@/entrypoints/background/tools/workato/pull-recipe';
import {
  clearRecipeSnapshots,
  recipeSnapshotStats,
} from '@/entrypoints/background/tools/workato/recipe-snapshot';

const dispatch = runInWorkatoTab as unknown as ReturnType<typeof vi.fn>;

const tab = { tabId: 7, host: 'app.workato.com', origin: 'https://app.workato.com' };

const RECIPE_ID = 82116462;

const codeTree = (marker: string) => ({
  number: 0,
  keyword: 'trigger',
  provider: 'clock',
  as: 'trigger00',
  input: { marker },
});

/** Calls recorded as [recipeId, skipVersions, codeUrlTemplate]. */
function calls(): Array<[number, number[], string]> {
  return dispatch.mock.calls.map((call) => call[2] as [number, number[], string]);
}

/**
 * Stand-in for pullInPage: metadata is always answered, the code fetch is
 * skipped when the current version is in the skip list.
 */
function stubPage(currentVersion: number, marker = 'a'): void {
  dispatch.mockImplementation(async (_tabId: number, _func: unknown, args: unknown[]) => {
    const skip = (args[1] as number[]) ?? [];
    const version = {
      version_no: currentVersion,
      name: 'Export time entries',
      folder_id: 30573643,
      config: '[]',
      visibility_private: false,
      description: '',
      worker_concurrency: 1,
      job_data_retention_policy: 'default',
    };
    if (skip.indexOf(currentVersion) >= 0) {
      return { ok: true, code_skipped: true, version };
    }
    const code = codeTree(marker);
    return {
      ok: true,
      code,
      code_chars: JSON.stringify(code).length,
      code_skipped: false,
      version,
    };
  });
}

beforeEach(() => {
  clearRecipeSnapshots();
  dispatch.mockReset();
});

describe('loadRecipeSnapshot', () => {
  it('pins the code fetch to the version the metadata reported', async () => {
    stubPage(12);
    const result = await loadRecipeSnapshot(tab, RECIPE_ID, { timeoutMs: 30_000 });

    expect(result.ok).toBe(true);
    expect(calls()).toHaveLength(1);
    const [recipeId, skip, template] = calls()[0];
    expect(recipeId).toBe(RECIPE_ID);
    expect(skip).toEqual([]);
    expect(template).toBe(`/recipes/${RECIPE_ID}/code.json?mode=view&version_no={version}`);
  });

  it('misses, caches, then hits without fetching the code again', async () => {
    stubPage(12, 'first');
    const first = await loadRecipeSnapshot(tab, RECIPE_ID, { timeoutMs: 30_000 });
    expect(first.ok && first.cacheHit).toBe(false);
    expect(recipeSnapshotStats().entries).toBe(1);

    const second = await loadRecipeSnapshot(tab, RECIPE_ID, { timeoutMs: 30_000 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.cacheHit).toBe(true);
    expect(second.code).toEqual(codeTree('first'));
    // The second dispatch asked the page to skip the version it already holds.
    expect(calls()[1][1]).toEqual([12]);
  });

  it('drops the cached snapshot when the recipe moved to a new version', async () => {
    stubPage(12, 'old');
    await loadRecipeSnapshot(tab, RECIPE_ID, { timeoutMs: 30_000 });

    stubPage(13, 'new');
    const after = await loadRecipeSnapshot(tab, RECIPE_ID, { timeoutMs: 30_000 });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.cacheHit).toBe(false);
    expect(after.version.version_no).toBe(13);
    expect(after.code).toEqual(codeTree('new'));
    expect(recipeSnapshotStats().entries).toBe(1);
  });

  it('short-circuits on if_version without transferring the code', async () => {
    stubPage(12);
    const result = await loadRecipeSnapshot(tab, RECIPE_ID, {
      timeoutMs: 30_000,
      ifVersion: 12,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unchanged).toBe(true);
    expect(result.version.version_no).toBe(12);
    // The version was offered to the page as one the caller already holds, so
    // no code came back and nothing was cached.
    expect(calls()[0][1]).toEqual([12]);
    expect(recipeSnapshotStats().entries).toBe(0);
  });

  it('still returns the code when if_version names an older version', async () => {
    stubPage(14, 'current');
    const result = await loadRecipeSnapshot(tab, RECIPE_ID, {
      timeoutMs: 30_000,
      ifVersion: 13,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unchanged).toBe(false);
    expect(result.version.version_no).toBe(14);
    expect(result.code).toEqual(codeTree('current'));
  });

  it('refetches when the page skips a version the cache no longer holds', async () => {
    stubPage(12);
    // The page reports code_skipped even though nothing is cached, which is
    // what an eviction between the peek and the fetch looks like.
    dispatch.mockImplementationOnce(async () => ({
      ok: true,
      code_skipped: true,
      version: {
        version_no: 12,
        name: 'Export time entries',
        folder_id: 30573643,
        config: '[]',
        visibility_private: false,
        description: '',
        worker_concurrency: 1,
        job_data_retention_policy: 'default',
      },
    }));

    const result = await loadRecipeSnapshot(tab, RECIPE_ID, { timeoutMs: 30_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cacheHit).toBe(false);
    expect(result.code).toEqual(codeTree('a'));
    expect(calls()).toHaveLength(2);
    expect(calls()[1][1]).toEqual([]);
  });

  it('reports the API failure instead of caching anything', async () => {
    dispatch.mockResolvedValue({
      ok: false,
      failure: {
        stage: 'meta',
        status: 404,
        body_excerpt: '{}',
        message: `GET /recipes/${RECIPE_ID}.json returned HTTP 404`,
      },
    });

    const result = await loadRecipeSnapshot(tab, RECIPE_ID, { timeoutMs: 30_000 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('WorkatoApiError (meta)');
    expect(recipeSnapshotStats().entries).toBe(0);
  });
});
