import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { handleWorkatoRecipeApplyCall } from './workato-recipe-apply';
import { handleWorkatoRecipeMutatorCall } from './workato-recipe-mutators';
import {
  buildValidationReport,
  checkBindings,
  checkDatapillReferences,
  checkSchemas,
  collectDatapillReferences,
  handleWorkatoRecipeValidateCall,
  isRecipeValidateTool,
  loadRecipeTreeFromFile,
} from './workato-recipe-validate';

/**
 * A small, healthy recipe: a clock trigger, a declare_list with both schemas,
 * and a logger reading the list. Every test starts from this and breaks one
 * thing, so a finding always has exactly one cause.
 */
const cleanCode = (): any => ({
  number: 0,
  keyword: 'trigger',
  provider: 'clock',
  name: 'scheduled_event',
  as: 'aaaaaaaa',
  uuid: '11111111-1111-4111-8111-111111111111',
  input: { time_unit: 'minutes', trigger_every: '5' },
  extended_input_schema: [
    {
      name: 'trigger_every',
      type: 'string',
      control_type: 'select',
      label: 'Trigger every',
      optional: false,
      options: [['5', '5']],
    },
  ],
  block: [
    {
      number: 1,
      keyword: 'action',
      provider: 'workato_variable',
      name: 'declare_list',
      as: '641f89e1',
      uuid: '22222222-2222-4222-8222-222222222222',
      input: {
        name: 'Items',
        list_item_schema_json:
          '[{"name":"value","type":"string","optional":false,"control_type":"text","label":"Value"}]',
        list_items: [{ value: 'apple' }],
      },
      extended_input_schema: [
        {
          label: 'Items',
          name: 'list_items',
          type: 'array',
          of: 'object',
          optional: true,
          properties: [
            {
              control_type: 'text',
              label: 'Value',
              name: 'value',
              optional: false,
              type: 'string',
            },
          ],
        },
      ],
      extended_output_schema: [
        {
          label: 'Items',
          name: 'list_items',
          type: 'array',
          of: 'object',
          optional: false,
          properties: [
            {
              control_type: 'text',
              label: 'Value',
              name: 'value',
              optional: false,
              type: 'string',
            },
          ],
        },
      ],
    },
    {
      number: 2,
      keyword: 'action',
      provider: 'logger',
      name: 'log_message',
      as: 'bbbbbbbb',
      uuid: '33333333-3333-4333-8333-333333333333',
      input: {
        message:
          '#{_dp(\'{"pill_type":"output","provider":"workato_variable","line":"641f89e1","path":["list_items"]}\')}',
      },
    },
  ],
});

const cleanConfig = () => [
  { keyword: 'application', name: 'clock', provider: 'clock', skip_validation: false },
  {
    keyword: 'application',
    name: 'workato_variable',
    provider: 'workato_variable',
    skip_validation: false,
  },
  { keyword: 'application', name: 'logger', provider: 'logger', skip_validation: false },
];

const okText = (payload: unknown): CallToolResult => ({
  isError: false,
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

const jsonOf = (result: CallToolResult): any => {
  const text = (result.content?.[0] as { text: string }).text;
  return JSON.parse(text.split('\n').slice(1).join('\n'));
};

interface Recorded {
  name: string;
  args: Record<string, unknown>;
}

function makeCaller(options: { code?: () => any; config?: unknown; version_no?: number } = {}) {
  const calls: Recorded[] = [];
  const caller = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
    calls.push({ name, args });
    if (name === 'workato_pull_recipe') {
      return okText({
        recipe_id: args.recipe_id,
        code: options.code ? options.code() : cleanCode(),
        version: {
          version_no: options.version_no ?? 4,
          name: 'Validate fixture',
          config: JSON.stringify(options.config ?? cleanConfig()),
        },
      });
    }
    if (name === 'workato_ui_save_recipe_code') {
      return okText({
        recipe_id: args.recipe_id,
        version_no: (options.version_no ?? 4) + 1,
        code_errors: [],
      });
    }
    throw new Error(`unexpected tool ${name}`);
  };
  return { calls, caller };
}

describe('checkBindings', () => {
  test('passes a tree whose connection-backed providers are all bound', () => {
    const code = cleanCode();
    code.block.push({
      number: 3,
      keyword: 'action',
      provider: 'salesforce',
      name: 'create_object',
      as: 'cccccccc',
      uuid: '44444444-4444-4444-8444-444444444444',
      input: { sobject_name: 'Account' },
    });
    const config = [
      ...cleanConfig(),
      {
        keyword: 'application',
        name: 'salesforce',
        provider: 'salesforce',
        skip_validation: false,
        account_id: 19092754,
      },
    ];
    expect(checkBindings(code, config).filter((f) => f.severity === 'error')).toEqual([]);
  });

  test('a bound provider with no account_id is the start failure Workato hides', () => {
    const code = cleanCode();
    code.block.push({
      number: 3,
      keyword: 'action',
      provider: 'salesforce',
      name: 'create_object',
      as: 'cccccccc',
      uuid: '44444444-4444-4444-8444-444444444444',
      input: { sobject_name: 'Account' },
    });
    const config = [
      ...cleanConfig(),
      {
        keyword: 'application',
        name: 'salesforce',
        provider: 'salesforce',
        skip_validation: false,
      },
    ];
    const findings = checkBindings(code, config);
    const missing = findings.find((f) => f.code === 'account_id_missing');
    expect(missing?.severity).toBe('error');
    expect(missing?.message).toContain('salesforce');
    expect(missing?.message).toContain("account_id can't be blank");
  });

  test('a provider with no config entry at all is an error, a connectionless one is not', () => {
    const code = cleanCode();
    code.block.push({
      number: 3,
      keyword: 'action',
      provider: 'netsuite',
      name: 'add_record',
      as: 'cccccccc',
      uuid: '44444444-4444-4444-8444-444444444444',
      input: {},
    });
    const findings = checkBindings(code, cleanConfig());
    expect(findings.map((f) => f.code)).toContain('config_entry_missing');
    expect(findings.filter((f) => f.message.includes('logger'))).toEqual([]);
  });

  test('an absent or unparseable config is reported as unchecked, never as clean', () => {
    expect(checkBindings(cleanCode(), undefined)[0].code).toBe('config_absent');
    expect(checkBindings(cleanCode(), 'not json')[0].code).toBe('config_unparseable');
  });
});

describe('checkDatapillReferences', () => {
  test('a clean tree has no findings', () => {
    expect(checkDatapillReferences(cleanCode())).toEqual([]);
  });

  test('a pill pointing at an anchor that does not exist is reported with step and path', () => {
    const code = cleanCode();
    code.block[1].input.message =
      '#{_dp(\'{"pill_type":"output","provider":"workato_variable","line":"deadbeef","path":["list_items"]}\')}';
    const findings = checkDatapillReferences(code);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      code: 'broken_datapill',
      step: 'bbbbbbbb',
      step_number: 2,
      path: 'input.message',
    });
    expect(findings[0].message).toContain('deadbeef');
  });

  test('a pill reading a step that runs later is refused', () => {
    const code = cleanCode();
    code.block[0].input.list_items = [
      {
        value:
          '#{_dp(\'{"pill_type":"output","provider":"logger","line":"bbbbbbbb","path":["id"]}\')}',
      },
    ];
    const findings = checkDatapillReferences(code);
    expect(findings.map((f) => f.code)).toEqual(['datapill_not_upstream']);
  });

  test('the Variables `<uuid>:<as>` composite is checked too, and job_context pills are not', () => {
    const code = cleanCode();
    code.block.push({
      number: 3,
      keyword: 'action',
      provider: 'workato_variable',
      name: 'insert_to_list',
      as: 'cccccccc',
      uuid: '44444444-4444-4444-8444-444444444444',
      input: {
        name: 'fda41c1c-b715-4c30-8094-5974415c2b40:99999999',
        location: 'end',
        list_item: { value: '#{_dp(\'{"pill_type":"job_context","path":["job_id"]}\')}' },
      },
    });
    const findings = checkDatapillReferences(code);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('broken_variable_reference');
    expect(findings[0].path).toBe('input.name');
  });

  test('collectDatapillReferences records where each reference sits', () => {
    const references = collectDatapillReferences(cleanCode());
    expect(references).toEqual([
      expect.objectContaining({ step: 'bbbbbbbb', path: 'input.message', line: '641f89e1' }),
    ]);
  });
});

describe('checkSchemas', () => {
  test('a clean tree reports nothing', () => {
    expect(checkSchemas(cleanCode())).toEqual([]);
  });

  test('a declare_list with no extended schemas is reported for both', () => {
    const code = cleanCode();
    delete code.block[0].extended_input_schema;
    delete code.block[0].extended_output_schema;
    const findings = checkSchemas(code).filter((f) => f.code === 'missing_extended_schema');
    expect(findings.map((f) => f.path)).toEqual([
      'extended_input_schema',
      'extended_output_schema',
    ]);
    expect(findings[0].message).toContain('code_errors []');
  });

  test('a datapill target with no output schema of its own is reported', () => {
    const code = cleanCode();
    delete code.block[0].extended_output_schema;
    const findings = checkSchemas(code);
    const target = findings.find((f) => f.code === 'datapill_target_no_output_schema');
    expect(target?.step).toBe('641f89e1');
    expect(target?.message).toContain('Unknown data field');
  });

  test('a structured input with no matching extended_input_schema entry is flagged', () => {
    const code = cleanCode();
    code.block[1].input.payload = { nested: { a: 1 } };
    const findings = checkSchemas(code).filter((f) => f.code === 'structured_input_no_schema');
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('input.payload');
  });

  test('control-flow conditions are not mistaken for undeclared structured input', () => {
    const code = cleanCode();
    code.block.push({
      number: 3,
      keyword: 'if',
      uuid: '44444444-4444-4444-8444-444444444444',
      input: { type: 'compound', operand: 'and', conditions: [{ operand: 'blank' }] },
      block: [],
    });
    expect(checkSchemas(code).filter((f) => f.code === 'structured_input_no_schema')).toEqual([]);
  });
});

describe('buildValidationReport', () => {
  test('a clean tree is valid and reports what it does not cover', () => {
    const report = buildValidationReport({ code: cleanCode(), config: cleanConfig() });
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.coverage).toEqual({
      structure: true,
      bindings: true,
      datapills: true,
      schemas: true,
      formulas: false,
      runtime: false,
    });
    expect(report.derived_schemas).toEqual([]);
    expect(report.providers).toEqual(['clock', 'workato_variable', 'logger']);
  });

  test('a missing schema shows up as a preview of what auto_schema would derive', () => {
    const code = cleanCode();
    delete code.block[0].extended_input_schema;
    const report = buildValidationReport({ code, config: cleanConfig() });
    expect(report.derived_schemas).toEqual([
      expect.objectContaining({
        step: '641f89e1',
        kind: 'declare_list',
        schemas: ['extended_input_schema'],
        status: 'added',
      }),
    ]);
    // The preview never writes: the tree handed in is unchanged.
    expect(code.block[0].extended_input_schema).toBeUndefined();
  });

  test('a broken structure is an error, not a warning, because nothing is being saved', () => {
    const code = cleanCode();
    code.block[1].number = 9;
    const report = buildValidationReport({ code, config: cleanConfig() });
    expect(report.valid).toBe(false);
    expect(report.errors.some((error) => error.code === 'structure')).toBe(true);
  });
});

describe('workato_recipe_validate handler', () => {
  test('is routed and never calls the save tool', async () => {
    expect(isRecipeValidateTool('workato_recipe_validate')).toBe(true);
    const { calls, caller } = makeCaller();
    const result = await handleWorkatoRecipeMutatorCall(
      'workato_recipe_validate',
      { recipe_id: 77, tabId: 42 },
      caller,
    );
    expect(result.isError).toBe(false);
    expect(calls.map((call) => call.name)).toEqual(['workato_pull_recipe']);
    expect(calls[0].args).toMatchObject({ recipe_id: 77, view: 'full', tabId: 42 });

    const payload = jsonOf(result);
    expect(payload).toMatchObject({ valid: true, source: 'recipe', saved: false, version_no: 4 });
    expect(payload.note).toContain('no validate-without-save endpoint');
  });

  test('reports a missing account_id, a broken datapill and a missing output schema together', async () => {
    const broken = (): any => {
      const code = cleanCode();
      delete code.block[0].extended_output_schema;
      code.block[1].input.message =
        '#{_dp(\'{"pill_type":"output","provider":"workato_variable","line":"deadbeef","path":["list_items"]}\')}';
      code.block.push({
        number: 3,
        keyword: 'action',
        provider: 'salesforce',
        name: 'create_object',
        as: 'cccccccc',
        uuid: '44444444-4444-4444-8444-444444444444',
        input: { sobject_name: 'Account' },
      });
      return code;
    };
    const config = [
      ...cleanConfig(),
      {
        keyword: 'application',
        name: 'salesforce',
        provider: 'salesforce',
        skip_validation: false,
      },
    ];
    const { calls, caller } = makeCaller({ code: broken, config });

    const result = await handleWorkatoRecipeValidateCall(
      'workato_recipe_validate',
      { recipe_id: 77 },
      caller,
    );
    const payload = jsonOf(result);
    expect(payload.valid).toBe(false);
    expect(payload.errors.map((error: any) => error.code).sort()).toEqual([
      'account_id_missing',
      'broken_datapill',
    ]);
    expect(payload.warnings.map((warning: any) => warning.code)).toContain(
      'missing_extended_schema',
    );
    expect(calls.every((call) => call.name !== 'workato_ui_save_recipe_code')).toBe(true);
  });

  test('validates an inline tree without pulling anything', async () => {
    const { calls, caller } = makeCaller();
    const result = await handleWorkatoRecipeValidateCall(
      'workato_recipe_validate',
      { code: cleanCode(), config: cleanConfig() },
      caller,
    );
    expect(calls).toEqual([]);
    expect(jsonOf(result)).toMatchObject({ valid: true, source: 'inline' });
  });

  test('refuses with a usable message when no source is given', async () => {
    const { caller } = makeCaller();
    const result = await handleWorkatoRecipeValidateCall('workato_recipe_validate', {}, caller);
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as any).text).toContain('pass recipe_id');
  });
});

describe('workato_recipe_validate from a file', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrv-'));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('reads a pulled envelope and uses its config', async () => {
    const file = path.join(dir, 'recipe.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        recipe_id: 77,
        name: 'Validate fixture',
        version_no: 4,
        code: cleanCode(),
        config: cleanConfig(),
      }),
      'utf8',
    );
    const loaded = loadRecipeTreeFromFile(file);
    expect(loaded).toMatchObject({ kind: 'file', recipe_id: 77, version_no: 4 });

    const { calls, caller } = makeCaller();
    const result = await handleWorkatoRecipeValidateCall(
      'workato_recipe_validate',
      { code_path: file },
      caller,
    );
    expect(calls).toEqual([]);
    expect(jsonOf(result)).toMatchObject({ valid: true, source: 'file', recipe_id: 77 });
  });

  test('a file holding another recipe is refused before anything is read from Workato', async () => {
    const file = path.join(dir, 'other.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ recipe_id: 99, code: cleanCode(), config: cleanConfig() }),
      'utf8',
    );
    const { calls, caller } = makeCaller();
    const result = await handleWorkatoRecipeValidateCall(
      'workato_recipe_validate',
      { code_path: file, recipe_id: 77 },
      caller,
    );
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as any).text).toContain('recipe_id mismatch');
    expect(calls).toEqual([]);
  });
});

describe('auto_schema in the engine', () => {
  const undeclared = (): any => {
    const code = cleanCode();
    delete code.block[0].extended_input_schema;
    delete code.block[0].extended_output_schema;
    return code;
  };

  test('a declare_list with structured input and no schema gains one in the SAVED tree', async () => {
    const { calls, caller } = makeCaller({ code: undeclared });
    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 77,
        changes: [{ op: 'set_input', step: 'bbbbbbbb', path: 'message', value: 'hello' }],
      },
      caller,
    );
    expect(result.isError).toBe(false);

    const save = calls.find((call) => call.name === 'workato_ui_save_recipe_code');
    const savedList = (save?.args.code as any).block[0];
    expect(savedList.extended_input_schema[0].name).toBe('list_items');
    expect(savedList.extended_output_schema[0].properties[0].type).toBe('string');

    const payload = jsonOf(result);
    expect(payload.derived_schemas).toEqual([
      expect.objectContaining({ step: '641f89e1', kind: 'declare_list', status: 'added' }),
    ]);
    expect(payload.changed_paths).toContain('641f89e1:extended_input_schema');
  });

  test('auto_schema:false leaves the tree exactly as pulled', async () => {
    const { calls, caller } = makeCaller({ code: undeclared });
    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 77,
        auto_schema: false,
        changes: [{ op: 'set_input', step: 'bbbbbbbb', path: 'message', value: 'hello' }],
      },
      caller,
    );
    const save = calls.find((call) => call.name === 'workato_ui_save_recipe_code');
    expect((save?.args.code as any).block[0].extended_input_schema).toBeUndefined();
    expect(jsonOf(result).derived_schemas).toBeUndefined();
  });

  test('a schema that disagrees with the declaration is corrected and reported', async () => {
    const drifted = (): any => {
      const code = cleanCode();
      code.block[0].extended_output_schema[0].properties[0].type = 'integer';
      return code;
    };
    const { calls, caller } = makeCaller({ code: drifted });
    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 77,
        changes: [{ op: 'set_input', step: 'bbbbbbbb', path: 'message', value: 'hello' }],
      },
      caller,
    );
    const payload = jsonOf(result);
    expect(payload.derived_schemas[0]).toMatchObject({
      step: '641f89e1',
      status: 'corrected',
      schemas: ['extended_output_schema'],
    });
    expect(payload.derived_schemas[0].differences[0]).toContain('declared string');
    const save = calls.find((call) => call.name === 'workato_ui_save_recipe_code');
    expect((save?.args.code as any).block[0].extended_output_schema[0].properties[0].type).toBe(
      'string',
    );
  });

  test('a dry run previews the derivation without saving', async () => {
    const { calls, caller } = makeCaller({ code: undeclared });
    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 77,
        dry_run: true,
        changes: [{ op: 'set_input', step: 'bbbbbbbb', path: 'message', value: 'hello' }],
      },
      caller,
    );
    expect(calls.map((call) => call.name)).toEqual(['workato_pull_recipe']);
    expect(jsonOf(result).derived_schemas).toHaveLength(1);
  });

  test('the derive_schema op rewrites one step and names the evidence', async () => {
    const { calls, caller } = makeCaller();
    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      { recipe_id: 77, changes: [{ op: 'derive_schema', step: '641f89e1' }] },
      caller,
    );
    const payload = jsonOf(result);
    expect(payload.mutation).toMatchObject({
      kind: 'derive_schema',
      step_as: '641f89e1',
      detail: {
        derived_kind: 'declare_list',
        fields: ['list_items'],
        evidence: 'verified',
      },
    });
    expect(calls.map((call) => call.name)).toEqual([
      'workato_pull_recipe',
      'workato_ui_save_recipe_code',
    ]);
  });

  test('derive_schema refuses a step whose shape nothing declares, and saves nothing', async () => {
    const { calls, caller } = makeCaller();
    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      { recipe_id: 77, changes: [{ op: 'derive_schema', step: 'bbbbbbbb' }] },
      caller,
    );
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as any).text).toContain('no deterministic');
    expect(calls.map((call) => call.name)).toEqual(['workato_pull_recipe']);
  });
});
