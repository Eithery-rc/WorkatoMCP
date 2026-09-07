/**
 * @fileoverview Execution semantics, preview markers and bounded reads on the
 * workato_pull_recipe projection layer.
 */

import { describe, expect, it } from 'vitest';

import {
  collectUpstreamDatapills,
  findStep,
  inspectStep,
  inspectSteps,
  toCompactRecipe,
  windowCompactSteps,
  type CompactStep,
  type RawNode,
  type RawSchemaEntry,
  type RecipeVersion,
} from '@/entrypoints/background/tools/workato/recipe-view';
import { decodeCursor } from '@/entrypoints/background/tools/workato/recipe-projection';

const version: RecipeVersion = {
  version_no: 4,
  name: 'Loop recipe',
  folder_id: 77,
  description: 'iterates',
};

const LOOP_PILL =
  '{"pill_type":"output","provider":"py_eval","line":"e977d1e7","path":["output","list"]}';

/** A long Python body: the shape that used to be copied whole into a view. */
const LONG_CODE = `def main(input):\n${'    total = total + 1\n'.repeat(80)}    return total\n`;

/** A long embedded schema string, as the Variables/List steps store it. */
const LONG_SCHEMA_JSON = JSON.stringify(
  Array.from({ length: 40 }, (_, i) => ({ name: `col_${i}`, type: 'string', optional: true })),
);

/**
 * A recipe with a foreach (root-level source/repeat_mode/clear_scope), a
 * nested if/else, a long code body and a long embedded schema: the parts the
 * compact view used to drop or copy whole.
 */
function loopCode(): RawNode {
  return {
    number: 0,
    keyword: 'trigger',
    provider: 'clock',
    name: 'scheduled_event',
    as: 'trigger00',
    input: { interval: 'daily' },
    job_report_schema: [{ name: 'custom_column_0', label: 'Marker code' }],
    extended_output_schema: [{ name: 'started_at', label: 'Started at', type: 'date_time' }],
    block: [
      {
        number: 1,
        keyword: 'action',
        provider: 'py_eval',
        name: 'execute_python',
        as: 'py01',
        input: { code: LONG_CODE, list_item_schema_json: LONG_SCHEMA_JSON },
        extended_input_schema: [{ name: 'code', label: 'Code', type: 'string' }],
        extended_output_schema: [
          { name: 'output', label: 'Output', type: 'object', properties: [{ name: 'list' }] },
        ],
      },
      {
        number: 2,
        keyword: 'foreach',
        as: '0e8ba850',
        clear_scope: 'false',
        repeat_mode: 'simple',
        batch_size: '10',
        source: `#{_dp('${LOOP_PILL}')}`,
        input: {},
        block: [
          {
            number: 3,
            keyword: 'if',
            as: 'cond03',
            input: {
              type: 'compound',
              operand: 'and',
              conditions: [{ lhs: 'a', operand: 'present', rhs: '' }],
            },
            block: [
              {
                number: 4,
                keyword: 'action',
                provider: 'logger',
                name: 'log_message',
                as: 'log04',
                comment: 'writes the loop item',
                input: { message: 'hi' },
              },
            ],
          },
          {
            number: 5,
            keyword: 'else',
            as: 'else05',
            input: {},
            block: [
              {
                number: 6,
                keyword: 'action',
                provider: 'logger',
                name: 'log_message',
                as: 'log06',
                input: { message: 'bye' },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('compact execution semantics', () => {
  it('keeps the foreach source, repeat_mode, clear_scope and batch_size', () => {
    const recipe = toCompactRecipe(loopCode(), 1, version);
    const loop = recipe.steps[1];
    expect(loop.type).toBe('foreach');
    expect(loop.source).toBe('#{datapill(py_eval.e977d1e7.output.list)}');
    expect(loop.repeat_mode).toBe('simple');
    expect(loop.clear_scope).toBe('false');
    expect(loop.batch_size).toBe('10');
  });

  it('keeps the if/else structure, the condition fields and the comment', () => {
    const recipe = toCompactRecipe(loopCode(), 1, version);
    const branches = recipe.steps[1].block!;
    expect(branches.map((b) => b.type)).toEqual(['if', 'else']);
    expect((branches[0].input as Record<string, unknown>).operand).toBe('and');
    expect(branches[0].block![0].comment).toBe('writes the loop item');
  });

  it('carries version_no on the compact view', () => {
    const recipe = toCompactRecipe(loopCode(), 1, version);
    expect(recipe.version_no).toBe(4);
    expect(recipe.version.version_no).toBe(4);
  });

  it('shows the loop source in the step header too', () => {
    const code = loopCode();
    const view = inspectStep(code, findStep(code, '0e8ba850')!, 1, { versionNo: 4 });
    expect(view.step.source).toBe('#{datapill(py_eval.e977d1e7.output.list)}');
    expect(view.step.repeat_mode).toBe('simple');
    expect(view.version_no).toBe(4);
  });

  it('replaces long embedded values with a marker naming the read-back call', () => {
    const recipe = toCompactRecipe(loopCode(), 1, version);
    const python = recipe.steps[0].input as Record<string, string>;
    expect(python.code).toContain('<<preview 240 of');
    expect(python.code).toContain('path=input.code');
    expect(python.code).toContain('read with step:"py01", paths:["input.code"]');
    expect(python.list_item_schema_json).toContain('path=input.list_item_schema_json');
    expect(JSON.stringify(recipe).length).toBeLessThan(4000);
  });

  it('recovers the full value through an exact paths read', () => {
    const code = loopCode();
    const view = inspectStep(code, findStep(code, 'py01')!, 1, {
      include: ['mappings'],
      paths: ['input.code'],
    });
    expect(view.paths).toHaveLength(1);
    expect(view.paths![0].found).toBe(true);
    expect(view.paths![0].value).toBe(LONG_CODE);
  });

  it('keeps a single exact field read under 4000 characters', () => {
    const code = loopCode();
    const only = inspectStep(code, findStep(code, 'log04')!, 1, {
      include: [],
      paths: ['input.message'],
    });
    expect(only.paths![0].value).toBe('hi');
    expect(JSON.stringify(only).length).toBeLessThan(4000);
  });

  it('summarises input as input_keys in the outline view', () => {
    const outline = toCompactRecipe(loopCode(), 1, version, true);
    expect(outline.steps[0]).not.toHaveProperty('input');
    expect(outline.steps[0].input_keys).toEqual(['code', 'list_item_schema_json']);
    expect(outline.steps[1].source).toBe('#{datapill(py_eval.e977d1e7.output.list)}');
  });

  it('returns the schemas only when include asks for them', () => {
    const code = loopCode();
    const plain = inspectStep(code, findStep(code, 'py01')!, 1);
    expect(plain.schemas).toBeUndefined();
    const withSchemas = inspectStep(code, findStep(code, 'py01')!, 1, {
      include: ['schemas'],
    });
    expect(withSchemas.total_schema_input).toBe(1);
    expect(withSchemas.total_schema_output).toBe(1);
  });
});

describe('collectUpstreamDatapills: loops and scope', () => {
  it('includes a providerless foreach as foreach.<as>', () => {
    const code = loopCode();
    const target = findStep(code, 'log04')!;
    const refs = collectUpstreamDatapills(code, 4, target).map((d) => d.ref);
    expect(refs).toContain('datapill(foreach.0e8ba850)');
    expect(refs).toContain('datapill(py_eval.py01.output)');
  });

  it('excludes later siblings and the target subtree', () => {
    const code = loopCode();
    const target = findStep(code, 'py01')!;
    const refs = collectUpstreamDatapills(code, 1, target).map((d) => d.ref);
    expect(refs).toEqual(['datapill(clock.trigger00.started_at)']);
  });
});

describe('windowCompactSteps', () => {
  const tree = (): CompactStep[] => [
    { n: 1, as: 'a' },
    {
      n: 2,
      as: 'b',
      block: [
        { n: 3, as: 'b1' },
        { n: 4, as: 'b2' },
      ],
    },
    { n: 5, as: 'c' },
  ];

  it('renders everything when it fits', () => {
    const win = windowCompactSteps(tree(), { maxItems: 60, budgetChars: 60_000 });
    expect(win.total).toBe(5);
    expect(win.returned).toBe(5);
    expect(win.next_offset).toBeNull();
  });

  it('cuts at the item limit and reports where to resume', () => {
    const win = windowCompactSteps(tree(), { maxItems: 2, budgetChars: 60_000 });
    expect(win.returned).toBe(2);
    expect(win.next_offset).toBe(2);
    expect(win.steps[1].block).toBeUndefined();
    expect(win.steps[1].block_omitted).toBe(2);
  });

  it('continues from an offset with ancestors kept as partial headers', () => {
    const win = windowCompactSteps(tree(), { offset: 2, maxItems: 2, budgetChars: 60_000 });
    expect(win.returned).toBe(2);
    const parent = win.steps[0];
    expect(parent.partial).toBe(true);
    expect(parent.as).toBe('b');
    expect(parent.block!.map((c) => c.as)).toEqual(['b1', 'b2']);
  });

  it('always renders one node, even one larger than the whole budget', () => {
    const win = windowCompactSteps(tree(), { maxItems: 60, budgetChars: 1 });
    expect(win.returned).toBe(1);
    expect(win.next_offset).toBe(1);
  });
});

describe('toCompactRecipe continuation', () => {
  it('carries a cursor that resumes the tree without repeating a step', () => {
    const first = toCompactRecipe(loopCode(), 1, version, true, { maxItems: 2 });
    expect(first.truncated).toBe(true);
    expect(first.steps_returned).toBe(2);
    const state = decodeCursor(first.next_cursor!)!;
    expect(state.o.steps).toBe(2);

    const second = toCompactRecipe(loopCode(), 1, version, true, {
      maxItems: 60,
      offset: state.o.steps,
    });
    expect(second.truncated).toBe(false);

    const rendered = (steps: CompactStep[]): string[] =>
      steps.flatMap((s) => [
        ...(s.partial === true ? [] : [s.as ?? '?']),
        ...rendered(s.block ?? []),
      ]);
    expect(rendered(first.steps)).toEqual(['py01', '0e8ba850']);
    expect(rendered(second.steps)).toEqual(['cond03', 'log04', 'else05', 'log06']);
  });
});

describe('inspectStep continuation', () => {
  it('continues a broad field filter from the cursor without repeats', () => {
    const big: RawSchemaEntry[] = Array.from({ length: 300 }, (_, i) => ({
      name: `field_${i}`,
      label: `Field ${i}`,
      type: 'string',
    }));
    const node: RawNode = { number: 9, keyword: 'action', as: 'big', extended_input_schema: big };

    const seen: string[] = [];
    let cursor: string | undefined;
    let calls = 0;
    do {
      const state: ReturnType<typeof decodeCursor> = cursor ? decodeCursor(cursor) : null;
      const view = inspectStep(node, node, 1, {
        fieldQuery: 'field_',
        maxItems: 60,
        budgetChars: 2_000,
        offsets: state?.o,
      });
      expect(view.fields!.length).toBeGreaterThan(0);
      expect(view.fields!.length).toBeLessThanOrEqual(60);
      expect(JSON.stringify(view).length).toBeLessThan(4_000);
      seen.push(...view.fields!.map((f) => f.name));
      cursor = view.next_cursor;
      calls += 1;
    } while (cursor && calls < 60);

    expect(cursor).toBeUndefined();
    expect(seen).toHaveLength(300);
    expect(new Set(seen).size).toBe(300);
  });
});

describe('inspectSteps', () => {
  it('reads several steps against one snapshot', () => {
    const code = loopCode();
    const refs = ['log04', 'log06'].map((ref) => ({ ref, node: findStep(code, ref)! }));
    const view = inspectSteps(code, refs, 1, { versionNo: 4 });
    expect(view.requested).toBe(2);
    expect(view.returned).toBe(2);
    expect(view.version_no).toBe(4);
    expect(view.steps.map((s) => s.step.as)).toEqual(['log04', 'log06']);
    expect(view.truncated).toBe(false);
  });

  it('stops on the budget and names the step to resume at', () => {
    const code = loopCode();
    const refs = ['py01', 'log04', 'log06'].map((ref) => ({ ref, node: findStep(code, ref)! }));
    const view = inspectSteps(code, refs, 1, { budgetChars: 700 });
    expect(view.truncated).toBe(true);
    const state = decodeCursor(view.next_cursor!)!;
    expect(state.s).toBeGreaterThanOrEqual(0);
    expect(state.s!).toBeLessThan(3);
  });
});
