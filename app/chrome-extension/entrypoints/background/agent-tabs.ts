/**
 * Tabs for parallel agents (chrome_lease_tab / chrome_release_tab).
 *
 * The bridge asks for a tab per lease; the extension opens it without ever
 * focusing anything, so agents working in parallel do not fight over the
 * user's active tab. By default every agent tab lives in one shared "agents"
 * window per profile; own_window gives a tab a window of its own, which keeps
 * it the visible tab of that window (screenshots, chrome_computer). A capture
 * that needs a visible tab moves a hidden agents-window tab out on its own
 * (promoteToOwnWindow), so own_window is an optimisation, not a requirement.
 */

const AGENT_WINDOW_KEY = 'agentWindowId';
const DEFAULT_URL = 'about:blank';

export interface AgentTabOpenArgs {
  url?: unknown;
  own_window?: unknown;
}

export interface AgentTab {
  tabId: number;
  windowId: number;
}

// Survives a service-worker restart via storage.session; verified before use.
let agentWindowId: number | null = null;

async function rememberedAgentWindow(): Promise<number | null> {
  let id = agentWindowId;
  if (id === null) {
    try {
      const stored = await chrome.storage.session.get(AGENT_WINDOW_KEY);
      const value = stored[AGENT_WINDOW_KEY];
      id = typeof value === 'number' ? value : null;
    } catch {
      id = null;
    }
  }
  if (id === null) return null;
  try {
    await chrome.windows.get(id);
    agentWindowId = id;
    return id;
  } catch {
    // The user closed it (or it closed with its last tab).
    agentWindowId = null;
    return null;
  }
}

async function rememberAgentWindow(id: number): Promise<void> {
  agentWindowId = id;
  try {
    await chrome.storage.session.set({ [AGENT_WINDOW_KEY]: id });
  } catch {
    // Memory alone is enough until the next service-worker restart.
  }
}

async function openWindow(url: string): Promise<AgentTab> {
  const win = await chrome.windows.create({ url, focused: false });
  const tab = win?.tabs?.[0];
  if (!win || typeof win.id !== 'number' || typeof tab?.id !== 'number') {
    throw new Error('Chrome did not return the new window and its tab.');
  }
  return { tabId: tab.id, windowId: win.id };
}

export async function openAgentTab(args: AgentTabOpenArgs): Promise<AgentTab> {
  const url = typeof args?.url === 'string' && args.url.trim() !== '' ? args.url : DEFAULT_URL;
  if (args?.own_window === true) return openWindow(url);

  const windowId = await rememberedAgentWindow();
  if (windowId !== null) {
    const tab = await chrome.tabs.create({ windowId, url, active: false });
    if (typeof tab.id !== 'number') throw new Error('Chrome did not return the new tab.');
    return { tabId: tab.id, windowId };
  }
  const created = await openWindow(url);
  await rememberAgentWindow(created.windowId);
  return created;
}

/**
 * Move a tab out of the shared agents window into an unfocused window of its
 * own, where it is the visible tab (captureVisibleTab only shoots that one).
 * Returns the new window id, or null when the tab is not in the agents window:
 * a tab anywhere else is the user's (or adopted from the user) and stays put.
 */
export async function promoteToOwnWindow(tabId: number): Promise<number | null> {
  const windowId = await rememberedAgentWindow();
  if (windowId === null) return null;
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
  if (tab.windowId !== windowId) return null;
  const win = await chrome.windows.create({ tabId, focused: false });
  if (!win || typeof win.id !== 'number') {
    throw new Error('Chrome did not return the window the tab was moved to.');
  }
  return win.id;
}

export interface AgentTabInfo {
  exists: boolean;
  tabId: number;
  windowId?: number;
  url?: string;
  /** Chrome's tab status: 'loading' or 'complete'. */
  status?: string;
  title?: string;
  /** The wait ran out before the tab finished loading. */
  timed_out?: boolean;
}

const MAX_TAB_WAIT_MS = 120_000;

function describeTab(tabId: number, tab: chrome.tabs.Tab | null, timedOut = false): AgentTabInfo {
  if (!tab) return { exists: false, tabId };
  return {
    exists: true,
    tabId,
    windowId: tab.windowId,
    url: tab.url || tab.pendingUrl || '',
    status: tab.status,
    title: tab.title,
    ...(timedOut ? { timed_out: true } : {}),
  };
}

async function getTabOrNull(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

function waitMs(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(0, n), MAX_TAB_WAIT_MS);
}

/**
 * Resolve when the tab reports status 'complete' (or closes, or the wait runs
 * out). `start` runs after the listeners are attached; when it is given only a
 * load that starts after it counts (a 'loading' or URL change, then
 * 'complete'), so a navigation cannot be satisfied by the page it replaces
 * finishing its own load.
 */
function waitTabComplete(
  tabId: number,
  timeoutMs: number,
  start?: () => Promise<unknown>,
): Promise<AgentTabInfo> {
  return new Promise((resolve, reject) => {
    let done = false;
    let started = !start;
    const detach = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
    const finish = (info: AgentTabInfo) => {
      if (done) return;
      done = true;
      detach();
      resolve(info);
    };
    const onUpdated = (
      id: number,
      change: { status?: string; url?: string },
      tab: chrome.tabs.Tab,
    ) => {
      if (id !== tabId) return;
      if (change.status === 'loading' || change.url !== undefined) started = true;
      if (started && change.status === 'complete') finish(describeTab(tabId, tab));
    };
    const onRemoved = (id: number) => {
      if (id === tabId) finish(describeTab(tabId, null));
    };
    const timer = setTimeout(() => {
      void getTabOrNull(tabId).then((tab) => finish(describeTab(tabId, tab, tab !== null)));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    if (start) {
      // Promise.resolve().then: a start that throws synchronously still detaches.
      Promise.resolve()
        .then(start)
        .catch((error) => {
          if (done) return;
          done = true;
          detach();
          reject(error);
        });
      return;
    }
    void getTabOrNull(tabId).then((tab) => {
      if (!tab || tab.status === 'complete') finish(describeTab(tabId, tab));
    });
  });
}

/** Where a tab is and whether it finished loading; wait_complete_ms waits for that. */
export async function agentTabInfo(args: {
  tabId?: unknown;
  wait_complete_ms?: unknown;
}): Promise<AgentTabInfo> {
  const tabId = args?.tabId;
  if (typeof tabId !== 'number') throw new Error('tabId must be a number.');
  const wait = waitMs(args?.wait_complete_ms, 0);
  if (wait === 0) return describeTab(tabId, await getTabOrNull(tabId));
  return waitTabComplete(tabId, wait);
}

/**
 * Load a URL in a tab and wait for the new page to finish loading. The tab
 * must exist: unlike chrome_navigate there is no fallback to another tab.
 */
export async function navigateAgentTab(args: {
  tabId?: unknown;
  url?: unknown;
  timeout_ms?: unknown;
}): Promise<AgentTabInfo> {
  const tabId = args?.tabId;
  const url = args?.url;
  if (typeof tabId !== 'number') throw new Error('tabId must be a number.');
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('url must be an http(s) URL.');
  }
  const current = await getTabOrNull(tabId);
  if (!current) return describeTab(tabId, null);
  // A change of the hash alone loads nothing, so there is no load to wait for.
  const withoutHash = (u: string) => u.replace(/#.*$/, '');
  if (current.url && withoutHash(current.url) === withoutHash(url) && current.url !== url) {
    await chrome.tabs.update(tabId, { url });
    return describeTab(tabId, await getTabOrNull(tabId));
  }
  return waitTabComplete(tabId, waitMs(args?.timeout_ms, 60_000), () =>
    chrome.tabs.update(tabId, { url }),
  );
}

/**
 * Close a tab. `gone` says whether it is really gone afterwards: a page with a
 * leave-page prompt can outlive the call.
 */
export async function closeAgentTab(tabId: unknown): Promise<{ closed: boolean; gone: boolean }> {
  if (typeof tabId !== 'number') throw new Error('tabId must be a number.');
  let closed: boolean;
  try {
    await chrome.tabs.remove(tabId);
    closed = true;
  } catch {
    // Already gone: releasing a lease on a closed tab is fine.
    closed = false;
  }
  return { closed, gone: (await getTabOrNull(tabId)) === null };
}
