import { describe, expect, test } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  STEP_SCHEMA_TOOL,
  handleWorkatoStepSchemaApplyCall,
  isStepSchemaApplyCall,
} from './workato-step-schema';

const sampleCode = (): any => ({
  number: 0,
  keyword: 'trigger',
  provider: 'clock',
  name: 'scheduled_event',
  as: 'aabbccdd',
  uuid: '00000000-0000-4000-8000-000000000000',
  input: { time_unit: 'minutes', trigger_every: '5' },
  block: [
    {
      number: 1,
      keyword: 'action',
      provider: 'py_eval',
      name: 'invoke_custom_py_code',
      as: '11111111',
      uuid: '11111111-0000-4000-8000-000000000000',
      input: { code: 'print(1)' },
    },
    {
      number: 2,
      keyword: 'action',
      provider: 'logger',
      name: 'log_message',
      as: '22222222',
      uuid: '22222222-0000-4000-8000-000000000000',
      input: { message: 'hello' },
    },
  ],
});

const okText = (payload: unknown, headline?: string): CallToolResult => ({
  isError: false,
  content: [{ type: 'text', text: (headline ? `${headline}\n` : '') + JSON.stringify(payload) }],
});

/** What the extension tool answers for workato_variable/declare_list, trimmed. */
const GENERATED = {
  adapter: 'py_eval',
  operation: 'invoke_custom_py_code',
  input_schema: [{ name: 'code', type: 'string' }],
  output_schema: [
    { name: 'result', type: 'object', properties: [{ name: 'total', type: 'number' }] },
  ],
  input_count: 1,
  output_count: 1,
  apply_ops: [],
};

function fakeExtension(options: {
  generated?: CallToolResult;
  calls: { name: string; args: Record<string, unknown> }[];
}) {
  return async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
    options.calls.push({ name, args });
    if (name === STEP_SCHEMA_TOOL) return options.generated ?? okText(GENERATED);
    if (name === 'workato_pull_recipe') {
      return okText({
        recipe_id: 10,
        code: sampleCode(),
        version: {
          version_no: 11,
          name: 'Recipe',
          config: JSON.stringify([
            { keyword: 'application', provider: 'clock', name: 'clock' },
            { keyword: 'application', provider: 'py_eval', name: 'py_eval' },
            { keyword: 'application', provider: 'logger', name: 'logger' },
          ]),
        },
      });
    }
    if (name === 'workato_ui_save_recipe_code') {
      return okText({ recipe_id: 10, version_no: 12, code_errors: [] });
    }
    throw new Error(`unexpected tool ${name}`);
  };
}

describe('isStepSchemaApplyCall', () => {
  test('routes natively only when apply_to is an object', () => {
    expect(isStepSchemaApplyCall(STEP_SCHEMA_TOOL, { apply_to: { recipe_id: 1, step: 1 } })).toBe(
      true,
    );
    expect(isStepSchemaApplyCall(STEP_SCHEMA_TOOL, { adapter: 'clock' })).toBe(false);
    expect(isStepSchemaApplyCall(STEP_SCHEMA_TOOL, { apply_to: 'yes' })).toBe(false);
    expect(isStepSchemaApplyCall('workato_pick_list', { apply_to: { recipe_id: 1 } })).toBe(false);
  });
});

describe('handleWorkatoStepSchemaApplyCall', () => {
  test('refuses a malformed apply_to before calling anything', async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const noRecipe = await handleWorkatoStepSchemaApplyCall(
      STEP_SCHEMA_TOOL,
      { adapter: 'py_eval', operation: 'x', apply_to: { step: 1 } },
      fakeExtension({ calls }),
    );
    expect(noRecipe.isError).toBe(true);
    expect((noRecipe.content[0] as any).text).toMatch(/apply_to\.recipe_id/);

    const noStep = await handleWorkatoStepSchemaApplyCall(
      STEP_SCHEMA_TOOL,
      { adapter: 'py_eval', operation: 'x', apply_to: { recipe_id: 10, step: '  ' } },
      fakeExtension({ calls }),
    );
    expect(noStep.isError).toBe(true);
    expect((noStep.content[0] as any).text).toMatch(/apply_to\.step/);
    expect(calls).toEqual([]);
  });

  test('generates without apply_to, then writes both schemas onto the step in one save', async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const result = await handleWorkatoStepSchemaApplyCall(
      STEP_SCHEMA_TOOL,
      {
        adapter: 'py_eval',
        operation: 'invoke_custom_py_code',
        input: { code: 'print(1)' },
        tabId: 42,
        apply_to: {
          recipe_id: 10,
          step: '11111111',
          comment: 'schema refresh',
          verify_readback: false,
        },
      },
      fakeExtension({ calls }),
    );

    expect(result.isError).toBe(false);
    expect(calls.map((c) => c.name)).toEqual([
      STEP_SCHEMA_TOOL,
      'workato_pull_recipe',
      'workato_ui_save_recipe_code',
    ]);
    // The extension never sees apply_to; the generation call is otherwise the caller's.
    expect(calls[0].args).toEqual({
      adapter: 'py_eval',
      operation: 'invoke_custom_py_code',
      input: { code: 'print(1)' },
      tabId: 42,
    });
    // Both arrays land on the target step, in one save, with the modifiers forwarded.
    const savedStep = (calls[2].args.code as any).block[0];
    expect(savedStep.as).toBe('11111111');
    expect(savedStep.extended_input_schema).toEqual(GENERATED.input_schema);
    expect(savedStep.extended_output_schema).toEqual(GENERATED.output_schema);
    expect(calls[2].args).toMatchObject({ comment: 'schema refresh', verify_readback: false });
    // The untouched step is intact.
    expect((calls[2].args.code as any).block[1].extended_output_schema).toBeUndefined();

    const text = (result.content[0] as any).text as string;
    const payload = JSON.parse(text.split('\n').pop() as string);
    expect(payload.input_schema).toEqual(GENERATED.input_schema);
    expect(payload.applied).toMatchObject({ version_no: 12 });
    expect(payload.applied.changed_paths).toEqual(
      expect.arrayContaining([
        expect.stringContaining('extended_input_schema'),
        expect.stringContaining('extended_output_schema'),
      ]),
    );
  });

  test('dry_run pulls but never saves', async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const result = await handleWorkatoStepSchemaApplyCall(
      STEP_SCHEMA_TOOL,
      {
        adapter: 'py_eval',
        operation: 'invoke_custom_py_code',
        apply_to: { recipe_id: 10, step: 1, dry_run: true },
      },
      fakeExtension({ calls }),
    );
    expect(result.isError).toBe(false);
    expect(calls.map((c) => c.name)).toEqual([STEP_SCHEMA_TOOL, 'workato_pull_recipe']);
    const payload = JSON.parse(
      ((result.content[0] as any).text as string).split('\n').pop() as string,
    );
    expect(payload.applied).toMatchObject({ dry_run: true });
  });

  test('does not write when both generated schemas are empty', async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const result = await handleWorkatoStepSchemaApplyCall(
      STEP_SCHEMA_TOOL,
      { adapter: 'salesforce', operation: 'search_sobjects', apply_to: { recipe_id: 10, step: 2 } },
      fakeExtension({
        calls,
        generated: okText({
          ...GENERATED,
          input_schema: [],
          output_schema: [],
          note: 'Both schemas came back empty. This operation derives its schema from ["sobject_name"]',
        }),
      }),
    );
    expect(result.isError).toBe(false);
    // No pull, no save: nothing to write.
    expect(calls.map((c) => c.name)).toEqual([STEP_SCHEMA_TOOL]);
    const text = (result.content[0] as any).text as string;
    expect(text).toMatch(/NOT applied/);
    const payload = JSON.parse(text.split('\n').pop() as string);
    expect(payload.applied).toBe(false);
    expect(payload.apply_skipped).toMatch(/sobject_name/);
  });

  test('passes a generation failure through untouched', async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const failure: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'workato_step_schema (fetch): HTTP status code 420' }],
    };
    const result = await handleWorkatoStepSchemaApplyCall(
      STEP_SCHEMA_TOOL,
      { adapter: 'salesforce', operation: 'search_sobjects', apply_to: { recipe_id: 10, step: 2 } },
      fakeExtension({ calls, generated: failure }),
    );
    expect(result).toBe(failure);
    expect(calls).toHaveLength(1);
  });

  test('reports a write failure while keeping the generated schemas in the payload', async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const result = await handleWorkatoStepSchemaApplyCall(
      STEP_SCHEMA_TOOL,
      {
        adapter: 'py_eval',
        operation: 'invoke_custom_py_code',
        apply_to: { recipe_id: 10, step: 'nope' },
      },
      fakeExtension({ calls }),
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text as string;
    expect(text).toMatch(/schemas generated but the write to recipe 10 failed/);
    const payload = JSON.parse(text.split('\n').pop() as string);
    expect(payload.output_schema).toEqual(GENERATED.output_schema);
    expect(payload.applied).toBe(false);
    expect(calls.map((c) => c.name)).toEqual([STEP_SCHEMA_TOOL, 'workato_pull_recipe']);
  });
});
