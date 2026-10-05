/**
 * One reading for chrome_watch_start: run the watch script in each target tab
 * and return what it returned. The bridge owns the schedule and decides what
 * counts as a change.
 *
 * Engine: chrome.userScripts.execute when the user allowed user scripts for
 * this extension (page CSP does not apply, no debugger banner). Otherwise CDP
 * Runtime.evaluate, which works everywhere but shows Chrome's "started
 * debugging this browser" banner while it runs.
 */
import { cdpSessionManager } from '@/utils/cdp-session-manager';
import { busyTabs } from './tools/tab-queue';

interface ProbePayload {
  script?: string;
  tabIds?: number[];
  urls?: string[];
  timeoutMs?: number;
  maxTabs?: number;
  /**
   * Origin each explicitly named tab showed when the watch first read it. A
   * tab now on another origin (navigated away, or its id reused after a
   * browser restart) is refused, never read.
   */
  origins?: Record<string, string>;
  /**
   * The engine the watch started on. A watch started on 'cdp' stays there:
   * the user-script world cannot see page globals, so switching mid-watch
   * could change what the script returns.
   */
  engine?: 'userScripts' | 'cdp';
}

interface ProbeResult {
  tabId: number;
  url?: string;
  title?: string;
  ok: boolean;
  value?: unknown;
  error?: string;
  skipped?: string;
  gone?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_TABS = 10;

const USER_SCRIPTS_NOTE =
  'Running through the debugger, so Chrome shows its debugging banner on each reading. Turn on ' +
  '"Allow User Scripts" in chrome://extensions > WorkatoMCP > Details (in this Chrome profile) ' +
  'and watches started after that run without it.';

/**
 * The agent's script as the body of an async function. Errors and the JSON
 * encoding happen in the page, so every engine returns the same shape and a
 * DOM node in the result fails as a message rather than a structured-clone
 * error.
 */
function wrapScript(script: string, timeoutMs: number): string {
  // A little under the probe timeout, so the page reports its own timeout.
  const pageMs = Math.max(1000, timeoutMs - 1000);
  return `(async () => {
  try {
    const value = await Promise.race([
      (async () => {
${script}
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('the script did not finish within ${pageMs} ms')), ${pageMs}),
      ),
    ]);
    return { ok: true, json: value === undefined ? undefined : JSON.stringify(value) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
})()`;
}

function unwrap(raw: any): { ok: boolean; value?: unknown; error?: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'the script returned nothing' };
  if (!raw.ok) return { ok: false, error: raw.error || 'the script failed' };
  if (raw.json === undefined) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw.json) };
  } catch {
    return { ok: false, error: 'the result is not JSON' };
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function userScriptsAvailable(): Promise<boolean> {
  const api = (chrome as any).userScripts;
  if (!api || typeof api.execute !== 'function') return false;
  try {
    // Throws while "Allow User Scripts" is off.
    await api.getScripts();
    return true;
  } catch {
    return false;
  }
}

async function runViaUserScripts(tabId: number, code: string, timeoutMs: number): Promise<any> {
  const results = await withTimeout<any[]>(
    (chrome as any).userScripts.execute({
      target: { tabId },
      js: [{ code }],
      world: 'USER_SCRIPT',
      injectImmediately: true,
    }),
    timeoutMs,
  );
  const first = results?.[0];
  if (first?.error) throw new Error(String(first.error));
  return first?.result;
}

async function runViaCdp(tabId: number, code: string, timeoutMs: number): Promise<any> {
  const response = await withTimeout<any>(
    cdpSessionManager.withSession(tabId, 'watch-probe', () =>
      cdpSessionManager.sendCommand(
        tabId,
        'Runtime.evaluate',
        {
          expression: code,
          returnByValue: true,
          awaitPromise: true,
          timeout: timeoutMs,
        },
        // Its own ceiling, so a hung page releases the debugger (and its
        // banner) with the probe instead of after the 115 s default.
        { timeoutMs: timeoutMs + 500 },
      ),
    ),
    timeoutMs + 1000,
  );
  if (response?.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        'the script threw',
    );
  }
  return response?.result?.value;
}

function originOf(url: string | undefined): string {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
}

async function resolveTabs(
  payload: ProbePayload,
): Promise<{ tabs: chrome.tabs.Tab[]; gone: number[] }> {
  const found = new Map<number, chrome.tabs.Tab>();
  const gone: number[] = [];
  for (const id of payload.tabIds ?? []) {
    try {
      found.set(id, await chrome.tabs.get(id));
    } catch {
      gone.push(id);
    }
  }
  const urls = (payload.urls ?? []).filter((u) => typeof u === 'string' && u.length > 0);
  if (urls.length > 0) {
    for (const tab of await chrome.tabs.query({ url: urls })) {
      if (typeof tab.id === 'number') found.set(tab.id, tab);
    }
  }
  const max = payload.maxTabs ?? DEFAULT_MAX_TABS;
  return { tabs: [...found.values()].slice(0, max), gone };
}

export async function runWatchProbe(
  payload: ProbePayload,
): Promise<{ results: ProbeResult[]; engine: string; note?: string }> {
  const script = typeof payload?.script === 'string' ? payload.script : '';
  if (!script.trim()) throw new Error('watch probe without a script');
  const timeoutMs = payload.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const code = wrapScript(script, timeoutMs);
  const useUserScripts = payload.engine !== 'cdp' && (await userScriptsAvailable());
  const origins = payload.origins ?? {};
  const { tabs, gone } = await resolveTabs(payload);
  const busy = new Set(busyTabs());

  const readTab = async (tab: chrome.tabs.Tab): Promise<ProbeResult> => {
    const tabId = tab.id as number;
    const base = { tabId, url: tab.url, title: tab.title };
    if (tab.discarded) {
      return { ...base, ok: false, error: 'Chrome discarded this tab to save memory; reload it' };
    }
    if (tab.status !== 'complete') return { ...base, ok: false, skipped: 'loading' };
    const expected = origins[String(tabId)];
    if (expected && originOf(tab.url) !== expected) {
      return {
        ...base,
        ok: false,
        error: `the tab now shows ${originOf(tab.url) || 'another page'}, not ${expected}; not read`,
      };
    }
    // Another call is working in this tab: read it next time instead of racing it.
    if (busy.has(tabId)) return { ...base, ok: false, skipped: 'busy' };
    if (tab.autoDiscardable !== false) {
      chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => undefined);
    }
    try {
      const raw = useUserScripts
        ? await runViaUserScripts(tabId, code, timeoutMs)
        : await runViaCdp(tabId, code, timeoutMs);
      return { ...base, ...unwrap(raw) };
    } catch (error) {
      return { ...base, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const results = await Promise.all(tabs.map(readTab));
  for (const tabId of gone) results.push({ tabId, ok: false, gone: true, error: 'tab is closed' });
  return {
    results,
    engine: useUserScripts ? 'userScripts' : 'cdp',
    ...(useUserScripts ? {} : { note: USER_SCRIPTS_NOTE }),
  };
}
