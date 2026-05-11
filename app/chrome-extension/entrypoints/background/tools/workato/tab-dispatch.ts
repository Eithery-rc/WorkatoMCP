/**
 * Find a Workato tab and dispatch a fetch in its MAIN-world context so the
 * page's session cookies travel with the request.
 *
 * Selection algorithm (from spec §6):
 *   1. Query tabs matching *.workato.com or *.workato.is.
 *   2. If zero matches  -> TabNotFound.
 *   3. If matches span >1 distinct host -> MultipleWorkatoHosts.
 *   4. Otherwise pick tabs[0].
 */

const WORKATO_URL_PATTERNS = ['*://*.workato.com/*', '*://*.workato.is/*'];

export class WorkatoDispatchError extends Error {
  constructor(
    public code:
      | 'TabNotFound'
      | 'MultipleWorkatoHosts'
      | 'ScriptExecutionFailed'
      | 'UnexpectedShape',
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkatoDispatchError';
  }
}

export interface WorkatoTabInfo {
  tabId: number;
  host: string;
  origin: string;
}

export async function findWorkatoTab(): Promise<WorkatoTabInfo> {
  const tabs = await chrome.tabs.query({ url: WORKATO_URL_PATTERNS });

  if (tabs.length === 0) {
    throw new WorkatoDispatchError(
      'TabNotFound',
      'No Workato tab open. Open https://app.workato.com (or your region) in Chrome ' +
        'and sign in before calling this tool.',
    );
  }

  const usable = tabs.filter(
    (t): t is chrome.tabs.Tab & { id: number; url: string } =>
      typeof t.id === 'number' && typeof t.url === 'string',
  );

  if (usable.length === 0) {
    throw new WorkatoDispatchError(
      'TabNotFound',
      'Found Workato tabs but none have an id and url Chrome will let us script into.',
    );
  }

  const distinctHosts = new Set(usable.map((t) => new URL(t.url).host));
  if (distinctHosts.size > 1) {
    throw new WorkatoDispatchError(
      'MultipleWorkatoHosts',
      `Multiple Workato hosts open at once (${[...distinctHosts].join(', ')}). ` +
        'Close all but one before calling this tool.',
      { hosts: [...distinctHosts] },
    );
  }

  const tab = usable[0];
  const url = new URL(tab.url);
  return { tabId: tab.id, host: url.host, origin: url.origin };
}

/**
 * Run `func(...args)` in the MAIN world of the given tab and return its result.
 * `func` must be self-contained (no captured closures) because Chrome serializes
 * it to a string before executing.
 */
export async function runInWorkatoTab<TArgs extends unknown[], TResult>(
  tabId: number,
  func: (...args: TArgs) => Promise<TResult> | TResult,
  args: TArgs,
): Promise<TResult> {
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: func as (...a: unknown[]) => unknown,
      args: args as unknown[],
    });
  } catch (err) {
    throw new WorkatoDispatchError(
      'ScriptExecutionFailed',
      `chrome.scripting.executeScript failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!results || results.length === 0) {
    throw new WorkatoDispatchError(
      'ScriptExecutionFailed',
      'chrome.scripting.executeScript returned no result frames.',
    );
  }

  const first = results[0];
  if (first.result === undefined) {
    throw new WorkatoDispatchError(
      'ScriptExecutionFailed',
      'In-page script returned undefined. The function likely threw before returning.',
    );
  }

  return first.result as TResult;
}
