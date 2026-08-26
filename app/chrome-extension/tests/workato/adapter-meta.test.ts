/**
 * @fileoverview Tests for workato_adapter_meta's response shaping — the slim
 * view, the three narrowing modes, and the field matcher.
 */

import { describe, expect, it } from 'vitest';

import {
  buildAdapterView,
  buildFieldMatcher,
  pickAdapterNode,
  slimOperation,
} from '@/entrypoints/background/tools/workato/adapter-meta';

/** Trimmed from the real /integrations/meta?name=workato_recipe_function body. */
const RECIPE_FUNCTION_META = {
  workato_recipe_function: {
    triggers: {
      execute: {
        name: 'execute',
        title: 'New call for function',
        help: {
          body: 'Use this to build a recipe that can be called from another recipe<br><br>Define the parameters.',
        },
        input: [
          {
            control_type: 'schema-designer',
            label: 'Parameters schema',
            extends_schema: true,
            hint: 'Describe the schema for the recipe parameters',
            optional: true,
            type: 'string',
            name: 'parameters_schema_json',
          },
          {
            control_type: 'schema-designer',
            label: 'Result schema',
            optional: true,
            type: 'string',
            name: 'result_schema_json',
          },
        ],
        output: [{ name: 'context', label: 'Context', type: 'object' }],
        realtime: true,
      },
    },
    actions: {
      return_result: {
        title: 'Return data from a recipe function',
        help: { body: 'Return data to the parent recipe.' },
        input: [],
        output: [],
        extends_input_schema: true,
        extends_output_schema: true,
        depends_on: { keyword: 'trigger', number: 0, provider: 'workato_recipe_function' },
      },
      call_recipe: {
        title: 'Call a recipe function (synchronous)',
        input: [
          {
            control_type: 'select',
            label: 'Recipe function',
            pick_list: 'recipe_functions',
            extends_schema: true,
            type: 'string',
            name: 'flow_id',
          },
        ],
        output: [
          { control_type: 'text', label: 'Job ID', type: 'string', name: 'job_id' },
          { control_type: 'text', label: 'Job URL', type: 'string', name: 'job_url' },
        ],
        extends_input_schema: true,
      },
      call_recipe_async: { title: 'Call a recipe function (async)', deprecated: true, input: [] },
    },
  },
};

describe('pickAdapterNode', () => {
  it('finds the adapter keyed at the top level', () => {
    const node = pickAdapterNode(RECIPE_FUNCTION_META, 'workato_recipe_function');
    expect(node).toBeTruthy();
    expect(Object.keys(node!.triggers as object)).toEqual(['execute']);
  });

  it('unwraps a result envelope rather than reporting the adapter missing', () => {
    const wrapped = { result: RECIPE_FUNCTION_META };
    expect(pickAdapterNode(wrapped, 'workato_recipe_function')).toBeTruthy();
  });

  it('accepts a bare single-adapter document', () => {
    const bare = RECIPE_FUNCTION_META.workato_recipe_function;
    expect(pickAdapterNode(bare, 'anything')).toBe(bare);
  });

  it('returns null when the adapter really is absent', () => {
    // Another adapter being present must not be mistaken for the one asked for.
    expect(pickAdapterNode({ salesforce: { triggers: {} } }, 'netsuite')).toBeNull();
    expect(pickAdapterNode({ nothing: 1 }, 'netsuite')).toBeNull();
    expect(pickAdapterNode({ salesforce: { triggers: {} } }, 'salesforce')).toBeTruthy();
  });
});

describe('buildFieldMatcher', () => {
  it('matches a substring case-insensitively against name and label', () => {
    const m = buildFieldMatcher('schema');
    expect(m({ name: 'parameters_schema_json' })).toBe(true);
    expect(m({ name: 'flow_id', label: 'Recipe SCHEMA picker' })).toBe(true);
    expect(m({ name: 'job_id', label: 'Job ID' })).toBe(false);
  });

  it('accepts /regex/ form and forces case-insensitivity', () => {
    const m = buildFieldMatcher('/^result_/');
    expect(m({ name: 'RESULT_schema_json' })).toBe(true);
    expect(m({ name: 'parameters_schema_json' })).toBe(false);
  });
});

describe('slimOperation', () => {
  const raw = RECIPE_FUNCTION_META.workato_recipe_function.actions.return_result;

  it('keeps the behaviour flags that say where a schema comes from', () => {
    const op = slimOperation('return_result', 'action', raw, { detail: true, includeHelp: true });
    expect(op).toMatchObject({
      name: 'return_result',
      kind: 'action',
      extends_input_schema: true,
      extends_output_schema: true,
      depends_on: { keyword: 'trigger', provider: 'workato_recipe_function' },
    });
  });

  it('flattens help html into one line, and can omit it', () => {
    const withHelp = slimOperation('return_result', 'action', raw, {
      detail: false,
      includeHelp: true,
    });
    expect(withHelp.help).toBe('Return data to the parent recipe.');
    expect(withHelp.help).not.toContain('<br>');

    const without = slimOperation('return_result', 'action', raw, {
      detail: false,
      includeHelp: false,
    });
    expect(without.help).toBeUndefined();
  });

  it('index mode reports field counts instead of the field lists', () => {
    const trigger = RECIPE_FUNCTION_META.workato_recipe_function.triggers.execute;
    const op = slimOperation('execute', 'trigger', trigger, { detail: false, includeHelp: false });
    expect(op.input).toBeUndefined();
    expect(op.input_count).toBe(2);
    expect(op.output_count).toBe(1);
  });

  it('carries extends_schema through on a field — the schema-designer marker', () => {
    const trigger = RECIPE_FUNCTION_META.workato_recipe_function.triggers.execute;
    const op = slimOperation('execute', 'trigger', trigger, { detail: true, includeHelp: false });
    expect(op.input?.[0]).toMatchObject({
      name: 'parameters_schema_json',
      control_type: 'schema-designer',
      extends_schema: true,
    });
  });
});

describe('buildAdapterView', () => {
  it('index mode lists names and titles only, with a hint on how to narrow', () => {
    const view = buildAdapterView('workato_recipe_function', RECIPE_FUNCTION_META, {
      includeHelp: false,
    });
    expect(view.mode).toBe('index');
    expect(view.triggers?.map((t) => t.name)).toEqual(['execute']);
    expect(view.actions?.map((a) => a.name)).toEqual([
      'return_result',
      'call_recipe',
      'call_recipe_async',
    ]);
    expect(view.actions?.every((a) => a.input === undefined)).toBe(true);
    expect(view.hint).toMatch(/operation:/);
  });

  it('detail mode returns just the named operation, in full', () => {
    const view = buildAdapterView('workato_recipe_function', RECIPE_FUNCTION_META, {
      operation: 'call_recipe',
      includeHelp: true,
    });
    expect(view.mode).toBe('detail');
    expect(view.triggers).toEqual([]);
    expect(view.actions).toHaveLength(1);
    expect(view.actions?.[0].input?.[0].name).toBe('flow_id');
    expect(view.actions?.[0].output?.map((f) => f.name)).toEqual(['job_id', 'job_url']);
  });

  it('operation match is case-insensitive but not a substring match', () => {
    const exact = buildAdapterView('workato_recipe_function', RECIPE_FUNCTION_META, {
      operation: 'CALL_RECIPE',
      includeHelp: false,
    });
    expect(exact.actions?.map((a) => a.name)).toEqual(['call_recipe']);
  });

  it('grep mode returns only operations with a matching field, carrying only those fields', () => {
    const view = buildAdapterView('workato_recipe_function', RECIPE_FUNCTION_META, {
      fieldGrep: 'schema',
      includeHelp: false,
    });
    expect(view.mode).toBe('grep');
    // This is the lookup that answered "what is the result schema key called?".
    expect(view.triggers?.[0].input?.map((f) => f.name)).toEqual([
      'parameters_schema_json',
      'result_schema_json',
    ]);
    // return_result has no fields at all, so it is dropped rather than listed empty.
    expect(view.actions?.map((a) => a.name)).not.toContain('return_result');
  });

  it('marks a missing adapter as not found instead of inventing an empty one', () => {
    const view = buildAdapterView('netsuite', { nothing: true }, { includeHelp: false });
    expect(view.found).toBe(false);
  });

  it('flags a deprecated operation', () => {
    const view = buildAdapterView('workato_recipe_function', RECIPE_FUNCTION_META, {
      operation: 'call_recipe_async',
      includeHelp: false,
    });
    expect(view.actions?.[0].deprecated).toBe(true);
  });
});
