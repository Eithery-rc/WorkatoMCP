/**
 * @fileoverview A step whose `extended_input_schema` is empty used to answer
 * `fields: []`, which reads as "this step takes nothing". These tests cover
 * the merge that fills the gap from the adapter's own field list, the
 * provenance it stamps on each field, and the honesty flag that says when the
 * merged list still is not the whole settable surface.
 *
 * The adapter fixture is trimmed from the real /integrations/meta body used in
 * adapter-meta.test.ts, plus a connectionless built-in (logger).
 */

import { describe, expect, it } from 'vitest';

import { findOperationInputFields } from '@/entrypoints/background/tools/workato/adapter-meta';
import {
  buildStaticFieldIndex,
  stepsNeedingStaticFields,
} from '@/entrypoints/background/tools/workato/pull-recipe';
import {
  flattenAdapterFields,
  inspectStep,
  mergeFieldSources,
  staticFieldKey,
  type FieldEntry,
  type RawNode,
  type StaticFieldIndex,
} from '@/entrypoints/background/tools/workato/recipe-view';

const META = {
  logger: {
    title: 'Logger by Workato',
    config: { required: false },
    triggers: {},
    actions: {
      log_message: {
        title: 'Log message',
        input: [
          { name: 'message', label: 'Message', type: 'string', control_type: 'text' },
          { name: 'level', label: 'Level', type: 'string', control_type: 'select', optional: true },
        ],
        output: [],
      },
    },
  },
  workato_recipe_function: {
    title: 'Recipe function',
    triggers: {},
    actions: {
      call_recipe: {
        title: 'Call a recipe function (synchronous)',
        input: [
          {
            control_type: 'select',
            label: 'Recipe function',
            pick_list: 'recipe_functions',
            type: 'string',
            name: 'flow_id',
          },
        ],
        output: [],
        // Its real fields are derived from the callee's parameters schema.
        extends_input_schema: true,
      },
    },
  },
  salesforce: {
    title: 'Salesforce',
    triggers: {},
    actions: {
      create_object: {
        title: 'Create object',
        input: [
          { name: 'sobject_name', label: 'Object', type: 'string', control_type: 'select' },
          {
            name: 'record',
            label: 'Record',
            type: 'object',
            properties: [
              { name: 'Name', label: 'Name', type: 'string' },
              { name: 'AnnualRevenue', label: 'Annual revenue', type: 'number', optional: true },
            ],
          },
          {
            name: 'rows',
            label: 'Rows',
            type: 'array',
            of: 'object',
            properties: [{ name: 'Id', label: 'Id', type: 'string' }],
          },
        ],
        output: [],
      },
    },
  },
};

const step = (over: Partial<RawNode> = {}): RawNode =>
  ({
    number: 3,
    as: 'a1b2c3d4',
    keyword: 'action',
    provider: 'logger',
    name: 'log_message',
    input: { message: 'hello' },
    ...over,
  }) as RawNode;

const trigger = (): RawNode =>
  ({
    number: 0,
    keyword: 'trigger',
    as: 'trig',
    provider: 'clock',
    name: 'scheduled_event',
  }) as RawNode;

describe('stepsNeedingStaticFields', () => {
  it('names an app step that declares no schema of its own', () => {
    expect(stepsNeedingStaticFields([step()])).toEqual([
      { provider: 'logger', name: 'log_message' },
    ]);
  });

  it('skips a step that already declares one', () => {
    const withSchema = step({
      extended_input_schema: [{ name: 'message', type: 'string' }],
    } as Partial<RawNode>);
    expect(stepsNeedingStaticFields([withSchema])).toEqual([]);
  });

  it('skips a control step with no provider or name', () => {
    const ifNode = { number: 2, keyword: 'if', as: 'deadbeef' } as RawNode;
    expect(stepsNeedingStaticFields([ifNode])).toEqual([]);
  });

  it('asks for each operation once', () => {
    expect(stepsNeedingStaticFields([step(), step({ as: 'other' }), trigger()])).toEqual([
      { provider: 'logger', name: 'log_message' },
      { provider: 'clock', name: 'scheduled_event' },
    ]);
  });
});

describe('findOperationInputFields', () => {
  it('finds a connectionless built-in action', () => {
    const found = findOperationInputFields(META, 'logger', 'log_message');
    expect(found?.fields.map((f) => f.name)).toEqual(['message', 'level']);
    expect(found?.extends_input_schema).toBe(false);
  });

  it('reports an operation that derives its own input schema', () => {
    const found = findOperationInputFields(META, 'workato_recipe_function', 'call_recipe');
    expect(found?.extends_input_schema).toBe(true);
  });

  it('returns null for an adapter or operation the meta does not describe', () => {
    expect(findOperationInputFields(META, 'netsuite', 'add_record')).toBeNull();
    expect(findOperationInputFields(META, 'logger', 'no_such_action')).toBeNull();
  });
});

describe('flattenAdapterFields', () => {
  it('flattens objects and arrays into the same dotted paths as a step schema', () => {
    const fields = flattenAdapterFields(
      findOperationInputFields(META, 'salesforce', 'create_object')!.fields,
    );
    expect(fields.map((f) => f.path)).toEqual([
      'sobject_name',
      'record',
      'record.Name',
      'record.AnnualRevenue',
      'rows',
      'rows[].Id',
    ]);
    expect(fields.every((f) => f.io === 'in')).toBe(true);
  });

  it('treats a field without optional:false as optional', () => {
    const fields = flattenAdapterFields([{ name: 'note', type: 'string' }]);
    expect(fields[0].optional).toBe(true);
    // Workato writes optional:false for a required field.
    expect(flattenAdapterFields([{ name: 'id', optional: false }])[0].optional).toBe(false);
  });
});

describe('mergeFieldSources', () => {
  const dynamic: FieldEntry[] = [
    {
      path: 'message',
      name: 'message',
      label: '',
      type: 'string',
      optional: false,
      control_type: '',
      io: 'in',
    },
  ];
  const statics: FieldEntry[] = [
    {
      path: 'message',
      name: 'message',
      label: 'Message',
      type: 'string',
      optional: false,
      control_type: 'text',
      io: 'in',
    },
    {
      path: 'level',
      name: 'level',
      label: 'Level',
      type: 'string',
      optional: true,
      control_type: 'select',
      io: 'in',
    },
  ];

  it("marks a field both sources declare as 'both' and fills the blanks", () => {
    const merged = mergeFieldSources(dynamic, statics);
    expect(merged[0]).toMatchObject({
      path: 'message',
      provenance: 'both',
      label: 'Message',
      control_type: 'text',
    });
  });

  it("appends a field only the adapter knows as 'static'", () => {
    const merged = mergeFieldSources(dynamic, statics);
    expect(merged.map((f) => [f.path, f.provenance])).toEqual([
      ['message', 'both'],
      ['level', 'static'],
    ]);
  });

  it("marks a field only the step declares as 'dynamic' and keeps its values", () => {
    const extra: FieldEntry[] = [
      {
        path: 'custom',
        name: 'custom',
        label: 'Mine',
        type: 'string',
        optional: true,
        control_type: 'text',
        io: 'in',
      },
    ];
    const merged = mergeFieldSources(extra, statics);
    expect(merged[0]).toMatchObject({ path: 'custom', provenance: 'dynamic', label: 'Mine' });
  });

  it('never lets the adapter overwrite a value the step declared', () => {
    const opinionated: FieldEntry[] = [
      {
        path: 'message',
        name: 'message',
        label: 'Step label',
        type: 'object',
        optional: true,
        control_type: 'text-area',
        io: 'in',
      },
    ];
    expect(mergeFieldSources(opinionated, statics)[0]).toMatchObject({
      label: 'Step label',
      type: 'object',
      control_type: 'text-area',
    });
  });
});

describe('inspectStep field completeness', () => {
  const index = (): StaticFieldIndex =>
    buildStaticFieldIndex(META, [
      { provider: 'logger', name: 'log_message' },
      { provider: 'workato_recipe_function', name: 'call_recipe' },
    ]);

  it('fills an empty field list from the adapter and says the list is complete', () => {
    const node = step();
    const view = inspectStep(node, node, 1, { include: ['fields'], staticFields: index() });

    expect(view.fields?.map((f) => [f.name, f.provenance])).toEqual([
      ['message', 'static'],
      ['level', 'static'],
    ]);
    expect(view.total_fields).toBe(2);
    expect(view.fields_complete).toBe(true);
  });

  it('reports incomplete when the adapter derives its input schema', () => {
    const node = step({ provider: 'workato_recipe_function', name: 'call_recipe' });
    const view = inspectStep(node, node, 1, { include: ['fields'], staticFields: index() });

    expect(view.fields?.map((f) => f.name)).toEqual(['flow_id']);
    expect(view.fields_complete).toBe(false);
  });

  it('reports incomplete when nothing could be read for the operation', () => {
    const node = step({ provider: 'netsuite', name: 'add_record' });
    const view = inspectStep(node, node, 1, { include: ['fields'], staticFields: index() });

    expect(view.fields).toEqual([]);
    expect(view.fields_complete).toBe(false);
  });

  it("keeps the step's own schema authoritative and adds no provenance", () => {
    const node = step({
      extended_input_schema: [{ name: 'message', label: 'Message', type: 'string' }],
    } as Partial<RawNode>);
    const view = inspectStep(node, node, 1, { include: ['fields'], staticFields: index() });

    expect(view.fields?.map((f) => f.name)).toEqual(['message']);
    expect(view.fields?.[0].provenance).toBeUndefined();
    expect(view.fields_complete).toBe(true);
  });

  it('leaves the merge out entirely when no static fields were supplied', () => {
    const node = step();
    const view = inspectStep(node, node, 1, { include: ['fields'] });

    expect(view.fields).toEqual([]);
    expect(view.fields_complete).toBe(false);
  });

  it('does not emit fields_complete when fields were not requested', () => {
    const node = step();
    const view = inspectStep(node, node, 1, { include: ['mappings'], staticFields: index() });
    expect(view.fields_complete).toBeUndefined();
  });

  it('still applies the field filter to the merged list', () => {
    const node = step();
    const view = inspectStep(node, node, 1, {
      include: ['fields'],
      fieldQuery: 'level',
      staticFields: index(),
    });
    expect(view.fields?.map((f) => f.name)).toEqual(['level']);
    // The completeness verdict describes the step, not the filtered view.
    expect(view.fields_complete).toBe(true);
  });
});

describe('buildStaticFieldIndex', () => {
  it('keys the index by provider/name and drops what the meta does not describe', () => {
    const built = buildStaticFieldIndex(META, [
      { provider: 'logger', name: 'log_message' },
      { provider: 'netsuite', name: 'add_record' },
    ]);
    expect(Object.keys(built)).toEqual([staticFieldKey('logger', 'log_message')]);
    expect(built[staticFieldKey('logger', 'log_message')].complete).toBe(true);
  });
});
