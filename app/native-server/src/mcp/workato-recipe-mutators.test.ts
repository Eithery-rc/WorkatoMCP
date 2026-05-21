import { describe, expect, test } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  buildMutatorSummary,
  handleWorkatoRecipeMutatorCall,
  isWorkatoRecipeMutatorTool,
  mutateRecipeCode,
  parseInputPath,
  parseToolJson,
} from './workato-recipe-mutators';

const sampleCode = (): any => ({
  number: 0,
  keyword: 'trigger',
  provider: 'clock',
  name: 'scheduled_event',
  as: 'aabbccdd',
  input: {},
  block: [
    {
      number: 1,
      keyword: 'action',
      provider: 'py_eval',
      name: 'invoke_custom_py_code',
      as: '11111111',
      input: { code: 'old' },
    },
    {
      number: 2,
      keyword: 'action',
      provider: 'logger',
      name: 'log_message',
      as: '22222222',
      input: { message: 'hello', existing: { child: 'keep' }, scalar: 'stop' },
    },
  ],
});

const okText = (payload: unknown): CallToolResult => ({
  isError: false,
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

describe('parseInputPath', () => {
  test('parses dotted paths, numeric indexes, and array paths', () => {
    expect(parseInputPath('records.item.items[0].amount')).toEqual([
      'records',
      'item',
      'items',
      0,
      'amount',
    ]);
    expect(parseInputPath(['records', 'item', 'items', 1, 'amount'])).toEqual([
      'records',
      'item',
      'items',
      1,
      'amount',
    ]);
  });

  test('rejects empty and prototype-polluting paths', () => {
    expect(() => parseInputPath('records..amount')).toThrow(/empty path segment/i);
    expect(() => parseInputPath('records.__proto__.amount')).toThrow(/unsafe path segment/i);
    expect(() => parseInputPath('records[-1].amount')).toThrow(/invalid array index/i);
  });
});

describe('mutateRecipeCode', () => {
  test('sets a nested literal path and creates missing parent containers', () => {
    const code = sampleCode();

    const result = mutateRecipeCode(
      'workato_recipe_set_input_path',
      {
        recipe_id: 10,
        step: '22222222',
        path: 'records.item.items[0].amount',
        value: 12.5,
        value_kind: 'literal',
      },
      code,
    );

    expect(result).toMatchObject({
      kind: 'set_input_path',
      step_number: 2,
      step_as: '22222222',
      path: 'records.item.items[0].amount',
    });
    expect(code.block[1].input.records.item.items[0].amount).toBe(12.5);
  });

  test('refuses to create a child below a scalar parent', () => {
    expect(() =>
      mutateRecipeCode(
        'workato_recipe_set_input_path',
        {
          recipe_id: 10,
          step: 2,
          path: 'scalar.child',
          value: 'bad',
        },
        sampleCode(),
      ),
    ).toThrow(/non-container/i);
  });

  test('sets formula, interpolated string, and datapill values', () => {
    const code = sampleCode();

    mutateRecipeCode(
      'workato_recipe_set_input_path',
      {
        recipe_id: 10,
        step: 2,
        path: 'formula',
        value: '_dp("x").to_s',
        value_kind: 'formula',
      },
      code,
    );
    mutateRecipeCode(
      'workato_recipe_set_input_path',
      {
        recipe_id: 10,
        step: 2,
        path: 'templated',
        value:
          'Hello #{_dp(\'{"pill_type":"output","provider":"logger","line":"22222222","path":["message"]}\')}',
        value_kind: 'interpolated',
      },
      code,
    );
    mutateRecipeCode(
      'workato_recipe_set_input_path',
      {
        recipe_id: 10,
        step: 2,
        path: 'pill',
        value: {
          provider: 'py_eval',
          line: '11111111',
          path: ['output', 'rows', { path_element_type: 'current_item' }, 'amount'],
        },
        value_kind: 'datapill',
      },
      code,
    );

    expect(code.block[1].input.formula).toBe('=_dp("x").to_s');
    expect(code.block[1].input.templated).toContain('Hello #{_dp(');
    expect(code.block[1].input.pill).toBe(
      '#{_dp(\'{"pill_type":"output","provider":"py_eval","line":"11111111","path":["output","rows",{"path_element_type":"current_item"},"amount"]}\')}',
    );
  });

  test('builds a datapill from compact shorthand with loop markers', () => {
    const code = sampleCode();

    mutateRecipeCode(
      'workato_recipe_set_input_path',
      {
        recipe_id: 10,
        step: 2,
        path: 'from_shorthand',
        value: 'datapill(py_eval.11111111.output.rows[].amount)',
        value_kind: 'datapill',
      },
      code,
    );

    expect(code.block[1].input.from_shorthand).toBe(
      '#{_dp(\'{"pill_type":"output","provider":"py_eval","line":"11111111","path":["output","rows",{"path_element_type":"current_item"},"amount"]}\')}',
    );
  });

  test('deletes a leaf and prunes empty parent containers', () => {
    const code = sampleCode();
    code.block[1].input.records = { item: { amount: 5 } };

    const result = mutateRecipeCode(
      'workato_recipe_delete_input_path',
      {
        recipe_id: 10,
        step: 2,
        path: 'records.item.amount',
      },
      code,
    );

    expect(result).toMatchObject({ kind: 'delete_input_path', path: 'records.item.amount' });
    expect(code.block[1].input.records).toBeUndefined();
    expect(code.block[1].input.existing).toEqual({ child: 'keep' });
  });

  test('sets py_eval code and validates the target action by default', () => {
    const code = sampleCode();

    mutateRecipeCode(
      'workato_recipe_set_py_eval_code',
      {
        recipe_id: 10,
        step: 1,
        code: 'def main(input):\n    return {"ok": True}\n',
      },
      code,
    );

    expect(code.block[0].input.code).toBe('def main(input):\n    return {"ok": True}\n');
    expect(() =>
      mutateRecipeCode(
        'workato_recipe_set_py_eval_code',
        {
          recipe_id: 10,
          step: 2,
          code: 'print("bad")',
        },
        sampleCode(),
      ),
    ).toThrow(/not a py_eval invoke_custom_py_code step/i);
  });

  test('sets explicit extended schemas only', () => {
    const code = sampleCode();
    const schema = [{ name: 'records', type: 'object', properties: [] }];

    mutateRecipeCode(
      'workato_recipe_set_extended_schema',
      {
        recipe_id: 10,
        step: 2,
        kind: 'extended_input_schema',
        schema,
      },
      code,
    );

    expect(code.block[1].extended_input_schema).toEqual(schema);
    expect(() =>
      mutateRecipeCode(
        'workato_recipe_set_extended_schema',
        {
          recipe_id: 10,
          step: 2,
          kind: 'visible_config_fields',
          schema,
        },
        sampleCode(),
      ),
    ).toThrow(/kind must be/i);
  });
});

describe('native mutator orchestration helpers', () => {
  test('recognizes native recipe mutator tools', () => {
    expect(isWorkatoRecipeMutatorTool('workato_recipe_set_input_path')).toBe(true);
    expect(isWorkatoRecipeMutatorTool('workato_recipe_delete_input_path')).toBe(true);
    expect(isWorkatoRecipeMutatorTool('workato_recipe_set_py_eval_code')).toBe(true);
    expect(isWorkatoRecipeMutatorTool('workato_recipe_set_extended_schema')).toBe(true);
    expect(isWorkatoRecipeMutatorTool('workato_pull_recipe')).toBe(false);
  });

  test('parses JSON from the last line of a text tool response', () => {
    expect(
      parseToolJson({ isError: false, content: [{ type: 'text', text: 'saved\n{"ok":true}' }] }),
    ).toEqual({
      ok: true,
    });
  });

  test('formats a compact summary that preserves save code errors', () => {
    const summary = buildMutatorSummary('workato_recipe_set_input_path', {
      recipe_id: 10,
      version_no: 77,
      code_errors: [['Records', null, "can't be blank"]],
      mutation: { kind: 'set_input_path', step_number: 2, path: 'records.amount' },
    });

    expect(summary.isError).toBe(false);
    expect((summary.content[0] as { text: string }).text).toContain('1 validation error');
    expect(
      JSON.parse((summary.content[0] as { text: string }).text.split('\n').pop() ?? '{}'),
    ).toMatchObject({
      recipe_id: 10,
      version_no: 77,
      mutation: { path: 'records.amount' },
    });
  });

  test('pulls, mutates, and saves through the provided extension caller', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const caller = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
      calls.push({ name, args });
      if (name === 'workato_pull_recipe') {
        return okText({
          recipe_id: 10,
          code: sampleCode(),
          version: {
            version_no: 11,
            name: 'Recipe',
            config: JSON.stringify([{ provider: 'logger' }]),
          },
        });
      }
      if (name === 'workato_ui_save_recipe_code') {
        expect(args.recipe_id).toBe(10);
        expect(args.config).toEqual([{ provider: 'logger' }]);
        expect((args.code as any).block[1].input.message).toBe('changed');
        return okText({ recipe_id: 10, version_no: 12, code_errors: [] });
      }
      throw new Error(`unexpected tool ${name}`);
    };

    const result = await handleWorkatoRecipeMutatorCall(
      'workato_recipe_set_input_path',
      {
        recipe_id: 10,
        step: 2,
        path: 'message',
        value: 'changed',
      },
      caller,
    );

    expect(result.isError).toBe(false);
    expect(calls.map((call) => call.name)).toEqual([
      'workato_pull_recipe',
      'workato_ui_save_recipe_code',
    ]);
  });
});
