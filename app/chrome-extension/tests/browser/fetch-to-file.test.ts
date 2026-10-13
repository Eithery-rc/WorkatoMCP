/**
 * @fileoverview chrome_fetch_to_file, extension half: the in-page fetch and
 * the guard that keeps a base64 body from answering anyone but the bridge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchToFileInPage,
  fetchToFileTool,
} from '@/entrypoints/background/tools/browser/fetch-to-file';

function fakeResponse(body: string, init: { status?: number; headers?: Record<string, string> }) {
  const headers = new Map(
    Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v] as const),
  );
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    url: 'https://example.com/final.pdf',
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    blob: () => Promise.resolve(new Blob([body])),
  };
}

describe('fetchToFileInPage', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('fetches with credentials and returns the body as base64 with the headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse('%PDF-1.7 body', {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="a.pdf"',
        },
      }),
    );
    globalThis.fetch = fetchMock as any;

    const result = await fetchToFileInPage('/print?id=1&x=2', 'GET', {}, null, 5000, 1000);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(new URL('/print?id=1&x=2', document.baseURI).href);
    expect(init.credentials).toBe('include');
    expect(init.body).toBeUndefined();
    expect(result.error_kind).toBeUndefined();
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      final_url: 'https://example.com/final.pdf',
      content_type: 'application/pdf',
      content_disposition: 'attachment; filename="a.pdf"',
      bytes: 13,
    });
    expect(atob(result.base64 as string)).toBe('%PDF-1.7 body');
  });

  it('sends a body only for methods that take one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse('ok', {}));
    globalThis.fetch = fetchMock as any;
    await fetchToFileInPage('/x', 'POST', { 'X-A': '1' }, 'a=1', 5000, 1000);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: 'a=1',
      headers: { 'X-A': '1' },
    });
  });

  it('refuses a body over max_bytes on Content-Length and on the real size', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(fakeResponse('12345', { headers: { 'Content-Length': '999' } })) as any;
    const declared = await fetchToFileInPage('/x', 'GET', {}, null, 5000, 10);
    expect(declared.error_kind).toBe('too_large');
    expect(declared.base64).toBeUndefined();

    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse('x'.repeat(50), {})) as any;
    const actual = await fetchToFileInPage('/x', 'GET', {}, null, 5000, 10);
    expect(actual.error_kind).toBe('too_large');
    expect(actual.bytes).toBe(50);
    expect(actual.base64).toBeUndefined();
  });

  it('keeps a non-2xx body so the bridge can write it for diagnosis', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse('nope', { status: 404 })) as any;
    const result = await fetchToFileInPage('/x', 'GET', {}, null, 5000, 1000);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(atob(result.base64 as string)).toBe('nope');
  });

  it('reports an abort as a timeout and a rejected fetch as a network error', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    globalThis.fetch = vi.fn().mockRejectedValue(abort) as any;
    expect((await fetchToFileInPage('/x', 'GET', {}, null, 5000, 10)).error_kind).toBe('timeout');

    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as any;
    const network = await fetchToFileInPage('/x', 'GET', {}, null, 5000, 10);
    expect(network.error_kind).toBe('network');
    expect(network.error).toMatch(/Failed to fetch/);
  });

  it('reads a streamed body and stops one that runs past max_bytes without Content-Length', async () => {
    const streamed = (chunks: string[]) => {
      const encoder = new TextEncoder();
      const queue = chunks.map((c) => encoder.encode(c));
      const cancel = vi.fn().mockResolvedValue(undefined);
      const read = vi.fn(() =>
        Promise.resolve(
          queue.length ? { done: false, value: queue.shift() } : { done: true, value: undefined },
        ),
      );
      const response = Object.assign(fakeResponse('', {}), {
        body: { getReader: () => ({ read, cancel }) },
        blob: () => Promise.reject(new Error('blob() must not be used for a stream')),
      });
      return { response, read, cancel };
    };

    const small = streamed(['%PDF', '-1.7 ', 'body']);
    globalThis.fetch = vi.fn().mockResolvedValue(small.response) as any;
    const ok = await fetchToFileInPage('/x', 'GET', {}, null, 5000, 1000);
    expect(ok.error_kind).toBeUndefined();
    expect(ok.bytes).toBe(13);
    expect(atob(ok.base64 as string)).toBe('%PDF-1.7 body');

    const big = streamed(['x'.repeat(6), 'x'.repeat(6), 'x'.repeat(6)]);
    globalThis.fetch = vi.fn().mockResolvedValue(big.response) as any;
    const over = await fetchToFileInPage('/x', 'GET', {}, null, 5000, 10);
    expect(over.error_kind).toBe('too_large');
    expect(over.base64).toBeUndefined();
    expect(big.cancel).toHaveBeenCalled();
    // Cut off at the second chunk: the third is never read.
    expect(big.read).toHaveBeenCalledTimes(2);
  });

  it('is a plain function, so it survives serialization into the page', () => {
    const source = fetchToFileInPage.toString();
    expect(source.startsWith('function')).toBe(true);
    expect(source).not.toMatch(/\basync\b|\bawait\b|_asyncToGenerator|__awaiter/);
  });
});

describe('fetchToFileTool guard', () => {
  beforeEach(() => {
    (globalThis as any).chrome.scripting = { executeScript: vi.fn() };
  });

  it('refuses a call the bridge did not prepare, without touching the page', async () => {
    const result = await fetchToFileTool.execute({ url: '/x', tabId: 1 } as any);
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toMatch(/through the bridge with out_file/);
    expect((globalThis as any).chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe('fetchToFileTool execute', () => {
  const chromeAny = (globalThis as any).chrome;
  let originalGet: any;

  beforeEach(() => {
    originalGet = chromeAny.tabs.get;
    chromeAny.tabs.get = vi.fn().mockResolvedValue({ id: 7, url: 'https://example.com/a' });
  });
  afterEach(() => {
    chromeAny.tabs.get = originalGet;
    vi.useRealTimers();
  });

  const inPage = (result: Record<string, unknown>) => {
    chromeAny.scripting = { executeScript: vi.fn().mockResolvedValue([{ result }]) };
  };

  it('runs the fetch in the main world of the tab and hands the bridge the body', async () => {
    inPage({
      ok: true,
      status: 200,
      statusText: 'OK',
      final_url: 'https://example.com/a.pdf',
      content_type: 'application/pdf',
      content_disposition: '',
      bytes: 4,
      base64: 'JVBERg==',
    });
    const result = await fetchToFileTool.execute({
      url: 'a.pdf',
      tabId: 7,
      method: 'post',
      max_bytes: 999_999_999,
      __to_file: true,
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse((result.content[0] as any).text)).toMatchObject({
      tabId: 7,
      ok: true,
      status: 200,
      bytes: 4,
      base64: 'JVBERg==',
    });
    const call = chromeAny.scripting.executeScript.mock.calls[0][0];
    expect(call.world).toBe('MAIN');
    expect(call.target).toEqual({ tabId: 7, frameIds: [0] });
    // Method upper-cased, max_bytes clamped to the hard cap.
    expect(call.args[1]).toBe('POST');
    expect(call.args[5]).toBe(40 * 1024 * 1024);
  });

  it('turns an in-page failure into an error with its status and no body', async () => {
    inPage({
      ok: false,
      status: 413,
      statusText: '',
      final_url: '',
      content_type: '',
      content_disposition: '',
      bytes: 0,
      error_kind: 'too_large',
      error: 'The body is 999 bytes, over max_bytes (10). Nothing was written.',
    });
    const result = await fetchToFileTool.execute({ url: '/x', tabId: 7, __to_file: true });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text as string;
    expect(text).toMatch(/over max_bytes \(10\).*\(HTTP 413\)/);
    expect(text).not.toMatch(/base64/);
  });

  it('gives up on a page that never answers, writing nothing', async () => {
    vi.useFakeTimers();
    chromeAny.scripting = { executeScript: vi.fn(() => new Promise(() => undefined)) };
    const waiting = fetchToFileTool.execute({
      url: '/x',
      tabId: 7,
      timeoutMs: 1000,
      __to_file: true,
    });
    await vi.advanceTimersByTimeAsync(6000);
    const result = await waiting;
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toMatch(/did not answer within 6000 ms/);
  });
});
