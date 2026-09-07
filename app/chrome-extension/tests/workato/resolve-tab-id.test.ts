import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTabId } from '@/entrypoints/background/tools/workato-ui/dom-helpers';

type Tab = chrome.tabs.Tab;
const mockTabs: Tab[] = [];

function tab(id: number, url: string, windowId = 1): Tab {
  return { id, url, windowId } as Tab;
}

beforeEach(() => {
  mockTabs.length = 0;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      query: vi.fn(async (info: { windowId?: number }) =>
        mockTabs.filter((t) => info.windowId === undefined || t.windowId === info.windowId),
      ),
      get: vi.fn(async (tabId: number) => {
        const found = mockTabs.find((candidate) => candidate.id === tabId);
        if (!found) throw new Error(`No tab with id: ${tabId}`);
        return found;
      }),
    },
  };
});

describe('resolveTabId', () => {
  it('returns an explicit tab that is still a Workato app tab', async () => {
    mockTabs.push(tab(42, 'https://app.workato.com/recipes/1'));
    await expect(resolveTabId({ tabId: 42 })).resolves.toBe(42);
  });

  it('throws instead of retargeting when the pinned tab is gone', async () => {
    mockTabs.push(tab(7, 'https://app.workato.com/recipes/2'));

    await expect(resolveTabId({ tabId: 42 })).rejects.toMatchObject({
      name: 'WorkatoDispatchError',
      code: 'TabNotFound',
    });
  });

  it('throws when the pinned tab navigated off the Workato app', async () => {
    mockTabs.push(tab(42, 'https://docs.workato.com/recipes.html'));
    mockTabs.push(tab(7, 'https://app.workato.com/recipes/2'));

    await expect(resolveTabId({ tabId: 42 })).rejects.toMatchObject({ code: 'TabNotFound' });
  });

  it('still finds a Workato app tab in an explicit window', async () => {
    mockTabs.push(tab(9, 'https://app.workato.com/recipes/3', 5));
    await expect(resolveTabId({ windowId: 5 })).resolves.toBe(9);
  });

  it('falls back to the single open app tab when nothing is pinned', async () => {
    mockTabs.push(tab(3, 'https://app.workato.com/recipes/4'));
    await expect(resolveTabId({})).resolves.toBe(3);
  });
});
