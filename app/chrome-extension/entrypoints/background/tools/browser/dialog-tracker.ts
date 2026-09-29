/**
 * Which tabs have a JS dialog (alert/confirm/prompt/beforeunload) open.
 *
 * A dialog blocks the page's main thread: script injection and CDP input into
 * that tab hang until someone answers it. Input tools ask this module first so
 * they can refuse at once instead of timing out, and the settle step uses it
 * to report a dialog that an action opened.
 *
 * Two sources:
 * - CDP Page.javascriptDialogOpening/Closed, on any debugger session of ours
 *   that has the Page domain enabled (a global chrome.debugger.onEvent
 *   listener sees them all). This is a CONFIRMED dialog.
 * - A probe for a tab that stopped answering script injection: attach, enable
 *   Page (Chrome reports a dialog that is already showing to a client that
 *   enables the domain) and wait briefly for the event. When no event comes,
 *   the tab is only SUSPECTED: reported, but input is not refused on a guess.
 */

import { cdpSessionManager } from '@/utils/cdp-session-manager';

export interface TrackedDialog {
  type: string;
  message: string;
  /** true when CDP reported it; false when the page merely stopped answering. */
  confirmed: boolean;
  at: number;
}

const dialogs = new Map<number, TrackedDialog>();
let listenersRegistered = false;

const PING_TIMEOUT_MS = 400;
const PROBE_EVENT_WAIT_MS = 400;
const PROBE_OWNER = 'dialog-probe';

/** chrome.debugger.onEvent handler: CDP dialog events from any of our sessions. */
export function handleDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params?: any,
): void {
  const tabId = source.tabId;
  if (typeof tabId !== 'number') return;
  if (method === 'Page.javascriptDialogOpening') {
    dialogs.set(tabId, {
      type: String(params?.type ?? 'alert'),
      message: String(params?.message ?? ''),
      confirmed: true,
      at: Date.now(),
    });
  } else if (method === 'Page.javascriptDialogClosed') {
    dialogs.delete(tabId);
  }
}

function registerListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;
  try {
    chrome.debugger.onEvent.addListener(handleDebuggerEvent);
  } catch (e) {
    console.warn('[dialog-tracker] could not register debugger.onEvent listener:', e);
  }
  try {
    chrome.tabs.onRemoved.addListener((tabId) => dialogs.delete(tabId));
  } catch {
    /* tabs API unavailable in tests */
  }
  try {
    // A new document in the main frame means the old page, and its dialog, are gone.
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId === 0) dialogs.delete(details.tabId);
    });
  } catch {
    /* webNavigation unavailable in tests */
  }
}

registerListeners();

// ---------------------------------------------------------------------------
// Dialog watch: a debugger session with the Page domain enabled BEFORE acting
// ---------------------------------------------------------------------------

/**
 * Chrome lets a CDP client answer a dialog only when that client had the Page
 * domain enabled when the dialog opened; a client that attaches afterwards is
 * told "No dialog is showing". So every acting tool arms a watch first, and the
 * watch outlives the action while a dialog is open.
 */
const WATCH_OWNER = 'dialog-watch';
const WATCH_IDLE_MS = 60_000;
const WATCH_ENABLE_TIMEOUT_MS = 1500;
const watchTimers = new Map<number, ReturnType<typeof setTimeout>>();
const watching = new Set<number>();

function scheduleWatchRelease(tabId: number): void {
  const prev = watchTimers.get(tabId);
  if (prev) clearTimeout(prev);
  watchTimers.set(
    tabId,
    setTimeout(() => {
      watchTimers.delete(tabId);
      // Keep the session while a dialog is open: dropping it loses the only
      // client that can answer the dialog.
      if (dialogs.get(tabId)?.confirmed) {
        scheduleWatchRelease(tabId);
        return;
      }
      if (!watching.delete(tabId)) return;
      cdpSessionManager.detach(tabId, WATCH_OWNER).catch(() => undefined);
    }, WATCH_IDLE_MS),
  );
}

/** In-flight watch attaches, shared by concurrent callers so each tab holds one watch ref. */
const pendingWatch = new Map<number, Promise<void>>();

async function attachWatch(tabId: number): Promise<void> {
  if (watching.has(tabId)) return;
  let pending = pendingWatch.get(tabId);
  if (!pending) {
    pending = cdpSessionManager
      .attach(tabId, WATCH_OWNER)
      .then(() => {
        watching.add(tabId);
      })
      .finally(() => pendingWatch.delete(tabId));
    pendingWatch.set(tabId, pending);
  }
  await pending;
}

/** Arm the dialog watch on a tab (idempotent). Never throws. */
export async function ensureDialogWatch(tabId: number): Promise<void> {
  try {
    await attachWatch(tabId);
    // Enable while the page still answers; do not hang on a page that does not.
    await Promise.race([
      cdpSessionManager
        .sendCommand(tabId, 'Page.enable', undefined, { timeoutMs: WATCH_ENABLE_TIMEOUT_MS })
        .catch(() => undefined),
      delay(WATCH_ENABLE_TIMEOUT_MS),
    ]);
  } catch {
    // Another debugger (DevTools) owns the tab: dialogs are still reported by
    // pingTab/probeDialog, just not answerable by us.
  }
  scheduleWatchRelease(tabId);
}

/** True when this extension holds a Page-enabled session on the tab (so a dialog can be answered). */
export function isDialogWatched(tabId: number): boolean {
  return watching.has(tabId);
}

try {
  chrome.debugger.onDetach.addListener((source) => {
    if (typeof source.tabId === 'number') watching.delete(source.tabId);
  });
} catch {
  /* debugger API unavailable in tests */
}

/** The dialog tracked for a tab, confirmed or suspected. */
export function getDialog(tabId: number): TrackedDialog | null {
  return dialogs.get(tabId) ?? null;
}

/** Forget a tab's dialog: it was answered, or the tab proved responsive. */
export function clearDialog(tabId: number): void {
  dialogs.delete(tabId);
}

/** Record a dialog seen some other way (tests, or a caller that saw the event). */
export function noteDialog(tabId: number, dialog: Omit<TrackedDialog, 'at'>): void {
  dialogs.set(tabId, { ...dialog, at: Date.now() });
}

function pingInPage(): number {
  return 1;
}

/**
 * Does the tab's main frame still run injected script? A tab blocked by a JS
 * dialog does not answer; a tab that answers has no dialog open.
 * Resolves 'ok', 'blocked' (no answer in time) or 'unavailable' (injection
 * refused, e.g. chrome:// pages or a frame torn down by navigation).
 */
export function pingTab(
  tabId: number,
  timeoutMs = PING_TIMEOUT_MS,
): Promise<'ok' | 'blocked' | 'unavailable'> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve('blocked');
    }, timeoutMs);
    chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: pingInPage }).then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dialogs.delete(tabId);
        resolve('ok');
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve('unavailable');
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find out whether a tab that stopped answering has a dialog open. Enables the
 * Page domain on a short-lived debugger session and waits for Chrome to
 * report the pending dialog. Returns the tracked dialog (confirmed, or a
 * suspected one when the page is blocked but no event arrived).
 */
export async function probeDialog(tabId: number): Promise<TrackedDialog | null> {
  const known = dialogs.get(tabId);
  if (known?.confirmed) return known;
  try {
    await cdpSessionManager.withSession(tabId, PROBE_OWNER, async () => {
      // Never await Page.enable here: the probe runs exactly when the page does
      // not answer, and the renderer half of Page.enable waits on the page. Fire
      // it and watch for the dialog event for a short window instead, so the
      // session is always released.
      cdpSessionManager
        .sendCommand(tabId, 'Page.enable', undefined, { timeoutMs: PROBE_EVENT_WAIT_MS })
        .catch(() => undefined);
      const until = Date.now() + PROBE_EVENT_WAIT_MS;
      while (Date.now() < until && !dialogs.get(tabId)?.confirmed) {
        await delay(50);
      }
    });
  } catch {
    // Another debugger client owns the tab, or it closed: fall through to the guess.
  }
  const found = dialogs.get(tabId);
  if (found?.confirmed) return found;
  // Not stored: a heavy page that is merely slow must not be reported as a
  // dialog (an agent would try to answer it). Callers get the guess to word an
  // error, nothing more.
  return {
    type: 'unknown',
    message:
      'The page stopped answering scripts; a JS dialog (alert/confirm/prompt) is probably open, or the page is busy.',
    confirmed: false,
    at: Date.now(),
  };
}
