/**
 * @fileoverview Tests for the job-trace projection helpers: nested path
 * selection, the empty-value policy and array previews.
 *
 * The rules that matter are the ones a projection can silently break: 0 and
 * false are data, an array index must still mean what it meant, and pruning
 * must not reach into the strings stripSchemaNoise already re-serialized.
 */

import { describe, expect, it } from 'vitest';

import {
  applyTraceProjection,
  buildSlimTrace,
  parsePath,
  pickStepFields,
  previewArrays,
  projectPathsDetailed,
  pruneEmpty,
  stripSchemaNoise,
} from '@/entrypoints/background/tools/workato/slim-trace';

const PAYLOAD = {
  status: 0,
  ok: false,
  note: '',
  missing: null,
  empty_object: {},
  empty_list: [],
  headers: { status: 200, request_id: 'abc' },
  body: {
    items: [
      { id: 'A1', amount: 0, tags: [], comment: null },
      { id: 'A2', amount: 12.5, tags: ['x'], comment: 'ok' },
    ],
  },
};

describe('parsePath', () => {
  it('reads dots, indices, wildcards and quoted keys', () => {
    expect(parsePath('body.items[].id')).toEqual([
      { kind: 'key', key: 'body' },
      { kind: 'key', key: 'items' },
      { kind: 'wildcard' },
      { kind: 'key', key: 'id' },
    ]);
    expect(parsePath('rows[2].amount')).toEqual([
      { kind: 'key', key: 'rows' },
      { kind: 'index', index: 2 },
      { kind: 'key', key: 'amount' },
    ]);
    expect(parsePath("meta['a.b']")).toEqual([
      { kind: 'key', key: 'meta' },
      { kind: 'key', key: 'a.b' },
    ]);
  });
});

describe('projectPaths', () => {
  it('keeps only the requested paths and merges several of them', () => {
    const projected = projectPathsDetailed(PAYLOAD, ['headers.status', 'body.items[].id']);
    expect(projected.value).toEqual({
      headers: { status: 200 },
      body: { items: [{ id: 'A1' }, { id: 'A2' }] },
    });
    expect(projected.matched).toEqual(['headers.status', 'body.items[].id']);
    expect(projected.unmatched).toEqual([]);
  });

  it('keeps array indices stable when selecting one element', () => {
    const projected = projectPathsDetailed(PAYLOAD, ['body.items[1].id']);
    const items = (projected.value as any).body.items;
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({ id: 'A2' });
    expect(JSON.parse(JSON.stringify(items))).toEqual([null, { id: 'A2' }]);
  });

  it('reports a path that matched nothing instead of inventing a key', () => {
    const projected = projectPathsDetailed(PAYLOAD, ['body.no_such_key']);
    expect(projected.value).toEqual({});
    expect(projected.unmatched).toEqual(['body.no_such_key']);
  });

  it('keeps a zero-valued leaf', () => {
    expect(projectPathsDetailed(PAYLOAD, ['status']).value).toEqual({ status: 0 });
  });
});

describe('pruneEmpty', () => {
  it("drops undefined, null, '', {} and [] and nothing else", () => {
    const pruned = pruneEmpty(PAYLOAD) as Record<string, unknown>;
    expect(pruned.status).toBe(0);
    expect(pruned.ok).toBe(false);
    expect('note' in pruned).toBe(false);
    expect('missing' in pruned).toBe(false);
    expect('empty_object' in pruned).toBe(false);
    expect('empty_list' in pruned).toBe(false);
  });

  it('never filters an array, so indices stay stable', () => {
    const pruned = pruneEmpty({ rows: [{ a: null }, { a: 1 }, {}] }) as any;
    expect(pruned.rows).toHaveLength(3);
    expect(pruned.rows[0]).toEqual({});
    expect(pruned.rows[1]).toEqual({ a: 1 });
    expect(pruned.rows[2]).toEqual({});
  });

  it('leaves an already-serialized string alone', () => {
    const serialized = JSON.stringify({ a: null, b: 1 });
    expect(pruneEmpty({ input: serialized })).toEqual({ input: serialized });
  });
});

describe('previewArrays', () => {
  it('previews a long array with its real total', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ i }));
    const preview = previewArrays({ rows }, 3) as any;
    expect(preview.rows).toEqual({
      _array_preview: true,
      total: 50,
      shown: 3,
      items: [{ i: 0 }, { i: 1 }, { i: 2 }],
    });
  });

  it('leaves a short array as an array', () => {
    expect(previewArrays({ rows: [1, 2] }, 20)).toEqual({ rows: [1, 2] });
  });

  it('is a no-op when max_items is 0', () => {
    const rows = [1, 2, 3];
    expect(previewArrays({ rows }, 0)).toEqual({ rows });
  });
});

describe('applyTraceProjection', () => {
  it('applies paths, then the empty policy, then previews', () => {
    const value = {
      body: {
        items: [
          { id: 'A1', note: '' },
          { id: 'A2', note: 'keep' },
          { id: 'A3', note: '' },
        ],
      },
    };
    const projected = applyTraceProjection(value, {
      paths: ['body.items[].id', 'body.items[].note'],
      empty: 'drop',
      maxItems: 2,
    }) as any;
    expect(projected.body.items).toEqual({
      _array_preview: true,
      total: 3,
      shown: 2,
      items: [{ id: 'A1' }, { id: 'A2', note: 'keep' }],
    });
  });

  it('returns the value untouched with no options', () => {
    expect(applyTraceProjection(PAYLOAD)).toBe(PAYLOAD);
    expect(applyTraceProjection(PAYLOAD, { empty: 'keep', maxItems: 0 })).toEqual(PAYLOAD);
  });

  it('runs after stripSchemaNoise without reopening its stringified payloads', () => {
    const embedded = JSON.stringify({ output_schema: [{ name: 'x' }], value: null }).padEnd(
      220,
      ' ',
    );
    const cleaned = stripSchemaNoise({ input: embedded });
    const projected = applyTraceProjection(cleaned, { empty: 'drop', maxItems: 20 }) as any;
    expect(typeof projected.input).toBe('string');
    expect(projected.input).toContain('<stripped>');
  });
});

describe('buildSlimTrace with a projection', () => {
  const META = {
    result: {
      job: {
        id: 'j-1',
        status: 'succeeded',
        started_at: '2026-09-05T00:00:00.000Z',
        completed_at: '2026-09-05T00:00:01.000Z',
      },
      recipe: { id: 7, name: 'R', version_no: 3 },
    },
  };

  it('spends the summary budget on the projected data only', () => {
    const lines = {
      line_details: [
        {
          recipe_line_number: 4,
          adapter_name: 'netsuite',
          adapter_operation: 'add_record',
          input: { wanted: 'yes', noise: 'x'.repeat(600), flag: false },
          output: { id: 42 },
        },
      ],
    };
    const slim = buildSlimTrace('j-1', META, lines, {
      paths: ['wanted', 'flag'],
      empty: 'keep',
      maxItems: 20,
    });
    expect(slim.steps[0].input_summary).toBe('{"wanted":"yes","flag":false}');
    expect(slim.steps[0].output_summary).toBe('{}');
  });

  it('keeps every key when no projection is passed', () => {
    const lines = {
      line_details: [
        {
          recipe_line_number: 4,
          adapter_name: 'netsuite',
          adapter_operation: 'add_record',
          input: { a: 1, b: null },
          output: { id: 0 },
        },
      ],
    };
    const slim = buildSlimTrace('j-1', META, lines);
    expect(slim.steps[0].input_summary).toBe('{"a":1,"b":null}');
    expect(slim.steps[0].output_summary).toBe('{"id":0}');
  });
});

describe('pickStepFields', () => {
  it('keeps the requested keys and always the line number', () => {
    const step = {
      recipe_line_number: 12,
      adapter_name: 'salesforce',
      adapter_operation: 'search',
      input_summary: 'in',
      output_summary: 'out',
    };
    expect(pickStepFields(step, ['output_summary'])).toEqual({
      recipe_line_number: 12,
      output_summary: 'out',
    });
  });
});
