import { describe, expect, test } from '@jest/globals';

import {
  applyDerivedSchemas,
  compareSchemas,
  deriveClockTriggerSchema,
  deriveSchemasForStep,
  deriveVariablesSchema,
  mergeFieldSchemas,
  normalizeDeclaredField,
  parseDeclaredFields,
  parseVariableComposite,
  writeDerivedSchemas,
} from './workato-recipe-schema';

/**
 * Fixtures are the verbatim shapes from skills/workato-recipes/code-tree.md,
 * so a derivation that drifts from what Workato itself emits fails here.
 */
const declareListStep = (): any => ({
  as: '641f89e1',
  keyword: 'action',
  name: 'declare_list',
  provider: 'workato_variable',
  number: 1,
  uuid: '11111111-1111-4111-8111-111111111111',
  input: {
    name: 'Items',
    list_item_schema_json:
      '[{"name":"value","type":"string","optional":false,"control_type":"text","label":"Value"}]',
    list_items: [{ value: 'apple' }, { value: 'banana' }],
  },
});

const declareVariableStep = (): any => ({
  as: 'e65113a6',
  keyword: 'action',
  name: 'declare_variable',
  provider: 'workato_variable',
  number: 1,
  uuid: '22222222-2222-4222-8222-222222222222',
  input: {
    variables: {
      data: { asset_id: '=_dp(\'{"pill_type":"job_context","path":["job_id"]}\')' },
      schema:
        '[{"name":"asset_id","type":"string","optional":true,"label":"Asset ID","control_type":"text"}]',
    },
  },
});

const clockTrigger = (unit = 'minutes', every = '5'): any => ({
  as: 'e74c2506',
  keyword: 'trigger',
  name: 'scheduled_event',
  provider: 'clock',
  number: 0,
  uuid: '33333333-3333-4333-8333-333333333333',
  input: { time_unit: unit, trigger_every: every },
});

describe('declared field parsing', () => {
  test('reads the string-encoded JSON array Workato stores', () => {
    const fields = parseDeclaredFields(
      '[{"name":"value","type":"string","optional":false,"control_type":"text","label":"Value"}]',
    );
    expect(fields).toEqual([
      { control_type: 'text', label: 'Value', name: 'value', optional: false, type: 'string' },
    ]);
  });

  test('an already-parsed array is accepted, a non-array or unparseable string is not', () => {
    expect(parseDeclaredFields([{ name: 'a' }])).toHaveLength(1);
    expect(parseDeclaredFields('not json')).toBeNull();
    expect(parseDeclaredFields('{"name":"a"}')).toBeNull();
    expect(parseDeclaredFields(undefined)).toBeNull();
    expect(parseDeclaredFields('[{"type":"string"}]')).toBeNull();
  });

  test('label falls back to the humanized name, optional and control_type are never invented', () => {
    expect(normalizeDeclaredField({ name: 'asset_id' })).toEqual({
      label: 'Asset id',
      name: 'asset_id',
      type: 'string',
    });
  });

  test('nested object properties and array items keep their declared types and optional flags', () => {
    const field = normalizeDeclaredField({
      name: 'lines',
      type: 'array',
      of: 'object',
      optional: true,
      properties: [
        { name: 'sku', type: 'string', optional: false },
        {
          name: 'meta',
          type: 'object',
          properties: [{ name: 'qty', type: 'integer', optional: true }],
        },
      ],
    });
    expect(field).toEqual({
      label: 'Lines',
      name: 'lines',
      type: 'array',
      of: 'object',
      optional: true,
      properties: [
        { label: 'Sku', name: 'sku', type: 'string', optional: false },
        {
          label: 'Meta',
          name: 'meta',
          type: 'object',
          properties: [{ label: 'Qty', name: 'qty', type: 'integer', optional: true }],
        },
      ],
    });
  });
});

describe('deriveVariablesSchema: declare_list', () => {
  test('reproduces the verbatim shape Workato emits, input optional and output required', () => {
    const derived: any = deriveVariablesSchema(declareListStep());
    expect(derived.ok).toBe(true);
    expect(derived.kind).toBe('declare_list');
    expect(derived.evidence).toBe('verified');
    expect(derived.extended_input_schema).toEqual([
      {
        label: 'Items',
        name: 'list_items',
        type: 'array',
        of: 'object',
        optional: true,
        properties: [
          { control_type: 'text', label: 'Value', name: 'value', optional: false, type: 'string' },
        ],
      },
    ]);
    expect(derived.extended_output_schema).toEqual([
      {
        label: 'Items',
        name: 'list_items',
        type: 'array',
        of: 'object',
        optional: false,
        properties: [
          { control_type: 'text', label: 'Value', name: 'value', optional: false, type: 'string' },
        ],
      },
    ]);
    expect(derived.fields).toEqual(['list_items']);
  });

  test('refuses when the item shape is not declared, rather than reading it off list_items', () => {
    const step = declareListStep();
    delete step.input.list_item_schema_json;
    const derived: any = deriveVariablesSchema(step);
    expect(derived.ok).toBe(false);
    expect(derived.reason).toContain('list_item_schema_json');
    expect(derived.reason).toContain('never guessed');
  });
});

describe('deriveVariablesSchema: insert_to_list', () => {
  const tree = (): any => ({
    number: 0,
    keyword: 'trigger',
    provider: 'clock',
    name: 'scheduled_event',
    as: 'aaaaaaaa',
    uuid: '44444444-4444-4444-8444-444444444444',
    input: { time_unit: 'minutes', trigger_every: '5' },
    block: [
      declareListStep(),
      {
        as: 'e48d0745',
        keyword: 'action',
        name: 'insert_to_list',
        provider: 'workato_variable',
        number: 2,
        uuid: '55555555-5555-4555-8555-555555555555',
        input: {
          name: 'fda41c1c-b715-4c30-8094-5974415c2b40:641f89e1',
          location: 'end',
          list_item: { value: 'cherry' },
        },
      },
    ],
  });

  test('takes the item shape from the declare_list it names through the composite', () => {
    const code = tree();
    const step = code.block[1];
    const derived: any = deriveVariablesSchema(step, { code });
    expect(derived.ok).toBe(true);
    expect(derived.extended_input_schema).toEqual([
      {
        label: 'List item',
        name: 'list_item',
        type: 'object',
        optional: false,
        properties: [
          { control_type: 'text', label: 'Value', name: 'value', optional: false, type: 'string' },
        ],
      },
    ]);
    expect(derived.extended_output_schema).toBeUndefined();
  });

  test('refuses without the tree, and when the composite points at nothing', () => {
    const code = tree();
    const step = code.block[1];
    expect((deriveVariablesSchema(step) as any).reason).toContain('needs the recipe tree');
    step.input.name = 'fda41c1c-b715-4c30-8094-5974415c2b40:deadbeef';
    expect((deriveVariablesSchema(step, { code }) as any).reason).toContain(
      'not a step in this recipe',
    );
  });
});

describe('deriveVariablesSchema: declare_variable and update_variables', () => {
  test('declare_variable declares its variables as output pills only', () => {
    const derived: any = deriveVariablesSchema(declareVariableStep());
    expect(derived.ok).toBe(true);
    expect(derived.extended_output_schema).toEqual([
      {
        control_type: 'text',
        label: 'Asset ID',
        name: 'asset_id',
        optional: true,
        type: 'string',
      },
    ]);
    expect(derived.extended_input_schema).toBeUndefined();
    expect(derived.evidence).toBe('documented');
  });

  test('update_variables reads the type from the declaration, never from the value', () => {
    const code: any = {
      number: 0,
      keyword: 'trigger',
      provider: 'clock',
      name: 'scheduled_event',
      as: 'aaaaaaaa',
      uuid: '66666666-6666-4666-8666-666666666666',
      input: { time_unit: 'minutes', trigger_every: '5' },
      block: [
        declareVariableStep(),
        {
          as: 'bbbbbbbb',
          keyword: 'action',
          name: 'update_variables',
          provider: 'workato_variable',
          number: 2,
          uuid: '77777777-7777-4777-8777-777777777777',
          input: {
            input_mode: 'raw',
            name: '6ed0ff64-5408-4c61-9f6e-d807328bb851:e65113a6:asset_id',
            asset_id: "=_dp('...').sub(/^[0]+/,'')",
          },
        },
      ],
    };
    const derived: any = deriveVariablesSchema(code.block[1], { code });
    expect(derived.ok).toBe(true);
    expect(derived.fields).toEqual(['asset_id']);
    expect(derived.extended_input_schema).toEqual([
      { control_type: 'text', label: 'Asset ID', name: 'asset_id', optional: true, type: 'string' },
    ]);

    code.block[1].input.other_var = 'x';
    const refused: any = deriveVariablesSchema(code.block[1], { code });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('other_var');
    expect(refused.reason).toContain('never taken from the value');
  });
});

describe('parseVariableComposite', () => {
  test('accepts the two-part and three-part forms and rejects anything else', () => {
    expect(parseVariableComposite('fda41c1c-b715-4c30-8094-5974415c2b40:641f89e1')).toEqual({
      uuid: 'fda41c1c-b715-4c30-8094-5974415c2b40',
      as: '641f89e1',
    });
    expect(
      parseVariableComposite('6ed0ff64-5408-4c61-9f6e-d807328bb851:e65113a6:asset_id'),
    ).toEqual({
      uuid: '6ed0ff64-5408-4c61-9f6e-d807328bb851',
      as: 'e65113a6',
      variable: 'asset_id',
    });
    expect(parseVariableComposite('Items')).toBeNull();
    expect(parseVariableComposite('fda41c1c:notahex8')).toBeNull();
    expect(parseVariableComposite(42)).toBeNull();
  });
});

describe('deriveClockTriggerSchema', () => {
  test('declares trigger_every as the select that makes it survive the save', () => {
    const derived: any = deriveClockTriggerSchema(clockTrigger('minutes', '60'));
    expect(derived.ok).toBe(true);
    expect(derived.evidence).toBe('verified');
    const field = derived.extended_input_schema[0];
    expect(field).toMatchObject({
      name: 'trigger_every',
      type: 'string',
      control_type: 'select',
      label: 'Trigger every',
      optional: false,
    });
    expect(field.options[0]).toEqual(['1', '1']);
    expect(field.options[field.options.length - 1]).toEqual(['60', '60']);
    expect(field.options).toHaveLength(60);
  });

  test('the unit picks the range, and a value outside it is added rather than dropped', () => {
    const hours: any = deriveClockTriggerSchema(clockTrigger('hours', '2'));
    expect(hours.extended_input_schema[0].options).toHaveLength(24);

    const odd: any = deriveClockTriggerSchema(clockTrigger('days', '90'));
    expect(odd.extended_input_schema[0].options).toContainEqual(['90', '90']);
    expect(odd.notes.join(' ')).toContain('outside the days range');
  });

  test('refuses a trigger with no trigger_every and a step that is not a clock trigger', () => {
    const step = clockTrigger();
    delete step.input.trigger_every;
    expect((deriveClockTriggerSchema(step) as any).reason).toContain('no input.trigger_every');
    expect((deriveClockTriggerSchema(declareListStep()) as any).reason).toContain(
      'not clock/scheduled_event',
    );
  });
});

describe('deriveSchemasForStep', () => {
  test('refuses a step whose shape nothing declares', () => {
    const result: any = deriveSchemasForStep({
      keyword: 'action',
      provider: 'salesforce',
      name: 'create_object',
      input: { sobject_name: 'Account' },
    } as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no deterministic');
  });
});

describe('compareSchemas', () => {
  const derived: any = (deriveVariablesSchema(declareListStep()) as any).extended_output_schema;

  test('an equivalent schema agrees even when labels differ', () => {
    const existing = JSON.parse(JSON.stringify(derived));
    existing[0].label = 'Something else';
    existing[0].properties[0].control_type = 'plain_text';
    expect(compareSchemas(existing, derived).agrees).toBe(true);
  });

  test('a type or a missing property is a disagreement', () => {
    const existing = JSON.parse(JSON.stringify(derived));
    existing[0].properties[0].type = 'integer';
    const result = compareSchemas(existing, derived);
    expect(result.agrees).toBe(false);
    expect(result.differences[0]).toContain('list_items.value is declared string');

    expect(compareSchemas([], derived).differences[0]).toContain('does not list it');
    expect(compareSchemas('nope', derived).agrees).toBe(false);
  });
});

describe('applyDerivedSchemas', () => {
  const tree = (): any => ({
    number: 0,
    keyword: 'trigger',
    provider: 'clock',
    name: 'scheduled_event',
    as: 'aaaaaaaa',
    uuid: '88888888-8888-4888-8888-888888888888',
    input: { time_unit: 'minutes', trigger_every: '5' },
    block: [declareListStep()],
  });

  test('fills in every missing schema the declarations imply, trigger included', () => {
    const code = tree();
    const result = applyDerivedSchemas(code);
    expect(result.applied.map((entry) => entry.kind).sort()).toEqual([
      'clock_trigger',
      'declare_list',
    ]);
    expect(code.extended_input_schema[0].name).toBe('trigger_every');
    expect(code.block[0].extended_input_schema[0].name).toBe('list_items');
    expect(code.block[0].extended_output_schema[0].optional).toBe(false);
    expect(result.applied.every((entry) => entry.status === 'added')).toBe(true);
  });

  test('a second pass changes nothing', () => {
    const code = tree();
    applyDerivedSchemas(code);
    expect(applyDerivedSchemas(code).applied).toEqual([]);
  });

  test('a schema that disagrees with the declaration is corrected and the difference is reported', () => {
    const code = tree();
    applyDerivedSchemas(code);
    code.block[0].extended_output_schema[0].properties[0].type = 'integer';
    const result = applyDerivedSchemas(code);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]).toMatchObject({
      step: '641f89e1',
      kind: 'declare_list',
      status: 'corrected',
      schemas: ['extended_output_schema'],
    });
    expect(result.applied[0].differences?.[0]).toContain('list_items.value is declared string');
    expect(code.block[0].extended_output_schema[0].properties[0].type).toBe('string');
  });

  test('dryRun reports without touching the tree', () => {
    const code = tree();
    const result = applyDerivedSchemas(code, { dryRun: true });
    expect(result.applied).toHaveLength(2);
    expect(code.extended_input_schema).toBeUndefined();
    expect(code.block[0].extended_input_schema).toBeUndefined();
  });

  test('a step with no declaration is skipped with a reason, never half-derived', () => {
    const code = tree();
    delete code.block[0].input.list_item_schema_json;
    const result = applyDerivedSchemas(code);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].step).toBe('641f89e1');
    expect(code.block[0].extended_input_schema).toBeUndefined();
  });
});

describe('writeDerivedSchemas', () => {
  test('replace rewrites an agreeing schema, the default leaves it alone', () => {
    const step = declareListStep();
    const derived = deriveVariablesSchema(step) as any;
    expect(writeDerivedSchemas(step, derived).status).toBe('added');
    expect(writeDerivedSchemas(step, derived).status).toBe('unchanged');
    expect(writeDerivedSchemas(step, derived, { replace: true }).status).toBe('rewritten');
  });
});

describe('mergeFieldSchemas', () => {
  const staticFields = [
    { name: 'message', type: 'string', control_type: 'text', label: 'Message', optional: false },
    { name: 'level', type: 'string', control_type: 'select', label: 'Level', optional: true },
  ];

  test('reports provenance per field and merges nested properties', () => {
    const report = mergeFieldSchemas(
      [{ name: 'payload', type: 'object', properties: [{ name: 'id', type: 'string' }] }],
      [
        {
          name: 'payload',
          type: 'object',
          properties: [
            { name: 'id', type: 'string' },
            { name: 'extra', type: 'integer' },
          ],
        },
      ],
    );
    expect(report.provenance).toEqual({ payload: 'both' });
    expect(report.fields[0].properties?.map((field) => [field.name, field.provenance])).toEqual([
      ['id', 'both'],
      ['extra', 'dynamic'],
    ]);
  });

  test('complete is false while either side knows a field the other does not', () => {
    const partial = mergeFieldSchemas(staticFields, [
      { name: 'message', type: 'string' },
      { name: 'custom', type: 'string' },
    ]);
    expect(partial.complete).toBe(false);
    expect(partial.only_static).toEqual(['level']);
    expect(partial.only_dynamic).toEqual(['custom']);
    expect(partial.reasons.join(' ')).toContain('not declared on the step');
    expect(partial.reasons.join(' ')).toContain('not in the adapter meta');

    const matched = mergeFieldSchemas(staticFields, staticFields);
    expect(matched.complete).toBe(true);
    expect(matched.reasons).toEqual([]);
    expect(matched.provenance).toEqual({ message: 'both', level: 'both' });
  });

  test('a missing source is named rather than passed off as agreement', () => {
    expect(mergeFieldSchemas(staticFields, undefined).reasons).toContain(
      'the step declares no extended schema',
    );
    expect(mergeFieldSchemas(undefined, staticFields).reasons).toContain(
      'no static adapter fields were supplied',
    );
    expect(mergeFieldSchemas(undefined, staticFields).complete).toBe(false);
  });

  test('the step wins on a key it carries, the adapter fills in the rest', () => {
    const report = mergeFieldSchemas(
      [{ name: 'message', type: 'string', control_type: 'text', hint: 'from the adapter' }],
      [{ name: 'message', type: 'text' }],
    );
    expect(report.fields[0]).toMatchObject({
      name: 'message',
      type: 'text',
      control_type: 'text',
      hint: 'from the adapter',
      provenance: 'both',
    });
  });
});
