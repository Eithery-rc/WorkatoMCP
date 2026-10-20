import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@mokuhub/mokutab-shared';

interface HandleDownloadParams {
  filenameContains?: string;
  timeoutMs?: number; // default 60000
  waitForComplete?: boolean; // default true
}

/**
 * Tool: wait for a download and return info
 */
class HandleDownloadTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD as any;

  async execute(args: HandleDownloadParams): Promise<ToolResult> {
    const filenameContains = String(args?.filenameContains || '').trim();
    const waitForComplete = args?.waitForComplete !== false;
    const timeoutMs = Math.max(1000, Math.min(Number(args?.timeoutMs ?? 60000), 300000));

    try {
      const result = await waitForDownload({ filenameContains, waitForComplete, timeoutMs });
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, download: result }) }],
        isError: false,
      };
    } catch (e: any) {
      return createErrorResponse(`Handle download failed: ${e?.message || String(e)}`);
    }
  }
}

/** What the tool reports about a download (also the success payload). */
function describeItem(item: chrome.downloads.DownloadItem) {
  return {
    id: item.id,
    filename: item.filename,
    url: item.url,
    mime: (item as any).mime || undefined,
    fileSize: item.fileSize ?? item.totalBytes ?? undefined,
    state: item.state,
    danger: item.danger,
    startTime: item.startTime,
    endTime: (item as any).endTime || undefined,
    exists: (item as any).exists,
  };
}

/** The reply when no matching download was ever created. */
export function noDownloadStartedMessage(timeoutMs: number, filenameContains?: string): string {
  const filter = filenameContains ? ` matching "${filenameContains}"` : '';
  return (
    `No download${filter} started within ${timeoutMs} ms. When the page starts downloads from ` +
    'script (a Blob URL plus anchor.click(), or several in a row), the Chrome site permission ' +
    '"multiple automatic downloads" holds the second and later ones until someone allows them ' +
    'in the address bar, or drops them, and no download event fires either way. To save the ' +
    'body of a URL to disk, use chrome_fetch_to_file instead.'
  );
}

/** The reply when a matching download started but did not complete in time. */
export function downloadNotCompletedMessage(
  timeoutMs: number,
  item: chrome.downloads.DownloadItem,
): string {
  const name = (item.filename || '').split(/[/\\]/).pop() || item.url || '';
  const total = item.totalBytes && item.totalBytes > 0 ? String(item.totalBytes) : 'unknown';
  const parts = [
    `Download ${item.id} (${name}) started but did not complete within ${timeoutMs} ms`,
    `state ${item.state}`,
    `received ${item.bytesReceived ?? 0} of ${total} bytes`,
  ];
  if (item.error) parts.push(`error ${item.error}`);
  if (item.danger && item.danger !== 'safe' && item.danger !== 'accepted') {
    parts.push(`danger ${item.danger} (Chrome waits for the user to keep or discard it)`);
  }
  return parts.join('; ') + '.';
}

/** The reply when a matching download was interrupted (fails at once, no timeout wait). */
export function downloadInterruptedMessage(item: chrome.downloads.DownloadItem): string {
  const name = (item.filename || '').split(/[/\\]/).pop() || item.url || '';
  return (
    `Download ${item.id} (${name}) was interrupted: ${item.error || 'no reason given'} ` +
    `(received ${item.bytesReceived ?? 0} bytes).`
  );
}

export async function waitForDownload(opts: {
  filenameContains?: string;
  waitForComplete: boolean;
  timeoutMs: number;
}) {
  const { filenameContains, waitForComplete, timeoutMs } = opts;
  return new Promise<any>((resolve, reject) => {
    let timer: any = null;
    let settled = false;
    // Matching downloads seen while waiting, so a timeout can say what happened to them.
    const seen = new Map<number, chrome.downloads.DownloadItem>();
    // Downloads this wait may report: created after the call, or in progress when it
    // began. A delta on an old history item (its file moved, say) must not count.
    const eligible = new Set<number>();
    const cleanup = () => {
      try {
        if (timer) clearTimeout(timer);
      } catch {}
      try {
        chrome.downloads.onCreated.removeListener(onCreated);
      } catch {}
      try {
        chrome.downloads.onChanged.removeListener(onChanged);
      } catch {}
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const matches = (item: chrome.downloads.DownloadItem) => {
      if (!filenameContains) return true;
      const name = (item.filename || '').split(/[/\\]/).pop() || '';
      return name.includes(filenameContains) || (item.url || '').includes(filenameContains);
    };
    const fulfill = async (item: chrome.downloads.DownloadItem) => {
      if (settled) return;
      settled = true;
      cleanup();
      // try to fill more details via downloads.search
      try {
        const [found] = await chrome.downloads.search({ id: item.id });
        resolve(describeItem(found || item));
      } catch {
        resolve({ id: item.id, filename: item.filename, url: item.url, state: item.state });
      }
    };
    const consider = (item: chrome.downloads.DownloadItem) => {
      if (settled || !matches(item)) return;
      seen.set(item.id, item);
      if (item.state === 'interrupted') {
        fail(downloadInterruptedMessage(item));
        return;
      }
      if (!waitForComplete || item.state === 'complete') fulfill(item);
    };
    const onCreated = (item: chrome.downloads.DownloadItem) => {
      try {
        if (typeof item?.id === 'number') eligible.add(item.id);
        consider(item);
      } catch {}
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      try {
        if (!delta || typeof delta.id !== 'number' || !eligible.has(delta.id)) return;
        // pull item and check
        chrome.downloads
          .search({ id: delta.id })
          .then((arr) => {
            const item = arr && arr[0];
            if (item) consider(item);
          })
          .catch(() => {});
      } catch {}
    };
    const onTimeout = async () => {
      if (settled) return;
      const ids = [...seen.keys()];
      if (ids.length === 0) {
        fail(noDownloadStartedMessage(timeoutMs, filenameContains));
        return;
      }
      const latestId = ids[ids.length - 1];
      let latest = seen.get(latestId)!;
      try {
        const [found] = await chrome.downloads.search({ id: latestId });
        if (found) latest = found;
      } catch {}
      fail(downloadNotCompletedMessage(timeoutMs, latest));
    };
    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);
    timer = setTimeout(() => {
      onTimeout().catch((e) => fail(e instanceof Error ? e.message : String(e)));
    }, timeoutMs);
    // A matching download already running counts; finished ones in the history do not.
    chrome.downloads
      .search({ state: 'in_progress' })
      .then((arr) => {
        for (const item of arr || []) {
          eligible.add(item.id);
          consider(item);
        }
      })
      .catch(() => {});
  });
}

export const handleDownloadTool = new HandleDownloadTool();
