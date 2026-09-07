/**
 * @fileoverview Tests for the version-pinned recipe snapshot cache and the
 * code URL it pins against.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  RECIPE_CODE_URL_VERSION_TOKEN,
  SNAPSHOT_MAX_ENTRIES,
  buildRecipeCodeUrl,
  buildRecipeCodeUrlTemplate,
  cachedRecipeVersions,
  clearRecipeSnapshots,
  getRecipeSnapshot,
  invalidateRecipeSnapshot,
  putRecipeSnapshot,
  recipeSnapshotStats,
  snapshotKey,
} from '@/entrypoints/background/tools/workato/recipe-snapshot';
import type { RawNode, RecipeVersion } from '@/entrypoints/background/tools/workato/recipe-view';

const version = (versionNo: number): RecipeVersion => ({
  version_no: versionNo,
  name: 'Recipe',
  folder_id: 1,
  description: '',
});

const store = (recipeId: number, versionNo: number, host = 'app.workato.com'): void => {
  putRecipeSnapshot({
    host,
    recipe_id: recipeId,
    version_no: versionNo,
    code: { number: 0, keyword: 'trigger', as: `t${versionNo}` } as RawNode,
    version: version(versionNo),
    chars: 100,
    stored_at: Date.now(),
  });
};

beforeEach(() => {
  clearRecipeSnapshots();
});

describe('buildRecipeCodeUrl', () => {
  it('pins the code fetch to a version', () => {
    expect(buildRecipeCodeUrl(72988590, 23)).toBe(
      '/recipes/72988590/code.json?mode=view&version_no=23',
    );
  });

  it('leaves the version open in the template the page substitutes', () => {
    const template = buildRecipeCodeUrlTemplate(42);
    expect(template).toContain(RECIPE_CODE_URL_VERSION_TOKEN);
    expect(template.replace(RECIPE_CODE_URL_VERSION_TOKEN, '7')).toBe(buildRecipeCodeUrl(42, 7));
  });
});

describe('recipe snapshot cache', () => {
  it('misses, then hits on the same host/recipe/version', () => {
    expect(getRecipeSnapshot('app.workato.com', 1, 5)).toBeNull();
    store(1, 5);
    expect(getRecipeSnapshot('app.workato.com', 1, 5)?.version_no).toBe(5);
  });

  it('never serves a different version or a different host', () => {
    store(1, 5);
    expect(getRecipeSnapshot('app.workato.com', 1, 6)).toBeNull();
    expect(getRecipeSnapshot('app.eu.workato.com', 1, 5)).toBeNull();
  });

  it('replaces an older version of the same recipe on the same host', () => {
    store(1, 5);
    store(1, 6);
    expect(cachedRecipeVersions('app.workato.com', 1)).toEqual([6]);
    expect(getRecipeSnapshot('app.workato.com', 1, 5)).toBeNull();
  });

  it('keeps the same recipe cached per host', () => {
    store(1, 5, 'app.workato.com');
    store(1, 5, 'app.eu.workato.com');
    expect(recipeSnapshotStats().entries).toBe(2);
  });

  it('invalidates every host entry for one recipe', () => {
    store(1, 5, 'app.workato.com');
    store(1, 5, 'app.eu.workato.com');
    store(2, 5);
    expect(invalidateRecipeSnapshot(1)).toBe(2);
    expect(cachedRecipeVersions('app.workato.com', 1)).toEqual([]);
    expect(cachedRecipeVersions('app.workato.com', 2)).toEqual([5]);
  });

  it('evicts the least recently used entry past the ceiling', () => {
    for (let i = 1; i <= SNAPSHOT_MAX_ENTRIES + 2; i += 1) store(i, 1);
    expect(recipeSnapshotStats().entries).toBe(SNAPSHOT_MAX_ENTRIES);
    expect(getRecipeSnapshot('app.workato.com', 1, 1)).toBeNull();
    expect(getRecipeSnapshot('app.workato.com', SNAPSHOT_MAX_ENTRIES + 2, 1)).not.toBeNull();
  });

  it('a hit refreshes the LRU position', () => {
    for (let i = 1; i <= SNAPSHOT_MAX_ENTRIES; i += 1) store(i, 1);
    expect(getRecipeSnapshot('app.workato.com', 1, 1)).not.toBeNull();
    store(SNAPSHOT_MAX_ENTRIES + 1, 1);
    expect(getRecipeSnapshot('app.workato.com', 1, 1)).not.toBeNull();
    expect(getRecipeSnapshot('app.workato.com', 2, 1)).toBeNull();
  });

  it('keys on host, recipe and version', () => {
    expect(snapshotKey('app.workato.com', 7, 3)).toBe('app.workato.com|7|3');
  });
});
