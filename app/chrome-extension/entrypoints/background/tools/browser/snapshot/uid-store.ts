/**
 * Per-tab UID → backendNodeId store for snapshot-based interaction tools.
 *
 * Each call to chrome_snapshot replaces the prior entry for that tab. The
 * stored map is used by chrome_snapshot_click / _fill / _hover / _wait_for to
 * resolve a model-supplied UID back to a CDP backend node id.
 *
 * Entries are auto-cleared when the tab closes. The debugger-session module
 * additionally clears them on its 60s idle detach.
 */

import type { UidMapEntry } from './types';

const store = new Map<number, UidMapEntry>();
/**
 * Last uid handed out per tab. It only grows (until the tab closes), so each
 * snapshot numbers its elements after the previous one's: when two agents
 * snapshot the same tab, the older agent's uids are refused instead of
 * silently naming the newer snapshot's elements.
 */
const lastUid = new Map<number, number>();

let onRemovedRegistered = false;

function ensureTabCloseListener() {
  if (onRemovedRegistered) return;
  onRemovedRegistered = true;
  try {
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (store.has(tabId)) {
        console.log(`[snapshot] tab ${tabId} closed — clearing UID store`);
        store.delete(tabId);
      }
      lastUid.delete(tabId);
    });
  } catch (e) {
    console.warn('[snapshot] could not register tabs.onRemoved listener:', e);
  }
}

/** The uid the next snapshot of this tab numbers from. */
export function uidBase(tabId: number): number {
  return lastUid.get(tabId) ?? 0;
}

export function storeSnapshot(tabId: number, entry: UidMapEntry): void {
  ensureTabCloseListener();
  store.set(tabId, entry);
  let max = uidBase(tabId);
  for (const uid of entry.uidToBackendNodeId.keys()) if (uid > max) max = uid;
  lastUid.set(tabId, max);
}

export function resolveUid(tabId: number, uid: number): number {
  const entry = store.get(tabId);
  const backendNodeId = entry?.uidToBackendNodeId.get(uid);
  if (typeof backendNodeId === 'number') return backendNodeId;
  const firstOfLatest = entry?.firstUid ?? uidBase(tabId) + 1;
  if (uid < firstOfLatest) {
    throw new Error(`uid ${uid} is from an older snapshot of this tab; call chrome_snapshot again`);
  }
  throw new Error(`uid ${uid} not found, snapshot may be stale; call chrome_snapshot again`);
}

export function clear(tabId: number): void {
  store.delete(tabId);
}
