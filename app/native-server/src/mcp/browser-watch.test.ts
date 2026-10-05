import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ERROR_STREAK_TO_REPORT, WatchManager, type ProbeReply } from './browser-watch';

function harness(replies: ProbeReply[]) {
  let now = 1_000_000;
  const queue = [...replies];
  const manager = new WatchManager({
    probe: async () => queue.shift() ?? { results: [] },
    isConnected: () => true,
    now: () => now,
    stateFile: null,
  });
  return {
    manager,
    advance: (ms: number) => (now += ms),
    push: (reply: ProbeReply) => queue.push(reply),
  };
}

const reading = (value: unknown, tabId = 7): ProbeReply => ({
  results: [{ tabId, ok: true, value, title: 'Inbox' }],
  engine: 'userScripts',
});

describe('WatchManager', () => {
  test('an array wakes only on items not seen before, the first reading is the baseline', async () => {
    const h = harness([reading([{ id: 1 }, { id: 2 }])]);
    const { spec } = await h.manager.start({ script: 'return 1', tabIds: [7], key: 'id' }, 'p');
    expect(h.manager.eventsAfter(null)).toHaveLength(0);

    h.push(reading([{ id: 3, s: 'new' }, { id: 1 }, { id: 2 }]));
    await h.manager.tick(spec.id);
    const events = h.manager.eventsAfter(null);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'added', tab_id: 7, added: [{ id: 3, s: 'new' }] });

    // A row that scrolls out and back is not new; null is "no reading".
    h.push(reading([{ id: 1 }]));
    await h.manager.tick(spec.id);
    h.push(reading(null));
    await h.manager.tick(spec.id);
    h.push(reading([{ id: 3 }, { id: 1 }]));
    await h.manager.tick(spec.id);
    expect(h.manager.eventsAfter(null)).toHaveLength(1);
    h.manager.dispose();
  });

  test('a scalar wakes when it differs from the last reading', async () => {
    const h = harness([reading('Inbox (2)')]);
    const { spec } = await h.manager.start({ script: 'return 1', tabIds: [7] }, 'p');
    h.push(reading('Inbox (2)'));
    await h.manager.tick(spec.id);
    h.push(reading('Inbox (3)'));
    await h.manager.tick(spec.id);
    const events = h.manager.eventsAfter(null);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'changed', value: 'Inbox (3)', previous: 'Inbox (2)' });
    h.manager.dispose();
  });

  test('failures are reported once after a streak, then recovery', async () => {
    const h = harness([reading(1)]);
    const { spec } = await h.manager.start({ script: 'return 1', tabIds: [7] }, 'p');
    for (let i = 0; i < ERROR_STREAK_TO_REPORT + 2; i += 1) {
      h.push({ results: [{ tabId: 7, ok: false, error: 'boom' }] });
      await h.manager.tick(spec.id);
    }
    h.push(reading(1));
    await h.manager.tick(spec.id);
    expect(h.manager.eventsAfter(null).map((e) => e.kind)).toEqual(['error', 'recovered']);
    h.manager.dispose();
  });

  test('start refuses a script that fails in every tab', async () => {
    const h = harness([{ results: [{ tabId: 7, ok: false, error: 'x is not defined' }] }]);
    await expect(h.manager.start({ script: 'return x', tabIds: [7] }, 'p')).rejects.toThrow(
      /failed in every tab/,
    );
    expect(h.manager.list()).toHaveLength(0);
  });

  test('a waiter wakes on the next event; a wait on an unknown watch returns at once', async () => {
    const h = harness([reading([])]);
    const { spec } = await h.manager.start({ script: 'return []', tabIds: [7] }, 'p');
    const waiting = h.manager.waitEvents(new Set([spec.id]), h.manager.cursor, 60_000);
    h.push(reading(['a']));
    await h.manager.tick(spec.id);
    const woke = await waiting;
    expect(woke.events.map((e) => e.kind)).toEqual(['added']);

    const unknown = await h.manager.waitEvents(new Set(['Wnope']), undefined, 60_000);
    expect(unknown.note).toMatch(/no active watch/);
    h.manager.dispose();
  });

  test('state survives a restart: seen items, seq, origin pin and engine', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
    const stateFile = path.join(dir, 'watches.json');
    const payloads: any[] = [];
    const replies: ProbeReply[] = [
      {
        ...reading([{ id: 1 }]),
        results: [
          { tabId: 7, ok: true, value: [{ id: 1 }], url: 'https://mail.example.com/inbox' },
        ],
      },
      reading([{ id: 1 }, { id: 2 }]),
    ];
    const deps = {
      probe: async (_p: string, payload: any) => {
        payloads.push(payload);
        return replies.shift() ?? reading([{ id: 1 }, { id: 2 }, { id: 3 }]);
      },
      isConnected: () => true,
      now: () => 1_000_000,
      stateFile,
    };
    const first = new WatchManager(deps);
    const { spec } = await first.start({ script: 'return 1', tabIds: [7], key: 'id' }, 'p');
    await first.tick(spec.id);
    expect(first.cursor).toBe(1);
    first.dispose();

    const second = new WatchManager(deps);
    second.init();
    expect(second.cursor).toBe(1);
    await second.tick(spec.id);
    const added = second.eventsAfter(null, 1);
    expect(added).toHaveLength(1);
    expect(added[0].added).toEqual([{ id: 3 }]);
    expect(payloads.at(-1)).toMatchObject({
      origins: { '7': 'https://mail.example.com' },
      engine: 'userScripts',
    });
    second.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a cursor ahead of the current seq waits from now instead of forever', async () => {
    const h = harness([reading([])]);
    const { spec } = await h.manager.start({ script: 'return []', tabIds: [7] }, 'p');
    const waiting = h.manager.waitEvents(null, 999, 60_000);
    h.push(reading(['a']));
    await h.manager.tick(spec.id);
    expect((await waiting).events).toHaveLength(1);
    h.manager.dispose();
  });

  test('watches expire', async () => {
    const h = harness([reading(1)]);
    const { spec } = await h.manager.start(
      { script: 'return 1', tabIds: [7], ttl_minutes: 1 },
      'p',
    );
    h.advance(61_000);
    await h.manager.tick(spec.id);
    expect(h.manager.has(spec.id)).toBe(false);
    expect(h.manager.eventsAfter(null).pop()).toMatchObject({ kind: 'ended', reason: 'expired' });
  });
});
