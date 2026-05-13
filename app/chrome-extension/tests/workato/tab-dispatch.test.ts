import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  findWorkatoTab,
  isWorkatoAppHost,
  WorkatoDispatchError,
} from '../../entrypoints/background/tools/workato/tab-dispatch';

type Tab = chrome.tabs.Tab;
const mockTabs: Tab[] = [];

beforeEach(() => {
  mockTabs.length = 0;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      query: vi.fn(async () => mockTabs.slice()),
    },
  };
});

function tab(id: number, url: string): Tab {
  return { id, url } as Tab;
}

describe('findWorkatoTab', () => {
  it('throws TabNotFound when no tabs match', async () => {
    await expect(findWorkatoTab()).rejects.toMatchObject({
      name: 'WorkatoDispatchError',
      code: 'TabNotFound',
    });
  });

  it('returns the single matching tab', async () => {
    mockTabs.push(tab(1, 'https://app.workato.com/recipes/123'));
    const info = await findWorkatoTab();
    expect(info).toEqual({
      tabId: 1,
      host: 'app.workato.com',
      origin: 'https://app.workato.com',
    });
  });

  it('returns the first tab when many tabs share one host', async () => {
    mockTabs.push(tab(1, 'https://app.workato.com/recipes/123'));
    mockTabs.push(tab(2, 'https://app.workato.com/jobs'));
    const info = await findWorkatoTab();
    expect(info.tabId).toBe(1);
  });

  it('throws MultipleWorkatoHosts when tabs span >1 distinct host', async () => {
    mockTabs.push(tab(1, 'https://app.workato.com/recipes/123'));
    mockTabs.push(tab(2, 'https://app.eu.workato.com/recipes/999'));
    await expect(findWorkatoTab()).rejects.toMatchObject({
      name: 'WorkatoDispatchError',
      code: 'MultipleWorkatoHosts',
    });
  });

  it('throws TabNotFound when matching tabs have no id/url', async () => {
    mockTabs.push({ id: undefined, url: 'https://app.workato.com/' } as Tab);
    await expect(findWorkatoTab()).rejects.toMatchObject({
      code: 'TabNotFound',
    });
  });

  it('is a WorkatoDispatchError instance with details', async () => {
    mockTabs.push(tab(1, 'https://app.workato.com/'));
    mockTabs.push(tab(2, 'https://app.workato.is/'));
    try {
      await findWorkatoTab();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkatoDispatchError);
      expect((err as WorkatoDispatchError).details?.hosts).toEqual(
        expect.arrayContaining(['app.workato.com', 'app.workato.is']),
      );
    }
  });

  it('ignores docs.workato.com when an app tab is also open', async () => {
    mockTabs.push(tab(1, 'https://docs.workato.com/en/formulas'));
    mockTabs.push(tab(2, 'https://app.workato.com/recipes/123'));
    const info = await findWorkatoTab();
    expect(info.tabId).toBe(2);
    expect(info.host).toBe('app.workato.com');
  });

  it('does not trip MultipleWorkatoHosts when only one host is an app host', async () => {
    mockTabs.push(tab(1, 'https://docs.workato.com/'));
    mockTabs.push(tab(2, 'https://www.workato.com/'));
    mockTabs.push(tab(3, 'https://app.workato.com/jobs'));
    const info = await findWorkatoTab();
    expect(info.tabId).toBe(3);
  });

  it('throws TabNotFound when only non-app workato hosts are open', async () => {
    mockTabs.push(tab(1, 'https://docs.workato.com/'));
    mockTabs.push(tab(2, 'https://support.workato.com/'));
    try {
      await findWorkatoTab();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkatoDispatchError);
      expect((err as WorkatoDispatchError).code).toBe('TabNotFound');
      expect((err as WorkatoDispatchError).message).toMatch(/app\.workato\.com/);
      expect((err as WorkatoDispatchError).details?.seenHosts).toEqual(
        expect.arrayContaining(['docs.workato.com', 'support.workato.com']),
      );
    }
  });

  it('still trips MultipleWorkatoHosts when two distinct app hosts are open', async () => {
    mockTabs.push(tab(1, 'https://app.workato.com/'));
    mockTabs.push(tab(2, 'https://app.eu.workato.com/'));
    mockTabs.push(tab(3, 'https://docs.workato.com/'));
    await expect(findWorkatoTab()).rejects.toMatchObject({
      code: 'MultipleWorkatoHosts',
    });
  });
});

describe('isWorkatoAppHost', () => {
  it.each([
    ['app.workato.com', true],
    ['app.workato.is', true],
    ['app.eu.workato.com', true],
    ['app.jp.workato.com', true],
    ['app.trial.workato.com', true],
    ['docs.workato.com', false],
    ['www.workato.com', false],
    ['support.workato.com', false],
    ['community.workato.com', false],
    ['status.workato.com', false],
    ['careers.workato.com', false],
    ['app.workato.evil.com', false],
    ['evil-app.workato.com', false],
    ['workato.com', false],
  ])('isWorkatoAppHost(%s) === %s', (host, expected) => {
    expect(isWorkatoAppHost(host)).toBe(expected);
  });
});
