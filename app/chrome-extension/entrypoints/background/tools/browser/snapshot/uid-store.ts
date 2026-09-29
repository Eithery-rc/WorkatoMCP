/**
 * Per-tab stable uid store for the snapshot tool family.
 *
 * A uid names one DOM node (frame + document + backendNodeId). A node seen
 * again in a later snapshot keeps its uid; a new node gets the next number of
 * a per-tab counter that only grows, so a uid can never come to name a
 * different node. That is what makes it safe for several agents, or one
 * agent across many steps, to hold uids from different snapshots. Each entry
 * also records the node's role, name and row context, so an action refuses a
 * node that a keyed list recycled for another record.
 *
 * Entries are dropped when their frame navigates (new loaderId), when they
 * have not been seen for STALE_AFTER_SNAPSHOTS snapshots, and when the tab
 * closes. State is mirrored to chrome.storage.session, so an MV3 worker
 * restart keeps every uid: backendNodeIds live in the renderer, not here.
 */

import type { UidIdentity, UidNodeRef } from './types';

/** A node absent from this many consecutive snapshots is forgotten. */
const STALE_AFTER_SNAPSHOTS = 10;
/** Hard cap per tab; the least recently seen entries go first. */
const MAX_ENTRIES_PER_TAB = 20_000;
const STORAGE_PREFIX = 'snapshotUids:';

export interface TabUids {
  /** Last uid handed out on this tab. Never decreases while the tab lives. */
  lastUid: number;
  /** Snapshot sequence number. */
  seq: number;
  byKey: Map<string, number>;
  byUid: Map<number, UidNodeRef>;
}

const tabs = new Map<number, TabUids>();
let onRemovedRegistered = false;

function nodeKey(frameId: string, loaderId: string, backendNodeId: number): string {
  return `${frameId}|${loaderId}|${backendNodeId}`;
}

function emptyState(): TabUids {
  return { lastUid: 0, seq: 0, byKey: new Map(), byUid: new Map() };
}

function sessionStorage(): chrome.storage.StorageArea | null {
  try {
    return (chrome as any)?.storage?.session ?? null;
  } catch {
    return null;
  }
}

function ensureTabCloseListener(): void {
  if (onRemovedRegistered) return;
  onRemovedRegistered = true;
  try {
    chrome.tabs.onRemoved.addListener((tabId) => {
      clear(tabId);
    });
  } catch (e) {
    console.warn('[snapshot] could not register tabs.onRemoved listener:', e);
  }
}

/** The tab's uid state: memory, else what the previous worker left in session storage, else empty. */
export async function getTabUids(tabId: number): Promise<TabUids> {
  ensureTabCloseListener();
  const cached = tabs.get(tabId);
  if (cached) return cached;
  const state = emptyState();
  const area = sessionStorage();
  if (area) {
    try {
      const key = STORAGE_PREFIX + tabId;
      const stored = (await area.get(key))?.[key] as
        | {
            lastUid?: number;
            seq?: number;
            entries?: Array<[number, number, string, string, number, string?, string?, string?]>;
          }
        | undefined;
      if (stored && Array.isArray(stored.entries)) {
        state.lastUid = Number(stored.lastUid) || 0;
        state.seq = Number(stored.seq) || 0;
        for (const [
          uid,
          backendNodeId,
          frameId,
          loaderId,
          seen,
          role,
          name,
          row,
        ] of stored.entries) {
          const ref: UidNodeRef = { backendNodeId, frameId, loaderId, seen };
          if (typeof role === 'string') ref.role = role;
          if (typeof name === 'string') ref.name = name;
          if (typeof row === 'string') ref.row = row;
          state.byUid.set(uid, ref);
          state.byKey.set(nodeKey(frameId, loaderId, backendNodeId), uid);
        }
      }
    } catch (e) {
      console.warn('[snapshot] could not restore uids from session storage:', e);
    }
  }
  // Another caller may have populated memory while we awaited storage.
  const raced = tabs.get(tabId);
  if (raced) return raced;
  tabs.set(tabId, state);
  return state;
}

/** Start a snapshot: bump the sequence and forget nodes of frames that navigated or vanished. */
export function beginSnapshot(state: TabUids, liveFrames: Map<string, string>): number {
  state.seq += 1;
  for (const [uid, ref] of state.byUid) {
    const liveLoader = liveFrames.get(ref.frameId);
    const stale = state.seq - ref.seen > STALE_AFTER_SNAPSHOTS;
    if (liveLoader !== ref.loaderId || stale) forget(state, uid, ref);
  }
  return state.seq;
}

function applyIdentity(ref: UidNodeRef, identity?: UidIdentity): void {
  if (!identity) return;
  ref.role = identity.role;
  ref.name = identity.name;
  if (identity.row) ref.row = identity.row;
  else delete ref.row;
}

/**
 * The node's uid, issuing the next one if the node is new. `identity` is what
 * the node is in this snapshot; it replaces the recorded one, so a legitimate
 * change the agent has now seen (a button relabelled) is accepted from here on.
 */
export function assignUid(
  state: TabUids,
  frameId: string,
  loaderId: string,
  backendNodeId: number,
  identity?: UidIdentity,
): number {
  const key = nodeKey(frameId, loaderId, backendNodeId);
  const existing = state.byKey.get(key);
  if (existing !== undefined) {
    const ref = state.byUid.get(existing);
    if (ref) {
      ref.seen = state.seq;
      applyIdentity(ref, identity);
    }
    return existing;
  }
  state.lastUid += 1;
  const uid = state.lastUid;
  state.byKey.set(key, uid);
  const ref: UidNodeRef = { backendNodeId, frameId, loaderId, seen: state.seq };
  applyIdentity(ref, identity);
  state.byUid.set(uid, ref);
  return uid;
}

function forget(state: TabUids, uid: number, ref: UidNodeRef): void {
  state.byUid.delete(uid);
  state.byKey.delete(nodeKey(ref.frameId, ref.loaderId, ref.backendNodeId));
}

/** Drop a uid whose node turned out to be gone. */
export function forgetUid(tabId: number, uid: number): void {
  const state = tabs.get(tabId);
  const ref = state?.byUid.get(uid);
  if (state && ref) forget(state, uid, ref);
}

/** Enforce the per-tab cap, then mirror the state to session storage (best effort, not awaited by callers). */
export async function persistTabUids(tabId: number, state: TabUids): Promise<void> {
  if (state.byUid.size > MAX_ENTRIES_PER_TAB) {
    const byAge = [...state.byUid.entries()].sort((a, b) => a[1].seen - b[1].seen);
    for (const [uid, ref] of byAge.slice(0, state.byUid.size - MAX_ENTRIES_PER_TAB)) {
      forget(state, uid, ref);
    }
  }
  const area = sessionStorage();
  if (!area) return;
  const entries = [...state.byUid.entries()].map(
    ([uid, r]) =>
      [uid, r.backendNodeId, r.frameId, r.loaderId, r.seen, r.role, r.name, r.row] as const,
  );
  try {
    await area.set({
      [STORAGE_PREFIX + tabId]: { lastUid: state.lastUid, seq: state.seq, entries },
    });
  } catch (e) {
    console.warn('[snapshot] could not persist uids:', e);
  }
}

export class UidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UidError';
  }
}

/** Where a uid points. Throws UidError with the next step when it points nowhere. */
export async function lookupUid(tabId: number, uid: number): Promise<UidNodeRef> {
  const state = await getTabUids(tabId);
  const ref = state.byUid.get(uid);
  if (ref) return ref;
  if (state.lastUid === 0) {
    throw new UidError(
      `No snapshot of tab ${tabId} is known (none taken yet, or its uids were lost); call chrome_snapshot first.`,
    );
  }
  if (uid > state.lastUid || uid < 1) {
    throw new UidError(`uid ${uid} was never issued for tab ${tabId}; call chrome_snapshot again.`);
  }
  throw new UidError(
    `uid ${uid} no longer exists on the page (removed or the page navigated); call chrome_snapshot again.`,
  );
}

export function clear(tabId: number): void {
  tabs.delete(tabId);
  const area = sessionStorage();
  if (area) {
    Promise.resolve(area.remove(STORAGE_PREFIX + tabId)).catch(() => {});
  }
}

/** Test seam. */
export function __resetUidStoreForTest(): void {
  tabs.clear();
}
