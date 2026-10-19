/**
 * The update-time cleanup removes only what the removed features wrote and
 * never throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_DATABASES,
  isLegacyStorageKey,
  removeLegacyData,
} from '@/entrypoints/background/legacy-cleanup';

const chromeAny = (globalThis as any).chrome;

describe('removeLegacyData', () => {
  let originalLocal: unknown;
  let originalIndexedDb: unknown;
  let deleted: string[];

  beforeEach(() => {
    originalLocal = chromeAny.storage.local;
    originalIndexedDb = (globalThis as any).indexedDB;
    deleted = [];
    (globalThis as any).indexedDB = {
      deleteDatabase: vi.fn((name: string) => {
        deleted.push(name);
        const request: Record<string, (() => void) | null> = {
          onsuccess: null,
          onerror: null,
          onblocked: null,
        };
        setTimeout(() => request.onsuccess?.(), 0);
        return request;
      }),
    };
  });

  afterEach(() => {
    chromeAny.storage.local = originalLocal;
    (globalThis as any).indexedDB = originalIndexedDb;
  });

  it('removes the record-replay, userscript and theme keys and the old databases', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    chromeAny.storage.local = {
      get: vi.fn().mockResolvedValue({
        rr_flows: [],
        rr_run_states: {},
        rr_idb_migrated: true,
        agentTheme: 'dark-console',
        userscripts: [],
        userscripts_disabled: false,
        nativeServerPort: 12306,
        profileName: 'personal',
        serverStatus: { isRunning: true },
      }),
      remove,
    };

    await removeLegacyData();

    expect(remove).toHaveBeenCalledTimes(1);
    expect([...remove.mock.calls[0][0]].sort()).toEqual(
      [
        'agentTheme',
        'rr_flows',
        'rr_idb_migrated',
        'rr_run_states',
        'userscripts',
        'userscripts_disabled',
      ].sort(),
    );
    expect(deleted).toEqual([...LEGACY_DATABASES]);
  });

  it('leaves the keys the extension still uses alone', () => {
    for (const key of [
      'nativeServerPort',
      'profileName',
      'serverStatus',
      'nativeAutoConnectEnabled',
    ]) {
      expect(isLegacyStorageKey(key)).toBe(false);
    }
  });

  it('does not throw when storage or IndexedDB fail', async () => {
    chromeAny.storage.local = {
      get: vi.fn().mockRejectedValue(new Error('storage gone')),
      remove: vi.fn(),
    };
    (globalThis as any).indexedDB = {
      deleteDatabase: vi.fn(() => {
        throw new Error('no idb');
      }),
    };

    await expect(removeLegacyData()).resolves.toBeUndefined();
  });
});
