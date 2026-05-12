/**
 * Debugger session manager for the snapshot tool family.
 *
 * Strategy: attach the CDP debugger to a tab on first snapshot/interaction
 * call, keep it attached, and auto-detach after 60s of idle. Every call must
 * go through ensureAttached() so the idle timer is reset.
 *
 * This wraps cdpSessionManager and never calls chrome.debugger.attach
 * directly. Owner tag is 'snapshot'.
 */

import { cdpSessionManager } from '@/utils/cdp-session-manager';
import { clear as clearUidStore } from './uid-store';

const OWNER_TAG = 'snapshot';
const IDLE_TIMEOUT_MS = 60_000;

const attachedTabs = new Set<number>();
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>();

let detachListenerRegistered = false;

function registerDetachListener() {
  if (detachListenerRegistered) return;
  detachListenerRegistered = true;
  try {
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (typeof source.tabId !== 'number') return;
      const tabId = source.tabId;
      if (!attachedTabs.has(tabId)) return;
      console.log(
        `[snapshot] external debugger detach on tab ${tabId} (reason=${reason}) — dropping state`,
      );
      attachedTabs.delete(tabId);
      const timer = idleTimers.get(tabId);
      if (timer) {
        clearTimeout(timer);
        idleTimers.delete(tabId);
      }
      clearUidStore(tabId);
    });
  } catch (e) {
    console.warn('[snapshot] could not register debugger.onDetach listener:', e);
  }
}

function scheduleIdleDetach(tabId: number) {
  const prev = idleTimers.get(tabId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(async () => {
    idleTimers.delete(tabId);
    if (!attachedTabs.has(tabId)) return;
    console.log(`[snapshot] idle ${IDLE_TIMEOUT_MS}ms — detaching tab ${tabId}`);
    attachedTabs.delete(tabId);
    clearUidStore(tabId);
    try {
      await cdpSessionManager.detach(tabId, OWNER_TAG);
    } catch (e) {
      console.warn(`[snapshot] error during idle detach for tab ${tabId}:`, e);
    }
  }, IDLE_TIMEOUT_MS);
  idleTimers.set(tabId, timer);
}

/**
 * Ensure the debugger is attached to this tab with the DOM and Accessibility
 * domains enabled. Idempotent — safe to call before every CDP command.
 * Resets the 60s idle timer.
 */
export async function ensureAttached(tabId: number): Promise<void> {
  registerDetachListener();

  if (!attachedTabs.has(tabId)) {
    await cdpSessionManager.attach(tabId, OWNER_TAG);
    try {
      await cdpSessionManager.sendCommand(tabId, 'DOM.enable');
      await cdpSessionManager.sendCommand(tabId, 'Accessibility.enable');
    } catch (e) {
      // If domain enable fails, drop the attach so we don't hold a useless session.
      try {
        await cdpSessionManager.detach(tabId, OWNER_TAG);
      } catch {
        /* best-effort */
      }
      throw e;
    }
    attachedTabs.add(tabId);
  }

  scheduleIdleDetach(tabId);
}

/**
 * Pass-through to cdpSessionManager.sendCommand, scoped to our owner.
 * Caller is responsible for calling ensureAttached() first.
 */
export async function sendCommand<T = any>(
  tabId: number,
  method: string,
  params?: object,
): Promise<T> {
  return cdpSessionManager.sendCommand<T>(tabId, method, params);
}
