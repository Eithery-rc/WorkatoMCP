/**
 * Tabs for parallel agents (chrome_lease_tab / chrome_release_tab).
 *
 * The bridge asks for a tab per lease; the extension opens it without ever
 * focusing anything, so agents working in parallel do not fight over the
 * user's active tab. By default every agent tab lives in one shared "agents"
 * window per profile; own_window gives a tab a window of its own, which keeps
 * it the visible tab of that window (screenshots, chrome_computer).
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

export async function closeAgentTab(tabId: unknown): Promise<{ closed: boolean }> {
  if (typeof tabId !== 'number') throw new Error('tabId must be a number.');
  try {
    await chrome.tabs.remove(tabId);
    return { closed: true };
  } catch {
    // Already gone: releasing a lease on a closed tab is fine.
    return { closed: false };
  }
}
