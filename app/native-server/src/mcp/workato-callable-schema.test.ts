import { describe, expect, test } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  applyCallableSchema,
  applyCallerBind,
  buildParametersNode,
  buildResultNode,
  buildSchemaJson,
  findCallRecipeStep,
  handleWorkatoCallableCall,
  humanizeName,
  isWorkatoCallableTool,
  NEUTRAL_VERSION_COMMENT,
  normalizeFieldList,
  normalizeSchemaField,
  readCalleeContract,
  repointPillsToResult,
  walkSteps,
} from './workato-callable-schema';

const pill = (line: string, path: unknown[]): string =>
  `#{_dp('${JSON.stringify({
    pill_type: 'output',
    provider: 'workato_recipe_function',
    line,
    path,
  })}')}`;

/** A callable recipe: recipe-function trigger + a return_result step. */
const callableCode = (): any => ({
  number: 0,
  keyword: 'trigger',
  provider: 'workato_recipe_function',
  name: 'execute',
  as: 'a1b2c3d4',
  input: {},
  block: [
    {
      number: 1,
      keyword: 'action',
      provider: 'py_eval',
      name: 'invoke_custom_py_code',
      as: '84767f5e',
      input: { code: 'x = 1' },
    },
    {
      number: 2,
      keyword: 'action',
      provider: 'workato_recipe_function',
      name: 'return_result',
      as: 'tjreturn',
      input: {},
    },
  ],
});

const okText = (payload: unknown): CallToolResult => ({
  isError: false,
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

describe('field normalization', () => {
  test('humanizeName matches the schema designer label style', () => {
    expect(humanizeName('je_count')).toBe('Je count');
    expect(humanizeName('unmapped_count')).toBe('Unmapped count');
    expect(humanizeName('totalHours')).toBe('Total hours');
  });

  test('fills control_type, label and optional from the name and type', () => {
    expect(normalizeSchemaField({ name: 'je_count', type: 'integer' })).toEqual({
      name: 'je_count',
      type: 'integer',
      control_type: 'number',
      label: 'Je count',
      optional: true,
    });
    expect(normalizeSchemaField({ name: 'status' })).toMatchObject({
      type: 'string',
      control_type: 'text',
    });
  });

  test('an array of objects gets of:"object" and recurses into properties', () => {
    const field = normalizeSchemaField({
      name: 'rows',
      type: 'array',
      properties: [{ name: 'status' }, { name: 'hours', type: 'number' }],
    });
    expect(field.of).toBe('object');
    expect(field.properties).toHaveLength(2);
    expect(field.properties?.[1]).toMatchObject({ name: 'hours', control_type: 'number' });
  });

  test('rejects an unusable schema rather than saving it', () => {
    expect(() => normalizeSchemaField({ type: 'string' })).toThrow(/non-empty string "name"/);
    expect(() => normalizeSchemaField({ name: 'x', type: 'object' })).toThrow(/no properties/);
    expect(() => normalizeFieldList([{ name: 'a' }, { name: 'a' }], 'results')).toThrow(
      /declares "a" twice/,
    );
    expect(() => normalizeFieldList('nope', 'results')).toThrow(/must be an array/);
  });

  test('respects explicit optional:false and a caller-supplied label', () => {
    expect(normalizeSchemaField({ name: 'x', label: 'Custom', optional: false })).toMatchObject({
      label: 'Custom',
      optional: false,
    });
  });
});

describe('artefact builders', () => {
  test('schema json is a compact string, and the wrappers are named correctly', () => {
    const fields = normalizeFieldList([{ name: 'je_count', type: 'integer' }], 'results');
    expect(buildSchemaJson(fields)).toBe(JSON.stringify(fields));
    expect(buildSchemaJson(fields)).not.toContain(', ');
    expect(buildParametersNode(fields)).toMatchObject({ name: 'parameters', type: 'object' });
    expect(buildResultNode(fields)).toMatchObject({
      name: 'result',
      type: 'object',
      optional: true,
    });
  });
});

describe('applyCallableSchema', () => {
  test('writes all four coupled artefacts', () => {
    const code = callableCode();
    const parameters = normalizeFieldList([{ name: 'RangeType' }], 'parameters');
    const results = normalizeFieldList(
      [
        { name: 'je_count', type: 'integer' },
        { name: 'rows', type: 'array', properties: [{ name: 'status' }] },
      ],
      'results',
    );
    const summary = applyCallableSchema(code, { parameters, results });

    // 1 + 3: the trigger.
    expect(JSON.parse(code.input.parameters_schema_json)).toEqual(parameters);
    expect(code.extended_output_schema[0]).toMatchObject({ name: 'parameters' });

    // 2: result_schema_json is the INNER list, not the wrapper node.
    const declared = JSON.parse(code.input.result_schema_json);
    expect(declared).toEqual(results);
    expect(declared[0].name).toBe('je_count');

    // 4: the return_result step.
    const ret = code.block[1];
    expect(ret.extended_input_schema[0]).toMatchObject({ name: 'result', type: 'object' });
    expect(ret.extended_input_schema[0].properties).toEqual(results);
    expect(Object.keys(ret.input)).toEqual(['result']);
    expect(ret.visible_config_fields).toEqual(['result.je_count', 'result.rows']);

    expect(summary).toMatchObject({
      kind: 'callable_schema_set',
      trigger_as: 'a1b2c3d4',
      return_result_as: 'tjreturn',
      unmapped: ['je_count', 'rows'],
    });
  });

  test('migrates values from the flat pre-fix shape instead of dropping them', () => {
    const code = callableCode();
    // The `result: null` bug: values written flat on input, no wrapper.
    code.block[1].input = { je_count: '5', rows: pill('84767f5e', ['output', 'rows']) };

    const results = normalizeFieldList(
      [
        { name: 'je_count', type: 'integer' },
        { name: 'rows', type: 'array', properties: [{ name: 'status' }] },
      ],
      'results',
    );
    const summary = applyCallableSchema(code, { results });

    expect(code.block[1].input).toEqual({
      result: { je_count: '5', rows: pill('84767f5e', ['output', 'rows']) },
    });
    expect(summary.migrated_from_flat).toEqual(['je_count', 'rows']);
    expect(summary.unmapped).toBeUndefined();
  });

  test('preserves mappings already under result, and reports newly unmapped fields', () => {
    const code = callableCode();
    code.block[1].input = { result: { je_count: '5' } };
    const results = normalizeFieldList(
      [
        { name: 'je_count', type: 'integer' },
        { name: 'total_hours', type: 'number' },
      ],
      'results',
    );
    const summary = applyCallableSchema(code, { results });

    expect(code.block[1].input.result).toEqual({ je_count: '5' });
    expect(summary.preserved_mappings).toEqual(['je_count']);
    expect(summary.unmapped).toEqual(['total_hours']);
  });

  test('parameters-only leaves the result side untouched', () => {
    const code = callableCode();
    code.block[1].input = { result: { je_count: '5' } };
    applyCallableSchema(code, {
      parameters: normalizeFieldList([{ name: 'RangeType' }], 'parameters'),
    });
    expect(code.input.result_schema_json).toBeUndefined();
    expect(code.block[1].input).toEqual({ result: { je_count: '5' } });
  });

  test('refuses a non-callable recipe and a missing/ambiguous return_result', () => {
    const notCallable = callableCode();
    notCallable.provider = 'clock';
    expect(() => applyCallableSchema(notCallable, { parameters: [] })).toThrow(
      /not "workato_recipe_function"/,
    );

    const noReturn = callableCode();
    noReturn.block = [noReturn.block[0]];
    expect(() =>
      applyCallableSchema(noReturn, { results: normalizeFieldList([{ name: 'x' }], 'results') }),
    ).toThrow(/no `return_result` step/);

    const twoReturns = callableCode();
    twoReturns.block.push({ ...twoReturns.block[1], as: 'second00' });
    expect(() =>
      applyCallableSchema(twoReturns, { results: normalizeFieldList([{ name: 'x' }], 'results') }),
    ).toThrow(/2 `return_result` steps/);
  });
});

describe('repointPillsToResult', () => {
  test('prepends result to pills reading the bound step, and leaves others alone', () => {
    const tree = {
      a: pill('tjcall01', ['rows']),
      b: pill('tjcall01', ['job_id']), // not a result field — untouched
      c: pill('otherstp', ['rows']), // different step — untouched
      nested: [
        { d: pill('tjcall01', ['rows', { path_element_type: 'current_item' }, 'employee']) },
      ],
    };
    const { value, repointed } = repointPillsToResult(tree, 'tjcall01', ['rows', 'je_count']);
    const out = value as typeof tree;

    expect(repointed).toBe(2);
    expect(out.a).toBe(pill('tjcall01', ['result', 'rows']));
    expect(out.b).toBe(tree.b);
    expect(out.c).toBe(tree.c);
    expect(out.nested[0].d).toBe(
      pill('tjcall01', ['result', 'rows', { path_element_type: 'current_item' }, 'employee']),
    );
  });

  test('re-serializes compactly and leaves a non-JSON payload untouched', () => {
    const spaced = `#{_dp('{"pill_type": "output", "provider": "p", "line": "L", "path": ["rows"]}')}`;
    const { value } = repointPillsToResult({ v: spaced }, 'L', ['rows']);
    expect((value as any).v).toBe(
      `#{_dp('{"pill_type":"output","provider":"p","line":"L","path":["result","rows"]}')}`,
    );

    const broken = `#{_dp('{"line":"L","path":["rows"')}`;
    const untouched = repointPillsToResult({ v: broken }, 'L', ['rows']);
    expect((untouched.value as any).v).toBe(broken);
    expect(untouched.repointed).toBe(0);
  });
});

describe('caller binding', () => {
  const callerCode = (): any => ({
    number: 0,
    keyword: 'trigger',
    provider: 'workato_workflow_task',
    name: 'app_function_load_table_request',
    as: '5e0b9995',
    input: {},
    block: [
      {
        number: 1,
        keyword: 'action',
        provider: 'workato_recipe_function',
        name: 'call_recipe',
        as: 'tjcall01',
        input: { flow_id: '76902508', parameters: {} },
      },
      {
        number: 2,
        keyword: 'action',
        provider: 'workato_workflow_task',
        name: 'app_function_return',
        as: 'ret00001',
        input: { rows: { ____source: pill('tjcall01', ['rows']) } },
      },
    ],
  });

  test('walkSteps reaches nested steps exactly once', () => {
    const seen: string[] = [];
    walkSteps(callerCode(), (s) => seen.push(String(s.as)));
    expect(seen).toEqual(['5e0b9995', 'tjcall01', 'ret00001']);
  });

  test('writes both schemas and repoints the caller pills', () => {
    const code = callerCode();
    const step = findCallRecipeStep(code, { calleeId: '76902508' });
    const results = normalizeFieldList(
      [{ name: 'rows', type: 'array', properties: [{ name: 'status' }] }],
      'results',
    );
    const { code: next, summary } = applyCallerBind(code, {
      step,
      results,
      parameters: normalizeFieldList([{ name: 'RangeType' }], 'parameters'),
    });

    expect(step.extended_output_schema).toHaveLength(3);
    expect((step.extended_output_schema as any[])[0]).toMatchObject({ name: 'job_id' });
    expect((step.extended_output_schema as any[])[2]).toMatchObject({ name: 'result' });
    expect((step.extended_input_schema as any[])[0]).toMatchObject({ name: 'parameters' });
    expect(summary.pills_repointed).toBe(1);
    expect((next as any).block[1].input.rows.____source).toBe(pill('tjcall01', ['result', 'rows']));
  });

  test('findCallRecipeStep explains itself when the target is ambiguous', () => {
    const code = callerCode();
    code.block.push({ ...code.block[0], as: 'tjcall02' });
    expect(() => findCallRecipeStep(code, { calleeId: '76902508' })).toThrow(
      /2 call_recipe steps target recipe/,
    );
    expect(() => findCallRecipeStep(code, { calleeId: '999' })).toThrow(
      /no call_recipe step targets/,
    );
    expect(findCallRecipeStep(code, { stepRef: 'tjcall02' }).as).toBe('tjcall02');

    const none = callerCode();
    none.block = [none.block[1]];
    expect(() => findCallRecipeStep(none, {})).toThrow(/no `call_recipe` step/);
  });

  test('readCalleeContract refuses a callee with no declared result schema', () => {
    const code = callableCode();
    code.input.parameters_schema_json = JSON.stringify([{ name: 'RangeType', type: 'string' }]);
    expect(() => readCalleeContract(code)).toThrow(/declares no result_schema_json/);

    code.input.result_schema_json = JSON.stringify([{ name: 'rows', type: 'string' }]);
    const contract = readCalleeContract(code);
    expect(contract.results[0].name).toBe('rows');
    expect(contract.parameters[0].name).toBe('RangeType');

    code.input.result_schema_json = '{not json';
    expect(() => readCalleeContract(code)).toThrow(/not parseable JSON/);
  });
});

describe('handleWorkatoCallableCall', () => {
  const makeCaller = (recorded: Array<{ name: string; args: any }>) => {
    return async (name: string, args: any): Promise<CallToolResult> => {
      recorded.push({ name, args });
      if (name === 'workato_pull_recipe') {
        return okText({
          recipe_id: args.recipe_id,
          code: callableCode(),
          version: { version_no: 17, config: '[]' },
        });
      }
      if (name === 'workato_ui_save_recipe_code') {
        return okText({ recipe_id: args.recipe_id, version_no: 18, code_errors: [] });
      }
      return okText({});
    };
  };

  test('routes pull -> mutate -> save and defaults to a neutral version comment', async () => {
    const calls: Array<{ name: string; args: any }> = [];
    const result = await handleWorkatoCallableCall(
      'workato_callable_schema_set',
      { recipe_id: 76902508, results: [{ name: 'je_count', type: 'integer' }] },
      makeCaller(calls),
    );

    expect(result.isError).toBe(false);
    const save = calls.find((c) => c.name === 'workato_ui_save_recipe_code')!;
    expect(save.args.comment).toBe(NEUTRAL_VERSION_COMMENT);
    expect(save.args.expected_base_version_no).toBe(17);
    expect(save.args.code.input.result_schema_json).toContain('je_count');
    expect((result.content[0] as any).text).toContain('version 18');
  });

  test('a caller-supplied comment wins over the neutral default', async () => {
    const calls: Array<{ name: string; args: any }> = [];
    await handleWorkatoCallableCall(
      'workato_callable_schema_set',
      { recipe_id: 1, comment: 'config update', parameters: [{ name: 'A' }] },
      makeCaller(calls),
    );
    expect(calls.find((c) => c.name === 'workato_ui_save_recipe_code')!.args.comment).toBe(
      'config update',
    );
  });

  test('reports failures instead of throwing', async () => {
    const calls: Array<{ name: string; args: any }> = [];
    const noFields = await handleWorkatoCallableCall(
      'workato_callable_schema_set',
      { recipe_id: 1 },
      makeCaller(calls),
    );
    expect(noFields.isError).toBe(true);
    expect((noFields.content[0] as any).text).toMatch(/nothing to write/);

    const badId = await handleWorkatoCallableCall(
      'workato_callable_schema_set',
      {},
      makeCaller([]),
    );
    expect(badId.isError).toBe(true);
    expect((badId.content[0] as any).text).toMatch(/recipe_id must be a finite number/);

    const unknown = await handleWorkatoCallableCall('nope', { recipe_id: 1 }, makeCaller([]));
    expect(unknown.isError).toBe(true);
  });

  test('isWorkatoCallableTool recognises exactly the two tools', () => {
    expect(isWorkatoCallableTool('workato_callable_schema_set')).toBe(true);
    expect(isWorkatoCallableTool('workato_caller_bind')).toBe(true);
    expect(isWorkatoCallableTool('workato_pull_recipe')).toBe(false);
  });
});
