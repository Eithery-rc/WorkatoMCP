/**
 * Removes data that only the removed upstream features wrote: record-replay
 * (its chrome.storage keys all start with `rr_`, plus two IndexedDB
 * databases), the userscript manager, the element marker and the agent chat
 * themes. Nothing in the extension reads any of it any more.
 *
 * Runs on extension update. Idempotent and best effort: it never throws, and
 * a failure leaves only unused data behind.
 */

const LEGACY_STORAGE_PREFIX = 'rr_';

export const LEGACY_STORAGE_KEYS: readonly string[] = [
  'agentTheme',
  'userscripts',
  'userscripts_disabled',
];

export const LEGACY_DATABASES: readonly string[] = [
  // record-replay v1/v2 storage
  'rr_storage',
  // record-replay v3 storage
  'rr_v3',
  // element marker store
  'element_marker_storage',
];

export function isLegacyStorageKey(key: string): boolean {
  return key.startsWith(LEGACY_STORAGE_PREFIX) || LEGACY_STORAGE_KEYS.includes(key);
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      // A blocked delete still completes once open connections close; nothing
      // opens these databases now, so there is no reason to wait for it.
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function removeLegacyData(): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(null)) || {};
    const keys = Object.keys(stored).filter(isLegacyStorageKey);
    if (keys.length > 0) await chrome.storage.local.remove(keys);
  } catch (error) {
    console.warn('[legacy-cleanup] Could not clear legacy storage keys:', error);
  }

  if (typeof indexedDB === 'undefined') return;
  for (const name of LEGACY_DATABASES) {
    await deleteDatabase(name);
  }
}
