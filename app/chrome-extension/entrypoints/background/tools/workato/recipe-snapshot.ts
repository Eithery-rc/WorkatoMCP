/**
 * Version-pinned recipe snapshot cache.
 *
 * Every `workato_pull_recipe` call used to fetch the metadata AND the whole
 * code tree, even for an outline or a single field, and the two fetches were
 * not pinned to the same version: `GET /recipes/<id>.json` gave the version
 * number, `GET /recipes/<id>/code.json?mode=view` gave whatever the recipe
 * looked like at that instant. A save between them produced a payload whose
 * version_no did not describe its code.
 *
 * Both problems have the same fix: read the metadata first, then ask for that
 * exact version's code (`code.json?mode=view&version_no=<n>`, the endpoint
 * `workato_recipe_version_diff` already relies on). A snapshot keyed by
 * version is then immutable, so it can be cached and reused.
 *
 * Metadata is ALWAYS refetched, so a cache hit only ever skips the code fetch
 * for a version that is still current. A stale entry cannot be served: its key
 * simply stops matching. `invalidateRecipeSnapshot` exists for the write paths
 * that want to drop a recipe eagerly.
 *
 * The cache lives in the service worker and dies with it, which is the right
 * lifetime: it is a within-session read accelerator, not storage.
 */

import type { RawNode, RecipeVersion } from './recipe-view';

/** Placeholder the in-page fetcher substitutes once it knows the version. */
export const RECIPE_CODE_URL_VERSION_TOKEN = '{version}';

/**
 * The code URL with the version left open. Built in the service worker and
 * passed into the page as a plain string: the in-page function cannot call a
 * module-scope helper, and this keeps one source of truth for the endpoint.
 */
export function buildRecipeCodeUrlTemplate(recipeId: number): string {
  return `/recipes/${recipeId}/code.json?mode=view&version_no=${RECIPE_CODE_URL_VERSION_TOKEN}`;
}

/** The version-pinned code URL. Same string the in-page fetcher builds. */
export function buildRecipeCodeUrl(recipeId: number, versionNo: number): string {
  return buildRecipeCodeUrlTemplate(recipeId).replace(
    RECIPE_CODE_URL_VERSION_TOKEN,
    String(versionNo),
  );
}

export interface RecipeSnapshot {
  host: string;
  recipe_id: number;
  version_no: number;
  code: RawNode;
  version: RecipeVersion;
  /** Length of the code JSON as the API returned it. */
  chars: number;
  stored_at: number;
}

/** Entries kept before the least recently used one is dropped. */
export const SNAPSHOT_MAX_ENTRIES = 32;

/** Total cached code characters before the least recently used one is dropped. */
export const SNAPSHOT_MAX_CHARS = 20 * 1024 * 1024;

/** Insertion order is the LRU order: a hit re-inserts the entry at the end. */
const cache = new Map<string, RecipeSnapshot>();

export function snapshotKey(host: string, recipeId: number, versionNo: number): string {
  return `${host}|${recipeId}|${versionNo}`;
}

function totalChars(): number {
  let total = 0;
  for (const entry of cache.values()) total += entry.chars;
  return total;
}

function evict(): void {
  while (cache.size > SNAPSHOT_MAX_ENTRIES || totalChars() > SNAPSHOT_MAX_CHARS) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}

/** A cached snapshot for this exact host/recipe/version, or null. */
export function getRecipeSnapshot(
  host: string,
  recipeId: number,
  versionNo: number,
): RecipeSnapshot | null {
  const key = snapshotKey(host, recipeId, versionNo);
  const entry = cache.get(key);
  if (!entry) return null;
  // Refresh LRU position.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

/** Store a snapshot, dropping older versions of the same recipe on this host. */
export function putRecipeSnapshot(snapshot: RecipeSnapshot): void {
  for (const [key, entry] of cache) {
    if (
      entry.recipe_id === snapshot.recipe_id &&
      entry.host === snapshot.host &&
      entry.version_no !== snapshot.version_no
    ) {
      cache.delete(key);
    }
  }
  const key = snapshotKey(snapshot.host, snapshot.recipe_id, snapshot.version_no);
  cache.delete(key);
  cache.set(key, snapshot);
  evict();
}

/** Versions of this recipe currently cached for this host, newest first. */
export function cachedRecipeVersions(host: string, recipeId: number): number[] {
  const versions: number[] = [];
  for (const entry of cache.values()) {
    if (entry.host === host && entry.recipe_id === recipeId) versions.push(entry.version_no);
  }
  return versions.sort((a, b) => b - a);
}

/**
 * Drop every cached snapshot of a recipe, on every host. Call it from a write
 * path that changes a recipe's code: the version key already prevents serving
 * an old version, this just frees the memory immediately.
 */
export function invalidateRecipeSnapshot(recipeId: number): number {
  let removed = 0;
  for (const [key, entry] of cache) {
    if (entry.recipe_id === recipeId) {
      cache.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/** Drop everything. Used by tests and by a context change (profile/host). */
export function clearRecipeSnapshots(): void {
  cache.clear();
}

/** Size of the cache, for reporting and for tests. */
export function recipeSnapshotStats(): { entries: number; chars: number } {
  return { entries: cache.size, chars: totalChars() };
}
