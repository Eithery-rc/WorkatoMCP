/**
 * @fileoverview Tests for the workato_pull_recipe compact/step transform layer.
 */

import { describe, expect, it } from 'vitest';

import {
  FIELD_CAP,
  collectUpstreamDatapills,
  compactNode,
  findStep,
  flattenInput,
  flattenSchema,
  inspectStep,
  listStepRefs,
  pillToRef,
  shortenDatapills,
  stripHtml,
  toCompactRecipe,
  type RawNode,
  type RawSchemaEntry,
  type RecipeVersion,
} from '@/entrypoints/background/tools/workato/recipe-view';

const version: RecipeVersion = {
  version_no: 12,
  name: 'AdPay Load MVP',
  folder_id: 123,
  description: 'loads adpay',
};

/** A small but representative raw recipe code tree. */
function sampleCode(): RawNode {
  return {
    number: 0,
    keyword: 'trigger',
    provider: 'scheduler',
    name: 'scheduled_event',
    as: 'trigger00',
    uuid: 'trig-uuid',
    title: null,
    description: 'Run on a <span class="provider">schedule</span>',
    input: { interval: 'daily' },
    extended_output_schema: [{ name: 'started_at', label: 'Started at', type: 'date_time' }],
    block: [
      {
        number: 2,
        keyword: 'action',
        provider: 'workato_db_table',
        name: 'get_records',
        as: '98cc4bea',
        uuid: 'step2-uuid',
        title: null,
        description: 'Search records in <span class="provider">errors</span> data table',
        input: { table_id: '110379', limit: '1000' },
        skip: false,
        visible_config_fields: ['table_id', 'limit'],
        dynamicPickListSelection: { table_id: 'errors' },
        extended_input_schema: [
          { name: 'table_id', label: 'Table', type: 'string', control_type: 'text' },
          { name: 'limit', label: 'Row limit', type: 'integer', optional: true },
        ],
        extended_output_schema: [
          {
            name: 'records',
            label: 'Records',
            type: 'array',
            properties: [
              { name: 'amount', label: 'Order amount', type: 'number', control_type: 'number' },
              { name: 'id', label: 'Record ID', type: 'string' },
            ],
          },
        ],
      },
      {
        number: 3,
        keyword: 'if',
        as: 'cond03',
        input: { conditions: 'present' },
        skip: true,
        block: [
          {
            number: 4,
            keyword: 'action',
            provider: 'logger',
            name: 'log_message',
            as: 'log04',
            input: { message: 'hi' },
            extended_input_schema: [{ name: 'message', label: 'Message', type: 'string' }],
          },
        ],
      },
    ],
  };
}

describe('stripHtml', () => {
  it('removes tags and collapses whitespace', () => {
    expect(stripHtml('Search in <span class="provider">errors</span>  table')).toBe(
      'Search in errors table',
    );
  });

  it('decodes basic entities and tolerates non-strings', () => {
    expect(stripHtml('a &amp; b')).toBe('a & b');
    expect(stripHtml(undefined)).toBe('');
    expect(stripHtml(42)).toBe('');
  });
});

describe('compactNode', () => {
  it('drops UI-metadata sections and keeps configured input', () => {
    const step = sampleCode().block![0];
    const compact = compactNode(step);
    expect(compact).not.toHaveProperty('extended_input_schema');
    expect(compact).not.toHaveProperty('extended_output_schema');
    expect(compact).not.toHaveProperty('visible_config_fields');
    expect(compact).not.toHaveProperty('dynamicPickListSelection');
    expect(compact.input).toEqual({ table_id: '110379', limit: '1000' });
  });

  it('shortens _dp(...) datapills in input', () => {
    const node: RawNode = {
      number: 9,
      keyword: 'action',
      as: 'step9',
      input: {
        total:
          '#{_dp(\'{"pill_type":"output","provider":"py_eval","line":"e4f443bd","path":["output","total"]}\')}',
      },
    };
    expect(compactNode(node).input).toEqual({
      total: '#{datapill(py_eval.e4f443bd.output.total)}',
    });
  });

  it('omits input entirely when omitInput is set', () => {
    expect(compactNode(sampleCode().block![0], true)).not.toHaveProperty('input');
  });

  it('renames keys and strips description HTML', () => {
    const compact = compactNode(sampleCode().block![0]);
    expect(compact.n).toBe(2);
    expect(compact.type).toBe('action');
    expect(compact.app).toBe('workato_db_table');
    expect(compact.description).toBe('Search records in errors data table');
  });

  it('omits skip when false but keeps it when true', () => {
    expect(compactNode(sampleCode().block![0])).not.toHaveProperty('skip');
    expect(compactNode(sampleCode().block![1]).skip).toBe(true);
  });

  it('recurses into nested blocks', () => {
    const compact = compactNode(sampleCode().block![1]);
    expect(compact.block).toHaveLength(1);
    expect(compact.block![0].n).toBe(4);
  });
});

describe('toCompactRecipe', () => {
  it('splits trigger from steps and counts nested steps', () => {
    const recipe = toCompactRecipe(sampleCode(), 72436887, version);
    expect(recipe.recipe_id).toBe(72436887);
    expect(recipe.name).toBe('AdPay Load MVP');
    expect(recipe.version).toEqual({ version_no: 12, folder_id: 123, description: 'loads adpay' });
    expect(recipe.trigger.type).toBe('trigger');
    expect(recipe.trigger).not.toHaveProperty('block');
    expect(recipe.steps).toHaveLength(2);
    expect(recipe.step_count).toBe(3); // step 2, if 3, nested action 4
  });

  it('drops every step input in outline mode (omitInput) but keeps structure', () => {
    const outline = toCompactRecipe(sampleCode(), 72436887, version, true);
    expect(outline.trigger).not.toHaveProperty('input');
    expect(outline.steps[0]).not.toHaveProperty('input');
    expect(outline.steps[1].block![0]).not.toHaveProperty('input');
    // structure and descriptions survive
    expect(outline.steps[0].app).toBe('workato_db_table');
    expect(outline.steps[0].description).toBe('Search records in errors data table');
    expect(outline.step_count).toBe(3);
  });
});

describe('pillToRef', () => {
  it('renders an output pill as provider.line.path with [] for loop items', () => {
    expect(
      pillToRef({
        pill_type: 'output',
        provider: 'py_eval',
        line: 'e4f443bd',
        path: [
          'output',
          'Invoices',
          { path_element_type: 'current_item' },
          'lines',
          { path_element_type: 'current_item' },
          'amount',
        ],
      }),
    ).toBe('datapill(py_eval.e4f443bd.output.Invoices[].lines[].amount)');
  });

  it('renders a job_context pill and a size element', () => {
    expect(pillToRef({ pill_type: 'job_context', path: ['parameters', 'flowCode'] })).toBe(
      'datapill(job_context.parameters.flowCode)',
    );
    expect(
      pillToRef({
        pill_type: 'output',
        provider: 'logger',
        line: 'ac1fa99f',
        path: ['rows', { path_element_type: 'size' }],
      }),
    ).toBe('datapill(logger.ac1fa99f.rows.size)');
  });
});

describe('shortenDatapills', () => {
  const pill =
    '{"pill_type":"output","provider":"py_eval","line":"e4f443bd","path":["output","total"]}';

  it('shortens an interpolated datapill inside a string', () => {
    expect(shortenDatapills(`#{_dp('${pill}')}`)).toBe(
      '#{datapill(py_eval.e4f443bd.output.total)}',
    );
  });

  it('shortens multiple datapills in a formula expression', () => {
    const formula = `=_dp('${pill}').to_f + _dp('${pill}').to_f`;
    expect(shortenDatapills(formula)).toBe(
      '=datapill(py_eval.e4f443bd.output.total).to_f + datapill(py_eval.e4f443bd.output.total).to_f',
    );
  });

  it('recurses into nested objects and arrays', () => {
    const result = shortenDatapills({
      a: `#{_dp('${pill}')}`,
      b: [`#{_dp('${pill}')}`, 7],
    }) as Record<string, unknown>;
    expect(result.a).toBe('#{datapill(py_eval.e4f443bd.output.total)}');
    expect((result.b as unknown[])[0]).toBe('#{datapill(py_eval.e4f443bd.output.total)}');
    expect((result.b as unknown[])[1]).toBe(7);
  });

  it('leaves an unparseable datapill reference untouched', () => {
    expect(shortenDatapills("=_dp('not json').foo")).toBe("=_dp('not json').foo");
  });

  it('passes non-string scalars through unchanged', () => {
    expect(shortenDatapills(42)).toBe(42);
    expect(shortenDatapills(null)).toBeNull();
  });
});

describe('findStep / listStepRefs', () => {
  it('resolves by as anchor and by numeric step number', () => {
    expect(findStep(sampleCode(), '98cc4bea')?.number).toBe(2);
    expect(findStep(sampleCode(), '4')?.as).toBe('log04');
    expect(findStep(sampleCode(), 'trigger00')?.keyword).toBe('trigger');
  });

  it('returns null on a miss', () => {
    expect(findStep(sampleCode(), 'nope')).toBeNull();
  });

  it('lists every step ref including the trigger', () => {
    const refs = listStepRefs(sampleCode());
    expect(refs).toHaveLength(4);
    expect(refs[0]).toEqual({ n: 0, as: 'trigger00' });
  });
});

describe('flattenSchema', () => {
  it('flattens nested array properties with bracketed dotted paths', () => {
    const schema = sampleCode().block![0].extended_output_schema!;
    const fields = flattenSchema(schema, 'out');
    expect(fields.map((f) => f.path)).toEqual(['records', 'records[].amount', 'records[].id']);
    expect(fields.every((f) => f.io === 'out')).toBe(true);
  });

  it('uses a dotted (no-bracket) path for object nesting', () => {
    const schema: RawSchemaEntry[] = [
      {
        name: 'addr',
        type: 'object',
        properties: [{ name: 'city', type: 'string' }],
      },
    ];
    expect(flattenSchema(schema, 'in').map((f) => f.path)).toEqual(['addr', 'addr.city']);
  });

  it('tolerates a missing schema', () => {
    expect(flattenSchema(undefined, 'in')).toEqual([]);
  });
});

const PILL = '{"pill_type":"output","provider":"py_eval","line":"e4f443bd","path":["output","x"]}';

describe('flattenInput', () => {
  it('classifies literals, datapills, formulas, and interpolated values', () => {
    const maps = flattenInput({
      record_type: 'invoice',
      notice_id: `#{_dp('${PILL}')}`,
      amount: `=_dp('${PILL}').to_f + 1`,
      msg: `notice #{_dp('${PILL}')} done`,
    });
    const byPath = Object.fromEntries(maps.map((m) => [m.path, m]));
    expect(byPath.record_type.kind).toBe('literal');
    expect(byPath.notice_id.kind).toBe('datapill');
    expect(byPath.amount.kind).toBe('formula');
    expect(byPath.msg.kind).toBe('interpolated');
  });

  it('uses dotted keys and [index] for nested objects and arrays', () => {
    const maps = flattenInput({ filters: [{ field_id: 'job_id' }], a: { b: 'c' } });
    expect(maps.map((m) => m.path).sort()).toEqual(['a.b', 'filters[0].field_id']);
  });

  it('classifies a long non-JSON string as code and keeps it whole', () => {
    const code = `def main():\n${' x = 1\n'.repeat(60)}`;
    const [m] = flattenInput({ code });
    expect(m.kind).toBe('code');
    expect(m.value).toBe(code);
    expect(m.truncated).toBeUndefined();
  });

  it('shortens datapills inside a code body', () => {
    const code = `# build query\n${'x\n'.repeat(140)}val = _dp('${PILL}')`;
    const [m] = flattenInput({ code });
    expect(m.kind).toBe('code');
    expect(m.value).toContain('datapill(py_eval.e4f443bd.output.x)');
    expect(m.value).not.toContain('_dp(');
  });

  it('classifies a formula-mode pure datapill (=_dp(...)) as a datapill', () => {
    const [m] = flattenInput({ ref: `=_dp('${PILL}')` });
    expect(m.kind).toBe('datapill');
    expect(m.value).toBe('=datapill(py_eval.e4f443bd.output.x)');
  });

  it('previews a long JSON literal blob', () => {
    const blob = JSON.stringify(
      Array.from({ length: 50 }, (_, i) => ({ name: `f${i}`, type: 'string' })),
    );
    const [m] = flattenInput({ schema: blob });
    expect(m.kind).toBe('literal');
    expect(m.truncated).toBe(true);
    expect(m.chars).toBe(blob.length);
    expect((m.value as string).length).toBeLessThan(blob.length);
  });
});

describe('collectUpstreamDatapills', () => {
  it('collects output schemas of steps numbered below the threshold', () => {
    expect(collectUpstreamDatapills(sampleCode(), 2)).toEqual([
      { ref: 'datapill(scheduler.trigger00.started_at)', label: 'Started at', type: 'date_time' },
    ]);
  });

  it('returns nothing when no upstream step has an output schema', () => {
    expect(collectUpstreamDatapills(sampleCode(), 0)).toEqual([]);
  });

  it('recurses into nested blocks to reach steps inside if/try branches', () => {
    // Step 2 lives inside the if-block (step 1); reaching it proves the walk recurses.
    expect(collectUpstreamDatapills(sampleCode(), 5).map((d) => d.ref)).toEqual([
      'datapill(scheduler.trigger00.started_at)',
      'datapill(workato_db_table.98cc4bea.records)',
      'datapill(workato_db_table.98cc4bea.records[].amount)',
      'datapill(workato_db_table.98cc4bea.records[].id)',
    ]);
  });
});

describe('inspectStep', () => {
  it('returns a header without input, plus mappings, fields, and datapills', () => {
    const code = sampleCode();
    const view = inspectStep(code, findStep(code, '2')!, 72436887);
    expect(view.step.n).toBe(2);
    expect(view.step).not.toHaveProperty('input');
    expect(view.step).not.toHaveProperty('block');
    expect(view.mappings.map((m) => m.path).sort()).toEqual(['limit', 'table_id']);
    expect(view.mappings.every((m) => m.kind === 'literal')).toBe(true);
    expect(view.fields.map((f) => f.name).sort()).toEqual(['limit', 'table_id']);
  });

  it('lists datapills from upstream steps only', () => {
    const code = sampleCode();
    const view = inspectStep(code, findStep(code, '2')!, 72436887);
    expect(view.available_datapills).toEqual([
      { ref: 'datapill(scheduler.trigger00.started_at)', label: 'Started at', type: 'date_time' },
    ]);
  });

  it('filters fields and datapills by query, lifting the cap', () => {
    const code = sampleCode();
    const view = inspectStep(code, findStep(code, '2')!, 72436887, 'limit');
    expect(view.fields.map((f) => f.name)).toEqual(['limit']);
    expect(view.available_datapills).toEqual([]);
    expect(view.fields_truncated).toBe(false);
  });

  it('caps fields at FIELD_CAP and flags truncation without a query', () => {
    const big: RawSchemaEntry[] = Array.from({ length: FIELD_CAP + 5 }, (_, i) => ({
      name: `f${i}`,
      type: 'string',
    }));
    const node: RawNode = { number: 9, keyword: 'action', as: 'big', extended_input_schema: big };
    const view = inspectStep(node, node, 1);
    expect(view.fields).toHaveLength(FIELD_CAP);
    expect(view.total_fields).toBe(FIELD_CAP + 5);
    expect(view.fields_truncated).toBe(true);
  });

  it('caps available_datapills at FIELD_CAP and flags truncation', () => {
    const bigOut: RawSchemaEntry[] = Array.from({ length: FIELD_CAP + 5 }, (_, i) => ({
      name: `o${i}`,
      type: 'string',
    }));
    const target: RawNode = { number: 9, keyword: 'action', as: 'tgt' };
    const code: RawNode = {
      number: 0,
      keyword: 'trigger',
      provider: 'scheduler',
      as: 'trig0000',
      extended_output_schema: bigOut,
      block: [target],
    };
    const view = inspectStep(code, target, 1);
    expect(view.available_datapills).toHaveLength(FIELD_CAP);
    expect(view.total_datapills).toBe(FIELD_CAP + 5);
    expect(view.datapills_truncated).toBe(true);
  });
});
