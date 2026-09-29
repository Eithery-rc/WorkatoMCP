import { describe, expect, it, vi, beforeEach } from 'vitest';
import { busyTabs, runExclusiveForTab } from '@/entrypoints/background/tools/tab-queue';
import {
  resolveUid,
  storeSnapshot,
  uidBase,
} from '@/entrypoints/background/tools/browser/snapshot/uid-store';
import { formatAxTree } from '@/entrypoints/background/tools/browser/snapshot/ax-tree-formatter';
import { closeAgentTab, openAgentTab } from '@/entrypoints/background/agent-tabs';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('runExclusiveForTab', () => {
  it('runs calls on one tab one at a time, and other tabs in parallel', async () => {
    const order: string[] = [];
    const gate = deferred();
    const first = runExclusiveForTab(1, async () => {
      order.push('a:start');
      await gate.promise;
      order.push('a:end');
    });
    const second = runExclusiveForTab(1, async () => {
      order.push('b');
    });
    const otherTab = runExclusiveForTab(2, async () => {
      order.push('other');
    });
    await otherTab;
    expect(order).toEqual(['a:start', 'other']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['a:start', 'other', 'a:end', 'b']);
  });

  it('a failed call does not block the next one and the queue drains', async () => {
    const failed = runExclusiveForTab(7, async () => {
      throw new Error('boom');
    });
    const next = runExclusiveForTab(7, async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
    await new Promise((r) => setTimeout(r, 0));
    expect(busyTabs()).not.toContain(7);
  });
});

describe('snapshot uids across snapshots of one tab', () => {
  const nodes = [
    { nodeId: '1', role: { value: 'button' }, name: { value: 'One' }, backendDOMNodeId: 11 },
    { nodeId: '2', role: { value: 'button' }, name: { value: 'Two' }, backendDOMNodeId: 12 },
  ] as any;

  it('numbers a second snapshot after the first and refuses the older uids', () => {
    const tabId = 4242;
    const firstBase = uidBase(tabId);
    const first = formatAxTree(nodes, firstBase);
    storeSnapshot(tabId, {
      snapshotId: 's1',
      uidToBackendNodeId: first.uidMap,
      capturedAt: 0,
      firstUid: firstBase + 1,
    });
    const firstUids = [...first.uidMap.keys()];
    expect(firstUids.length).toBeGreaterThan(0);

    const secondBase = uidBase(tabId);
    const second = formatAxTree(nodes, secondBase);
    storeSnapshot(tabId, {
      snapshotId: 's2',
      uidToBackendNodeId: second.uidMap,
      capturedAt: 1,
      firstUid: secondBase + 1,
    });
    const secondUids = [...second.uidMap.keys()];
    expect(Math.min(...secondUids)).toBeGreaterThan(Math.max(...firstUids));

    expect(() => resolveUid(tabId, firstUids[0])).toThrow('older snapshot');
    expect(resolveUid(tabId, secondUids[0])).toBe(second.uidMap.get(secondUids[0]));
  });
});

describe('agent tabs', () => {
  beforeEach(() => {
    (chrome as any).windows = {
      create: vi.fn().mockResolvedValue({ id: 900, tabs: [{ id: 901 }] }),
      get: vi.fn().mockResolvedValue({ id: 900 }),
    };
    (chrome as any).storage.session = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    };
    (chrome.tabs.create as any) = vi.fn().mockResolvedValue({ id: 902 });
  });

  it('opens tabs unfocused, reusing one agents window, and own_window gets its own', async () => {
    const first = await openAgentTab({ url: 'https://example.com' });
    const second = await openAgentTab({});
    expect(chrome.windows.create).toHaveBeenCalledWith({
      url: 'https://example.com',
      focused: false,
    });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      windowId: first.windowId,
      url: 'about:blank',
      active: false,
    });
    expect(second).toEqual({ tabId: 902, windowId: 900 });

    await openAgentTab({ own_window: true });
    expect(chrome.windows.create).toHaveBeenCalledTimes(2);
  });

  it('closing a tab that is already gone is not an error', async () => {
    (chrome.tabs.remove as any) = vi.fn().mockRejectedValue(new Error('No tab with id'));
    await expect(closeAgentTab(5)).resolves.toEqual({ closed: false });
  });
});
