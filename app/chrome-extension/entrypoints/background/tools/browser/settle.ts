/**
 * Wait-and-report after a page action: the contract every acting tool uses.
 *
 * An action (click, fill, key, navigate) is wrapped in runWithSettle. After it
 * returns, the page is given time to react: a navigation the action started is
 * awaited to load, then the DOM has to go quiet. The caller gets back what the
 * page is now (url, title, whether it navigated, an open JS dialog, tabs the
 * action opened), so an agent does not need a sleep or a screenshot to learn
 * what its click did.
 *
 * The waits follow chrome-devtools-mcp's WaitForHelper: a navigation counts
 * when it starts within a short window after the action, the DOM counts as
 * settled after 100 ms without mutations, and everything is capped by
 * settleTimeoutMs. A hidden tab (a leased tab in the agents window) gets CDP
 * focus emulation for the duration of the action, because background pages
 * otherwise stall focus and wheel handling.
 */

import type { ToolResult } from '@/common/tool-handler';
import { cdpSessionManager } from '@/utils/cdp-session-manager';
import { clearDialog, ensureDialogWatch, getDialog, pingTab, probeDialog } from './dialog-tracker';

export interface PageReport {
  url: string;
  title: string;
  /** The action caused a navigation (a new document, not a same-document hash change). */
  navigated: boolean;
  /** The page was still loading when the settle wait ran out. */
  loading?: boolean;
  /** A JS dialog is open now; input tools are refused until chrome_handle_dialog. */
  dialog?: { type: string; message: string } | null;
  /** Tabs this action opened (openerTabId is the acted-on tab). */
  new_tabs?: Array<{ tabId: number; url: string }>;
  /** Milliseconds spent waiting after the action. */
  settled_ms: number;
  /** The wait hit settleTimeoutMs before the page went quiet. */
  timed_out?: boolean;
}

export interface SettleOptions {
  /** false skips the wait and the report (default true). */
  settle?: boolean;
  /** Upper bound for the wait (default 3000; navigate uses 15000). */
  settleTimeoutMs?: number;
  /**
   * The action is a navigation (chrome_navigate): wait longer for it to start
   * instead of assuming nothing happened after the short start window.
   */
  expectNavigation?: boolean;
}

export const DEFAULT_SETTLE_TIMEOUT_MS = 3000;
export const NAVIGATE_SETTLE_TIMEOUT_MS = 15000;
/** A navigation that starts later than this after the action is not attributed to it. */
const NAVIGATION_START_WINDOW_MS = 150;
/** How long chrome_navigate waits for its navigation to start. */
const EXPECTED_NAVIGATION_START_MS = 2000;
/** The DOM is settled after this long without a mutation. */
const DOM_QUIET_MS = 100;
/** The quiet wait never takes longer than this, whatever the budget. */
const DOM_QUIET_CAP_MS = 3000;
/** Extra time for the injected quiet wait to answer (hidden tabs round timers up to 1 s). */
const DOM_QUIET_ANSWER_SLACK_MS = 1500;
/** Start checking for a dialog blocking a still-running action after this long. */
const BLOCKED_ACTION_CHECK_AFTER_MS = 800;
const BLOCKED_ACTION_CHECK_EVERY_MS = 700;
const LOAD_POLL_MS = 100;
const FOCUS_OWNER = 'settle-focus';

export class DialogOpenError extends Error {
  constructor(
    public readonly tabId: number,
    public readonly dialog: { type: string; message: string },
    /** The action itself raised the dialog (it ran; the page now waits on the dialog). */
    public readonly openedByAction: boolean = false,
  ) {
    super(
      openedByAction
        ? `The action ran and opened a JS ${dialog.type} dialog on tab ${tabId}: "${dialog.message}". ` +
            'The page is blocked until you answer it with chrome_handle_dialog (accept or dismiss). ' +
            'Do not repeat the action.'
        : `A JS ${dialog.type} dialog is open on tab ${tabId}: "${dialog.message}". ` +
            'Nothing was done. Answer it with chrome_handle_dialog first.',
    );
    this.name = 'DialogOpenError';
  }
}

/**
 * Throw DialogOpenError when a JS dialog is open on the tab. Input tools call
 * it before acting: CDP input into a page blocked by a dialog hangs until timeout.
 * Only a dialog Chrome reported refuses the call; a suspected one does not.
 */
export function assertNoOpenDialog(tabId: number): void {
  const dialog = getDialog(tabId);
  if (dialog?.confirmed) {
    throw new DialogOpenError(tabId, { type: dialog.type, message: dialog.message });
  }
}

/** The open dialog on a tab, if one is tracked (confirmed or suspected). */
export function openDialog(tabId: number): { type: string; message: string } | null {
  const dialog = getDialog(tabId);
  return dialog ? { type: dialog.type, message: dialog.message } : null;
}

// ---------------------------------------------------------------------------
// Navigation and new-tab watching
// ---------------------------------------------------------------------------

interface NavigationWatch {
  started: () => boolean;
  /** A new document committed in the main frame. */
  committed: () => boolean;
  finished: () => boolean;
  newTabs: () => Array<{ tabId: number; url: string }>;
  stop: () => void;
}

function watchTab(tabId: number): NavigationWatch {
  let started = false;
  let committed = false;
  let finished = false;
  const created: chrome.tabs.Tab[] = [];

  const onBefore = (d: chrome.webNavigation.WebNavigationParentedCallbackDetails) => {
    if (d.tabId !== tabId || d.frameId !== 0) return;
    started = true;
    finished = false;
  };
  const onCommitted = (d: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
    if (d.tabId !== tabId || d.frameId !== 0) return;
    started = true;
    committed = true;
  };
  const onCompleted = (d: chrome.webNavigation.WebNavigationFramedCallbackDetails) => {
    if (d.tabId !== tabId || d.frameId !== 0) return;
    finished = true;
  };
  const onError = (d: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails) => {
    if (d.tabId !== tabId || d.frameId !== 0) return;
    finished = true;
  };
  const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
    if (id !== tabId) return;
    if (info.status === 'loading') {
      started = true;
      finished = false;
    } else if (info.status === 'complete' && started) {
      finished = true;
    }
  };
  const onCreated = (tab: chrome.tabs.Tab) => {
    if (tab.openerTabId === tabId && typeof tab.id === 'number') created.push(tab);
  };

  const wn = chrome.webNavigation;
  wn?.onBeforeNavigate?.addListener(onBefore);
  wn?.onCommitted?.addListener(onCommitted);
  wn?.onCompleted?.addListener(onCompleted);
  wn?.onErrorOccurred?.addListener(onError);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onCreated.addListener(onCreated);

  return {
    started: () => started,
    committed: () => committed,
    finished: () => finished,
    newTabs: () =>
      created.map((t) => ({ tabId: t.id as number, url: t.pendingUrl || t.url || '' })),
    stop: () => {
      wn?.onBeforeNavigate?.removeListener(onBefore);
      wn?.onCommitted?.removeListener(onCommitted);
      wn?.onCompleted?.removeListener(onCompleted);
      wn?.onErrorOccurred?.removeListener(onError);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onCreated.removeListener(onCreated);
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTabSafe(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

/** Wait until the tab reports status 'complete' (or the watch saw the load end). */
async function waitForLoad(
  tabId: number,
  deadline: number,
  watch?: NavigationWatch,
): Promise<boolean> {
  while (Date.now() < deadline) {
    if (watch?.finished()) return true;
    const tab = await getTabSafe(tabId);
    if (!tab) return true;
    // A tab created with a URL reports 'complete' for its initial blank page
    // while pendingUrl still names the page it is about to load.
    if (
      tab.status === 'complete' &&
      !tab.pendingUrl &&
      (!watch || !watch.started() || watch.committed())
    ) {
      return true;
    }
    await delay(LOAD_POLL_MS);
  }
  return false;
}

// ---------------------------------------------------------------------------
// DOM quiet
// ---------------------------------------------------------------------------

interface QuietResult {
  timed_out: boolean;
}

/** Runs in the page (isolated world): resolve after quietMs without DOM mutations, or at maxMs. */
function waitDomQuietInPage(quietMs: number, maxMs: number): Promise<QuietResult> {
  return new Promise(function (resolve) {
    let done = false;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;
    function finish(timedOut: boolean) {
      if (done) return;
      done = true;
      if (observer) observer.disconnect();
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      resolve({ timed_out: timedOut });
    }
    const hardTimer = setTimeout(function () {
      finish(true);
    }, maxMs);
    try {
      observer = new MutationObserver(function () {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(function () {
          finish(false);
        }, quietMs);
      });
      observer.observe(document.documentElement || document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    } catch (e) {
      finish(false);
      return;
    }
    quietTimer = setTimeout(function () {
      finish(false);
    }, quietMs);
  });
}

/**
 * Wait for the DOM to go quiet. 'blocked' means the page did not answer at all
 * (a dialog, or a hung page); 'unavailable' means injection is not possible here.
 */
async function waitDomQuiet(
  tabId: number,
  maxMs: number,
): Promise<'quiet' | 'timed_out' | 'blocked' | 'unavailable'> {
  if (maxMs <= 0) return 'timed_out';
  const ping = await pingTab(tabId);
  if (ping !== 'ok') return ping;
  const budget = Math.min(maxMs, DOM_QUIET_CAP_MS);
  const injected = chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [0] },
      func: waitDomQuietInPage,
      args: [DOM_QUIET_MS, budget],
    })
    .then(
      (results) => (results?.[0]?.result as QuietResult | undefined) ?? { timed_out: false },
      () => null,
    );
  const answer = await Promise.race([
    injected,
    delay(budget + DOM_QUIET_ANSWER_SLACK_MS).then(() => 'late' as const),
  ]);
  if (answer === 'late') return 'blocked';
  if (answer === null) return 'unavailable';
  return answer.timed_out ? 'timed_out' : 'quiet';
}

// ---------------------------------------------------------------------------
// Focus emulation for hidden tabs
// ---------------------------------------------------------------------------

async function enableFocusEmulation(tab: chrome.tabs.Tab | null): Promise<boolean> {
  if (!tab || typeof tab.id !== 'number' || tab.active) return false;
  try {
    await cdpSessionManager.attach(tab.id, FOCUS_OWNER);
  } catch {
    return false;
  }
  try {
    await cdpSessionManager.sendCommand(tab.id, 'Emulation.setFocusEmulationEnabled', {
      enabled: true,
    });
    return true;
  } catch {
    await cdpSessionManager.detach(tab.id, FOCUS_OWNER).catch(() => undefined);
    return false;
  }
}

async function disableFocusEmulation(tabId: number): Promise<void> {
  // Detaching the last owner resets the emulation; with other owners left the
  // page keeps believing it is focused, which is harmless.
  await cdpSessionManager.detach(tabId, FOCUS_OWNER).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Dialog raised by the action itself
// ---------------------------------------------------------------------------

/**
 * Resolve with a dialog when one blocks the tab while the action is still
 * running (a click that opens confirm() never gets its reply). Stops when
 * `isDone` turns true.
 */
async function watchForBlockingDialog(
  tabId: number,
  isDone: () => boolean,
): Promise<{ type: string; message: string } | null> {
  await delay(BLOCKED_ACTION_CHECK_AFTER_MS);
  while (!isDone()) {
    const tracked = getDialog(tabId);
    if (tracked?.confirmed) return { type: tracked.type, message: tracked.message };
    const ping = await pingTab(tabId);
    if (isDone()) return null;
    if (ping === 'blocked') {
      const found = await probeDialog(tabId);
      if (found?.confirmed) return { type: found.type, message: found.message };
    }
    await delay(BLOCKED_ACTION_CHECK_EVERY_MS);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Wait for a tab to settle after something already started it (a tab just
 * created with a URL, a navigation issued elsewhere) and report it.
 */
export async function settleTab(
  tabId: number,
  options: SettleOptions = {},
): Promise<PageReport | null> {
  if (options.settle === false) return null;
  const started = Date.now();
  const deadline = started + (options.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS);
  const loaded = await waitForLoad(tabId, deadline);
  return finishReport(tabId, started, deadline, { navigated: true, loaded, newTabs: [] });
}

async function finishReport(
  tabId: number,
  started: number,
  deadline: number,
  state: { navigated: boolean; loaded: boolean; newTabs: Array<{ tabId: number; url: string }> },
): Promise<PageReport> {
  let timedOut = !state.loaded;
  if (state.loaded) {
    const quiet = await waitDomQuiet(tabId, deadline - Date.now());
    if (quiet === 'timed_out') timedOut = true;
    if (quiet === 'blocked') await probeDialog(tabId);
  }
  const tab = await getTabSafe(tabId);
  const report: PageReport = {
    url: tab?.url ?? '',
    title: tab?.title ?? '',
    navigated: state.navigated,
    dialog: openDialog(tabId),
    settled_ms: Date.now() - started,
  };
  if (tab && tab.status === 'loading') report.loading = true;
  if (timedOut) report.timed_out = true;
  if (state.newTabs.length) report.new_tabs = state.newTabs;
  return report;
}

/**
 * Run `action` against `tabId`, then wait for the page to settle and report it.
 * With settle:false the action runs alone and page is null.
 *
 * When the action itself opens a JS dialog, the action never returns (the page
 * is blocked); this detects that and throws DialogOpenError(openedByAction).
 */
export async function runWithSettle<T>(
  tabId: number,
  action: () => Promise<T>,
  options: SettleOptions = {},
): Promise<{ result: T; page: PageReport | null }> {
  if (options.settle === false) return { result: await action(), page: null };

  const timeoutMs =
    options.settleTimeoutMs ??
    (options.expectNavigation ? NAVIGATE_SETTLE_TIMEOUT_MS : DEFAULT_SETTLE_TIMEOUT_MS);
  const before = await getTabSafe(tabId);
  const beforeUrl = before?.url ?? '';
  // A navigation needs no focus; only input into a hidden tab does.
  // Page domain on before acting, so a dialog the action opens is reported and answerable.
  await ensureDialogWatch(tabId);
  const focusEmulated = options.expectNavigation ? false : await enableFocusEmulation(before);
  const watch = watchTab(tabId);

  let result: T;
  let actionDone = false;
  try {
    // Never rejects: an action that loses the race to a dialog may fail much
    // later, and that must not surface as an unhandled rejection.
    const running = action().then(
      (value) => ({ kind: 'done' as const, value }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    );
    running.then(() => {
      actionDone = true;
    });
    const outcome = await Promise.race([
      running,
      watchForBlockingDialog(tabId, () => actionDone).then((dialog) =>
        dialog ? { kind: 'dialog' as const, dialog } : new Promise<never>(() => undefined),
      ),
    ]);
    if (outcome.kind === 'dialog') throw new DialogOpenError(tabId, outcome.dialog, true);
    if (outcome.kind === 'error') throw outcome.error;
    result = outcome.value;
  } catch (error) {
    watch.stop();
    if (focusEmulated) await disableFocusEmulation(tabId);
    throw error;
  }
  if (focusEmulated) await disableFocusEmulation(tabId);

  const started = Date.now();
  const deadline = started + timeoutMs;
  try {
    // Give a navigation the action triggered a moment to start.
    const startWindow = options.expectNavigation
      ? Math.min(EXPECTED_NAVIGATION_START_MS, timeoutMs)
      : NAVIGATION_START_WINDOW_MS;
    const startBy = started + startWindow;
    while (!watch.started() && Date.now() < startBy) await delay(25);

    let loaded = true;
    if (watch.started()) loaded = await waitForLoad(tabId, deadline, watch);
    const after = await getTabSafe(tabId);
    const navigated = watch.committed() || (!!after?.url && after.url !== beforeUrl);
    return {
      result,
      page: await finishReport(tabId, started, deadline, {
        navigated,
        loaded,
        newTabs: watch.newTabs(),
      }),
    };
  } finally {
    watch.stop();
  }
}

/** One compact line for a tool reply, e.g. `page: navigated to https://x (Title); dialog: confirm "Sure?"`. */
export function formatPageReport(page: PageReport | null): string {
  if (!page) return '';
  const parts = [
    `page: ${page.navigated ? 'navigated to ' : ''}${page.url}${page.title ? ` (${page.title})` : ''}`,
  ];
  if (page.loading) parts.push('still loading');
  if (page.timed_out) parts.push(`did not settle within ${page.settled_ms} ms`);
  if (page.dialog) {
    parts.push(
      `dialog open: ${page.dialog.type} "${page.dialog.message}" (use chrome_handle_dialog)`,
    );
  }
  if (page.new_tabs?.length) {
    parts.push(
      `opened tabs: ${page.new_tabs.map((t) => `${t.tabId} ${t.url}`).join(', ')} (lease one with chrome_lease_tab adopt_tab_id)`,
    );
  }
  return parts.join('; ');
}

/**
 * Put the page report on a tool reply: as a `page` field when the reply text is
 * a JSON object, otherwise as one more line.
 */
export function appendPageReport(result: ToolResult, page: PageReport | null): ToolResult {
  if (!page || result.isError) return result;
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;
  let text = first.text;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      text = JSON.stringify({ ...parsed, page });
    } else {
      text = `${text}\n${formatPageReport(page)}`;
    }
  } catch {
    text = `${text}\n${formatPageReport(page)}`;
  }
  return { ...result, content: [{ ...first, text }, ...result.content.slice(1)] };
}

/** Test seam. */
export const __settleInternals = { waitDomQuietInPage, watchTab, clearDialog };
