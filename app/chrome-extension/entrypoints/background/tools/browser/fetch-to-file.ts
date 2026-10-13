/**
 * chrome_fetch_to_file: fetch a URL in the page, hand the body to the bridge for disk.
 *
 * The request runs in the tab's main world with credentials included, so it
 * carries the session the user is logged in with, and a relative URL resolves
 * against the page. The body comes back base64 encoded in one reply; the
 * bridge decodes it into out_file and answers the caller with a summary, so the
 * bytes never reach the model or the output sanitizer.
 *
 * It replaces Blob + anchor.click() downloads, which Chrome's "multiple
 * automatic downloads" site permission blocks silently after the first one.
 *
 * The in-page function is a plain function with .then chains: the bundler
 * rewrites async functions into wrappers that do not survive serialization
 * into the page (see reference_v1_pitfalls_resolved).
 */

import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'workatomcp-shared';

export const DEFAULT_FETCH_TIMEOUT_MS = 60_000;
/** The bridge gives one call 120 s; the fetch has to finish well inside that. */
export const MAX_FETCH_TIMEOUT_MS = 110_000;
export const DEFAULT_FETCH_MAX_BYTES = 25 * 1024 * 1024;
/** The base64 body rides one native message (64 MiB cap): 40 MB encodes to about 54 MB. */
export const HARD_FETCH_MAX_BYTES = 40 * 1024 * 1024;
/** Extra time for executeScript to hand back a body the page already read. */
const ANSWER_SLACK_MS = 5_000;

interface FetchToFileParams {
  url?: string;
  tabId?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  max_bytes?: number;
  /**
   * Internal, set by the native-server once it has resolved out_file, and
   * absent from the public inputSchema. Without it the tool refuses: a reply
   * carries the whole body as base64, which must only ever go to the bridge's
   * file writer, never to a caller that would put it in model context.
   */
  __to_file?: boolean;
}

export interface InPageFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  final_url: string;
  content_type: string;
  content_disposition: string;
  bytes: number;
  base64?: string;
  error_kind?: 'invalid_url' | 'too_large' | 'timeout' | 'network' | 'read';
  error?: string;
}

/**
 * Runs in the page (MAIN world). Self-contained: no module references, no
 * async/await, no object spread (a transpiled spread pulls in a helper the
 * page does not have).
 */
export function fetchToFileInPage(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  timeoutMs: number,
  maxBytes: number,
): Promise<InPageFetchResult> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const meta: InPageFetchResult = {
    ok: false,
    status: 0,
    statusText: '',
    final_url: '',
    content_type: '',
    content_disposition: '',
    bytes: 0,
  };
  const done = (extra: Partial<InPageFetchResult>): InPageFetchResult => {
    if (timer) clearTimeout(timer);
    return Object.assign({}, meta, extra);
  };
  const fail = (kind: InPageFetchResult['error_kind'], message: string): InPageFetchResult =>
    done({ error_kind: kind, error: message });
  const tooLarge = (size: number): InPageFetchResult =>
    fail(
      'too_large',
      'The body is ' + size + ' bytes, over max_bytes (' + maxBytes + '). Nothing was written.',
    );

  /**
   * The body as a Blob, or null once it grows past maxBytes. Read as a stream
   * so a response without Content-Length (chunked) is cut off at the cap
   * instead of being buffered whole in the page first.
   */
  function readBody(response: Response): Promise<Blob | null> {
    const type = response.headers.get('content-type') || '';
    const stream = response.body;
    if (!stream || typeof stream.getReader !== 'function') {
      return response.blob();
    }
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    function pump(): Promise<Blob | null> {
      return reader.read().then(function (step): Promise<Blob | null> | Blob | null {
        if (step.done) return new Blob(chunks as BlobPart[], { type: type });
        const chunk = step.value;
        total += chunk ? chunk.byteLength : 0;
        if (total > maxBytes) {
          reader.cancel().then(null, function () {});
          if (controller) controller.abort();
          return null;
        }
        if (chunk) chunks.push(chunk);
        return pump();
      });
    }
    return pump();
  }

  let resolved: string;
  try {
    resolved = new URL(url, document.baseURI).href;
  } catch (e) {
    return Promise.resolve(fail('invalid_url', 'Not a valid URL: ' + url));
  }
  meta.final_url = resolved;

  const init: RequestInit = {
    method: method,
    credentials: 'include',
    headers: headers || {},
    redirect: 'follow',
  };
  if (controller) init.signal = controller.signal;
  if (body !== null && body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = body;
  }
  if (controller) {
    timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);
  }

  return fetch(resolved, init)
    .then(function (response): Promise<InPageFetchResult> | InPageFetchResult {
      meta.ok = response.ok;
      meta.status = response.status;
      meta.statusText = response.statusText || '';
      meta.final_url = response.url || resolved;
      meta.content_type = response.headers.get('content-type') || '';
      meta.content_disposition = response.headers.get('content-disposition') || '';
      const declared = Number(response.headers.get('content-length'));
      if (isFinite(declared) && declared > maxBytes) {
        const result = tooLarge(declared);
        if (controller) controller.abort();
        return result;
      }
      return readBody(response).then(function (blob):
        | Promise<InPageFetchResult>
        | InPageFetchResult {
        if (!blob) {
          return fail(
            'too_large',
            'The body is over max_bytes (' +
              maxBytes +
              '): the read stopped there. Nothing was written.',
          );
        }
        meta.bytes = blob.size;
        if (blob.size > maxBytes) return tooLarge(blob.size);
        return new Promise<InPageFetchResult>(function (resolve) {
          const reader = new FileReader();
          reader.onload = function () {
            const dataUrl = String(reader.result || '');
            const comma = dataUrl.indexOf(',');
            resolve(done({ base64: comma >= 0 ? dataUrl.slice(comma + 1) : '' }));
          };
          reader.onerror = function () {
            const reason = reader.error && reader.error.message;
            resolve(fail('read', 'Could not read the response body: ' + (reason || 'unknown')));
          };
          reader.readAsDataURL(blob);
        });
      });
    })
    .then(null, function (err: unknown): InPageFetchResult {
      const name = err && typeof err === 'object' ? (err as { name?: string }).name : '';
      if (name === 'AbortError') {
        return fail('timeout', 'The request did not finish within ' + timeoutMs + ' ms.');
      }
      const message = err instanceof Error ? err.message : String(err);
      return fail(
        'network',
        'fetch failed: ' +
          message +
          ' (a cross-origin URL needs CORS with credentials; the page CSP connect-src also applies)',
      );
    });
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

class FetchToFileTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.FETCH_TO_FILE;

  async execute(args: FetchToFileParams): Promise<ToolResult> {
    if (args?.__to_file !== true) {
      return createErrorResponse(
        'chrome_fetch_to_file must be called through the bridge with out_file; nothing was fetched.',
      );
    }
    const url = typeof args.url === 'string' ? args.url.trim() : '';
    if (!url) return createErrorResponse('Parameter [url] is required');

    const method = (typeof args.method === 'string' && args.method.trim()) || 'GET';
    const timeoutMs = clampInt(
      args.timeoutMs,
      DEFAULT_FETCH_TIMEOUT_MS,
      1000,
      MAX_FETCH_TIMEOUT_MS,
    );
    const maxBytes = clampInt(args.max_bytes, DEFAULT_FETCH_MAX_BYTES, 1, HARD_FETCH_MAX_BYTES);
    const headers =
      args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)
        ? args.headers
        : {};
    const body = typeof args.body === 'string' ? args.body : null;

    const explicit = await this.tryGetTab(args.tabId);
    if (typeof args.tabId === 'number' && !explicit) {
      return createErrorResponse(`Tab not found: ${args.tabId}`);
    }
    let tab: chrome.tabs.Tab;
    try {
      tab = explicit || (await this.getActiveTabOrThrow());
    } catch {
      return createErrorResponse('No active tab found');
    }
    if (typeof tab.id !== 'number') return createErrorResponse('Tab has no ID');
    const tabId = tab.id;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let result: InPageFetchResult | undefined;
    try {
      const injected = chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: 'MAIN',
        func: fetchToFileInPage,
        args: [url, method.toUpperCase(), headers, body, timeoutMs, maxBytes],
      });
      const late = new Promise<'late'>((resolve) => {
        timeoutId = setTimeout(() => resolve('late'), timeoutMs + ANSWER_SLACK_MS);
      });
      const answer = await Promise.race([injected, late]);
      if (answer === 'late') {
        return createErrorResponse(
          `The page did not answer within ${timeoutMs + ANSWER_SLACK_MS} ms (main thread busy, or ` +
            'a JS dialog is open). Nothing was written.',
        );
      }
      result = answer?.[0]?.result as InPageFetchResult | undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(
        `Could not run the fetch in tab ${tabId} (${tab.url || 'unknown url'}): ${message}. ` +
          'Pages such as chrome:// and the built-in PDF viewer take no scripts: navigate the tab ' +
          'to an HTML page of the same site first.',
      );
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    if (!result || typeof result !== 'object') {
      return createErrorResponse('The in-page fetch returned nothing. Nothing was written.');
    }
    if (result.error_kind) {
      const status = result.status ? ` (HTTP ${result.status})` : '';
      return createErrorResponse(`${result.error}${status}`);
    }
    if (typeof result.base64 !== 'string') {
      return createErrorResponse('The in-page fetch returned no body. Nothing was written.');
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ tabId, ...result }) }],
      isError: false,
    };
  }
}

export const fetchToFileTool = new FetchToFileTool();
