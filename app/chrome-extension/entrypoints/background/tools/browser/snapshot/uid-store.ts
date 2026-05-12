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
    });
  } catch (e) {
    console.warn('[snapshot] could not register tabs.onRemoved listener:', e);
  }
}

export function storeSnapshot(tabId: number, entry: UidMapEntry): void {
  ensureTabCloseListener();
  store.set(tabId, entry);
}

export function resolveUid(tabId: number, uid: number): number {
  const entry = store.get(tabId);
  if (!entry) {
    throw new Error(`uid ${uid} not found — snapshot may be stale, call chrome_snapshot again`);
  }
  const backendNodeId = entry.uidToBackendNodeId.get(uid);
  if (typeof backendNodeId !== 'number') {
    throw new Error(`uid ${uid} not found — snapshot may be stale, call chrome_snapshot again`);
  }
  return backendNodeId;
}

export function clear(tabId: number): void {
  store.delete(tabId);
}
