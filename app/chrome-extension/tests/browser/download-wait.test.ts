/**
 * @fileoverview chrome_handle_download: a timeout has to say whether a
 * download never started or started and stalled, and an interrupted one fails
 * at once instead of waiting the timeout out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadNotCompletedMessage,
  noDownloadStartedMessage,
  waitForDownload,
} from '@/entrypoints/background/tools/browser/download';

type Listener = (arg: any) => void;

function installDownloads(items: chrome.downloads.DownloadItem[] = []) {
  const created: Listener[] = [];
  const changed: Listener[] = [];
  const store = new Map(items.map((item) => [item.id, item]));
  (globalThis as any).chrome.downloads = {
    onCreated: {
      addListener: (fn: Listener) => created.push(fn),
      removeListener: vi.fn(),
    },
    onChanged: {
      addListener: (fn: Listener) => changed.push(fn),
      removeListener: vi.fn(),
    },
    search: vi.fn((query: { id?: number; state?: string }) => {
      const all = [...store.values()];
      if (typeof query.id === 'number')
        return Promise.resolve(all.filter((d) => d.id === query.id));
      if (query.state) return Promise.resolve(all.filter((d) => d.state === query.state));
      return Promise.resolve(all);
    }),
  };
  return {
    create(item: chrome.downloads.DownloadItem) {
      store.set(item.id, item);
      created.forEach((fn) => fn(item));
    },
    change(item: chrome.downloads.DownloadItem) {
      store.set(item.id, item);
      changed.forEach((fn) => fn({ id: item.id }));
    },
  };
}

const item = (over: Partial<chrome.downloads.DownloadItem>) =>
  ({
    id: 1,
    filename: 'C:\\Users\\x\\Downloads\\INV-1.pdf',
    url: 'blob:https://example.com/1',
    state: 'in_progress',
    bytesReceived: 0,
    totalBytes: 100,
    danger: 'safe',
    ...over,
  }) as chrome.downloads.DownloadItem;

describe('waitForDownload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out naming the download-permission block when nothing ever started', async () => {
    installDownloads();
    const waiting = waitForDownload({ waitForComplete: true, timeoutMs: 1000 });
    const assertion = expect(waiting).rejects.toThrow(/No download started within 1000 ms/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    await expect(waiting).rejects.toThrow(/multiple automatic downloads.*chrome_fetch_to_file/s);
  });

  it('times out with the state and bytes of a download that started but stalled', async () => {
    const downloads = installDownloads();
    const waiting = waitForDownload({ waitForComplete: true, timeoutMs: 1000 });
    const assertion = expect(waiting).rejects.toThrow(
      /Download 1 \(INV-1\.pdf\) started but did not complete.*received 40 of 100 bytes/,
    );
    downloads.create(item({}));
    downloads.change(item({ bytesReceived: 40 }));
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('fails at once when a matching download is interrupted', async () => {
    const downloads = installDownloads();
    const waiting = waitForDownload({ waitForComplete: true, timeoutMs: 60000 });
    const assertion = expect(waiting).rejects.toThrow(/interrupted: NETWORK_FAILED/);
    downloads.create(item({}));
    downloads.change(item({ state: 'interrupted', error: 'NETWORK_FAILED' as any }));
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });

  it('resolves when a matching download completes', async () => {
    const downloads = installDownloads();
    const waiting = waitForDownload({
      filenameContains: 'INV-1',
      waitForComplete: true,
      timeoutMs: 60000,
    });
    downloads.create(item({ id: 2, filename: 'other.csv' }));
    downloads.create(item({}));
    downloads.change(item({ state: 'complete', bytesReceived: 100 }));
    await vi.advanceTimersByTimeAsync(10);
    await expect(waiting).resolves.toMatchObject({ id: 1, state: 'complete' });
  });

  it('ignores finished downloads in the history', async () => {
    installDownloads([item({ id: 9, state: 'complete' })]);
    const waiting = waitForDownload({ waitForComplete: false, timeoutMs: 1000 });
    const assertion = expect(waiting).rejects.toThrow(/No download started/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('ignores deltas on old history items, complete or interrupted', async () => {
    const downloads = installDownloads([
      item({ id: 7, state: 'complete', bytesReceived: 100 }),
      item({ id: 8, state: 'interrupted', error: 'NETWORK_FAILED' as any }),
    ]);
    const waiting = waitForDownload({
      filenameContains: 'INV-1',
      waitForComplete: true,
      timeoutMs: 1000,
    });
    const assertion = expect(waiting).rejects.toThrow(/No download matching "INV-1" started/);
    await vi.advanceTimersByTimeAsync(10);
    // The file of an old download is moved or deleted: Chrome reports a delta on it.
    downloads.change(item({ id: 7, state: 'complete', bytesReceived: 100, exists: false } as any));
    downloads.change(item({ id: 8, state: 'interrupted', error: 'NETWORK_FAILED' as any }));
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('still follows a download that was in progress when the wait began', async () => {
    const downloads = installDownloads([item({ id: 5 })]);
    const waiting = waitForDownload({ waitForComplete: true, timeoutMs: 60000 });
    await vi.advanceTimersByTimeAsync(10);
    downloads.change(item({ id: 5, state: 'complete', bytesReceived: 100 }));
    await vi.advanceTimersByTimeAsync(10);
    await expect(waiting).resolves.toMatchObject({ id: 5, state: 'complete' });
  });
});

describe('download messages', () => {
  it('names the filter in the no-download message', () => {
    expect(noDownloadStartedMessage(5000, 'INV')).toMatch(/No download matching "INV" started/);
  });

  it('reports danger and the interrupt reason when present', () => {
    const text = downloadNotCompletedMessage(
      5000,
      item({ danger: 'file' as any, error: 'FILE_BLOCKED' as any, totalBytes: 0 }),
    );
    expect(text).toMatch(/of unknown bytes/);
    expect(text).toMatch(/error FILE_BLOCKED/);
    expect(text).toMatch(/danger file/);
  });
});
