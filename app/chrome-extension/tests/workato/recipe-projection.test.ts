/**
 * @fileoverview Tests for the bounded-read primitives: previews, exact path
 * reads, per-list limits with a character budget, and cursors.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_ITEMS,
  MAX_MAX_ITEMS,
  PREVIEW_CAP,
  decodeCursor,
  encodeCursor,
  isPreviewed,
  normalizeBudgetChars,
  normalizeMaxItems,
  packLists,
  parsePathTokens,
  previewLongValues,
  readPath,
  readPaths,
} from '@/entrypoints/background/tools/workato/recipe-projection';

const long = (n: number): string => 'x'.repeat(n);

describe('previewLongValues', () => {
  it('previews a string over the cap and names the read-back path', () => {
    const out = previewLongValues({ code: long(900) }, { stepRef: 'py01' }, 'input') as Record<
      string,
      string
    >;
    expect(isPreviewed(out.code)).toBe(true);
    expect(out.code).toContain(`<<preview ${PREVIEW_CAP} of 900 chars`);
    expect(out.code).toContain('path=input.code');
    expect(out.code).toContain('read with step:"py01", paths:["input.code"]');
  });

  it('leaves a short string, and preserves 0, false and null', () => {
    const out = previewLongValues(
      { name: 'ok', count: 0, flag: false, empty: null },
      {},
      'input',
    ) as Record<string, unknown>;
    expect(out).toEqual({ name: 'ok', count: 0, flag: false, empty: null });
  });

  it('previews an embedded schema object by its serialized size', () => {
    const schema = Array.from({ length: 40 }, (_, i) => ({ name: `c${i}`, type: 'string' }));
    const out = previewLongValues({ output_schema: schema }, {}, 'input') as Record<string, string>;
    expect(isPreviewed(out.output_schema)).toBe(true);
    expect(out.output_schema).toContain('path=input.output_schema');
  });

  it('returns a code body whole with keepCode', () => {
    const body = long(900);
    const out = previewLongValues({ code: body }, { keepCode: true }, 'input') as Record<
      string,
      string
    >;
    expect(out.code).toBe(body);
  });

  it('walks arrays without changing indices', () => {
    const out = previewLongValues(
      { conditions: [{ lhs: long(400) }, { lhs: 'short' }] },
      {},
      'input',
    ) as { conditions: Array<{ lhs: string }> };
    expect(out.conditions).toHaveLength(2);
    expect(out.conditions[0].lhs).toContain('path=input.conditions[0].lhs');
    expect(out.conditions[1].lhs).toBe('short');
  });
});

describe('parsePathTokens / readPath', () => {
  it('parses dotted and bracketed paths', () => {
    expect(parsePathTokens('input.code')).toEqual(['input', 'code']);
    expect(parsePathTokens('input.conditions[0].lhs')).toEqual(['input', 'conditions', 0, 'lhs']);
    expect(parsePathTokens('input["odd.key"]')).toEqual(['input', 'odd.key']);
    expect(parsePathTokens('input[')).toBeNull();
  });

  it('reads an exact value losslessly and reports its size', () => {
    const node = { input: { code: long(900), conditions: [{ lhs: 'a' }] } };
    const read = readPath(node, 'input.code');
    expect(read.found).toBe(true);
    expect(read.value).toBe(long(900));
    expect(read.chars).toBe(JSON.stringify(long(900)).length);
    expect(readPath(node, 'input.conditions[0].lhs').value).toBe('a');
  });

  it('reports a miss instead of guessing', () => {
    const reads = readPaths({ input: {} }, ['input.nope', 'input.a[3]']);
    expect(reads.map((r) => r.found)).toEqual([false, false]);
    expect(reads[0]).not.toHaveProperty('value');
  });

  it('preserves false and 0 as found values', () => {
    const node = { input: { flag: false, count: 0 } };
    expect(readPath(node, 'input.flag')).toMatchObject({ found: true, value: false });
    expect(readPath(node, 'input.count')).toMatchObject({ found: true, value: 0 });
  });
});

describe('packLists', () => {
  const items = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ i, v: 'abc' }));

  it('applies max_items and reports the total', () => {
    const packed = packLists([{ key: 'fields', items: items(300) }], {
      maxItems: 25,
      budgetChars: 100_000,
    });
    expect(packed.lists.fields.items).toHaveLength(25);
    expect(packed.lists.fields.total).toBe(300);
    expect(packed.lists.fields.next_offset).toBe(25);
    expect(packed.truncated).toBe(true);
    expect(packed.next_offsets).toEqual({ fields: 25 });
  });

  it('cuts at an item boundary when the budget runs out', () => {
    const packed = packLists([{ key: 'fields', items: items(100) }], {
      maxItems: 100,
      budgetChars: 200,
    });
    expect(packed.lists.fields.items.length).toBeLessThan(100);
    expect(packed.used_chars).toBeLessThanOrEqual(200);
    expect(packed.truncated).toBe(true);
  });

  it('always yields one item so a cursor cannot stall', () => {
    const packed = packLists([{ key: 'fields', items: [{ huge: 'y'.repeat(5_000) }, { b: 1 }] }], {
      maxItems: 60,
      budgetChars: 100,
    });
    expect(packed.lists.fields.items).toHaveLength(1);
    expect(packed.lists.fields.next_offset).toBe(1);
  });

  it('renders an exempt list whole regardless of the budget', () => {
    const packed = packLists(
      [
        { key: 'paths', items: [{ v: 'z'.repeat(5_000) }], exempt: true },
        { key: 'fields', items: items(10) },
      ],
      { maxItems: 60, budgetChars: 100 },
    );
    expect(packed.lists.paths.items).toHaveLength(1);
    expect(packed.lists.paths.next_offset).toBeNull();
    expect(packed.lists.fields.items).toHaveLength(0);
    expect(packed.truncated).toBe(true);
  });

  it('resumes from an offset without repeating an item', () => {
    const all = items(10);
    const first = packLists([{ key: 'fields', items: all }], { maxItems: 4, budgetChars: 100_000 });
    const second = packLists([{ key: 'fields', items: all, offset: 4 }], {
      maxItems: 4,
      budgetChars: 100_000,
    });
    const seen = [...first.lists.fields.items, ...second.lists.fields.items];
    expect(seen).toEqual(all.slice(0, 8));
  });
});

describe('cursors', () => {
  it('round-trips list offsets', () => {
    const cursor = encodeCursor({ o: { fields: 60, mappings: 12 } });
    expect(decodeCursor(cursor)).toEqual({ v: 1, o: { fields: 60, mappings: 12 } });
  });

  it('round-trips a step index', () => {
    const state = decodeCursor(encodeCursor({ s: 2, o: {} }));
    expect(state?.s).toBe(2);
  });

  it('rejects a token it did not produce', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(btoa('{"v":9}'))).toBeNull();
  });
});

describe('normalizers', () => {
  it('clamps max_items to the documented range', () => {
    expect(normalizeMaxItems(undefined)).toBe(DEFAULT_MAX_ITEMS);
    expect(normalizeMaxItems(0)).toBe(1);
    expect(normalizeMaxItems(10_000)).toBe(MAX_MAX_ITEMS);
    expect(normalizeMaxItems(25)).toBe(25);
  });

  it('clamps budget_chars and falls back when it is absent', () => {
    expect(normalizeBudgetChars(undefined, 12_000)).toBe(12_000);
    expect(normalizeBudgetChars(1, 12_000)).toBe(500);
    expect(normalizeBudgetChars(10_000_000, 12_000)).toBe(400_000);
  });
});
