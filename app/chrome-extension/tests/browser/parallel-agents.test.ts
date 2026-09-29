import { describe, expect, it, vi, beforeEach } from 'vitest';
import { busyTabs, runExclusiveForTab } from '@/entrypoints/background/tools/tab-queue';
import {
  __resetUidStoreForTest,
  assignUid,
  beginSnapshot,
  getTabUids,
  lookupUid,
} from '@/entrypoints/background/tools/browser/snapshot/uid-store';
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

describe('runExclusiveForTab hold bound', () => {
  it('lets the next call run when one holds the tab past the bound, and the stuck call still answers', async () => {
    let releaseStuck: (v: string) => void = () => undefined;
    const stuck = runExclusiveForTab(
      21,
      () => new Promise<string>((resolve) => (releaseStuck = resolve)),
      30,
    );
    const next = runExclusiveForTab(21, async () => 'next ran', 30);
    await expect(next).resolves.toBe('next ran');
    releaseStuck('stuck finished');
    await expect(stuck).resolves.toBe('stuck finished');
  });
});

describe('snapshot uids across snapshots of one tab', () => {
  beforeEach(() => __resetUidStoreForTest());

  it('keeps a node on its uid, never reuses a uid, and refuses a uid whose page navigated', async () => {
    const tabId = 4242;
    const state = await getTabUids(tabId);
    beginSnapshot(state, new Map([['F', 'L1']]));
    const one = assignUid(state, 'F', 'L1', 11);
    const two = assignUid(state, 'F', 'L1', 12);

    beginSnapshot(state, new Map([['F', 'L1']]));
    // Same node, second snapshot: same uid. A new node gets a new number.
    expect(assignUid(state, 'F', 'L1', 11)).toBe(one);
    const three = assignUid(state, 'F', 'L1', 13);
    expect(three).toBeGreaterThan(two);
    await expect(lookupUid(tabId, two)).resolves.toMatchObject({ backendNodeId: 12 });

    // The frame navigated: every uid of the old document is gone, numbers go on.
    beginSnapshot(state, new Map([['F', 'L2']]));
    await expect(lookupUid(tabId, one)).rejects.toThrow('no longer exists');
    expect(assignUid(state, 'F', 'L2', 11)).toBeGreaterThan(three);
    await expect(lookupUid(tabId, 999)).rejects.toThrow('never issued');
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
