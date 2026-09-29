/**
 * Safety rules of the uid actions: a select never lands on a merely similar
 * option, a native value write looks like a real edit to blur-committed
 * models, and a uid records what its node was so a recycled node is caught.
 */
import { describe, expect, it } from 'vitest';
import {
  NATIVE_SET_FN,
  SELECT_FN,
} from '@/entrypoints/background/tools/browser/snapshot/element-actions';
import { formatAxTree } from '@/entrypoints/background/tools/browser/snapshot/ax-tree-formatter';
import {
  assignUid,
  beginSnapshot,
  getTabUids,
  __resetUidStoreForTest,
} from '@/entrypoints/background/tools/browser/snapshot/uid-store';
import type { UidIdentity } from '@/entrypoints/background/tools/browser/snapshot/types';

function pageFn<T>(src: string): (this: unknown, ...args: unknown[]) => T {
  // The page-side helpers are function source strings sent over CDP.
  return new Function(`return (${src});`)() as (this: unknown, ...args: unknown[]) => T;
}

function select(options: Array<[string, string, boolean?]>): HTMLSelectElement {
  const el = document.createElement('select');
  for (const [text, value, disabled] of options) {
    const o = document.createElement('option');
    o.text = text;
    o.value = value;
    o.disabled = !!disabled;
    el.appendChild(o);
  }
  document.body.appendChild(el);
  return el;
}

describe('SELECT_FN', () => {
  const run = (el: HTMLSelectElement, v: string) =>
    pageFn<{ ok: boolean; selected?: string; ambiguous?: boolean; options?: string[] }>(
      SELECT_FN,
    ).call(el, v);

  it('refuses a substring that several options contain instead of taking the first', () => {
    const el = select([
      ['Unpaid', 'u'],
      ['Paid in full', 'p'],
      ['Partially paid', 'pp'],
    ]);
    const r = run(el, 'aid');
    expect(r.ok).toBe(false);
    expect(r.ambiguous).toBe(true);
    expect(el.value).toBe('u'); // untouched
    // "paid" is a unique prefix: it must land on "Paid in full", never "Unpaid".
    expect(run(el, 'paid').selected).toBe('Paid in full');
  });

  it('prefers exact text, then a unique prefix', () => {
    const el = select([
      ['Unpaid', 'u'],
      ['Paid in full', 'p'],
    ]);
    expect(run(el, 'Paid').selected).toBe('Paid in full'); // unique prefix wins over the substring hit
    expect(run(el, 'unpaid').selected).toBe('Unpaid');
  });

  it('skips disabled options and needs an empty option for an empty value', () => {
    const el = select([
      ['Blue', 'b', true],
      ['Blueish', 'bi'],
    ]);
    expect(run(el, 'blue').selected).toBe('Blueish');
    expect(run(el, '').ok).toBe(false);
  });
});

describe('NATIVE_SET_FN', () => {
  it('frames the write with focus and blur so blur-committed models update', () => {
    const input = document.createElement('input');
    input.value = 'old';
    document.body.appendChild(input);
    const events: string[] = [];
    for (const t of ['focus', 'focusin', 'input', 'change', 'blur', 'focusout']) {
      input.addEventListener(t, () => events.push(t));
    }
    const out = pageFn<string>(NATIVE_SET_FN).call(input, 'new');
    expect(out).toBe('new');
    expect(events).toEqual(['focus', 'focusin', 'input', 'change', 'blur', 'focusout']);
  });
});

describe('uid identity', () => {
  it('records role, name and the row a node belongs to', () => {
    const seen: Array<[number, UidIdentity | undefined]> = [];
    let n = 0;
    formatAxTree(
      [
        { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'P' }, childIds: ['2'] },
        {
          nodeId: '2',
          role: { value: 'row' },
          name: { value: 'Invoice 42 Foo' },
          backendDOMNodeId: 20,
          childIds: ['3'],
        },
        {
          nodeId: '3',
          role: { value: 'button' },
          name: { value: 'Delete' },
          backendDOMNodeId: 30,
        },
      ],
      {
        assignUid: (id, identity) => {
          seen.push([id, identity]);
          return ++n;
        },
      },
    );
    const button = seen.find(([id]) => id === 30);
    expect(button?.[1]).toEqual({ role: 'button', name: 'Delete', row: 'Invoice 42 Foo' });
  });

  it('keeps the uid of a node and refreshes its recorded identity', async () => {
    __resetUidStoreForTest();
    const state = await getTabUids(7);
    beginSnapshot(state, new Map([['F', 'L']]));
    const uid = assignUid(state, 'F', 'L', 30, { role: 'button', name: 'Delete', row: 'Foo' });
    beginSnapshot(state, new Map([['F', 'L']]));
    expect(assignUid(state, 'F', 'L', 30, { role: 'button', name: 'Delete', row: 'Bar' })).toBe(
      uid,
    );
    expect(state.byUid.get(uid)).toMatchObject({ role: 'button', name: 'Delete', row: 'Bar' });
  });
});
