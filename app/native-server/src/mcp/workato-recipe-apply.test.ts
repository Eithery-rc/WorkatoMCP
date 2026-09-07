import { beforeEach, describe, expect, test } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { clearIdempotencyStore, handleWorkatoRecipeApplyCall } from './workato-recipe-apply';
import { indexSteps, mergeRecipeConfig, validateRecipeTree } from './workato-recipe-engine';

/**
 * The audit reproduction: two connection-bound providers in the config, and a
 * foreach whose block holds an if whose block holds the netsuite action. The
 * legacy add_step rebuilt the config (losing both account_ids) and renumbered
 * only the top-level block (colliding with the nested numbers).
 */
const auditCode = (): any => ({
  number: 0,
  keyword: 'trigger',
  provider: 'salesforce',
  name: 'new_object',
  as: 'aaaaaaaa',
  uuid: '11111111-1111-4111-8111-111111111111',
  input: { sobject_name: 'Account' },
  block: [
    {
      number: 1,
      keyword: 'action',
      provider: 'logger',
      name: 'log_message',
      as: 'bbbbbbbb',
      uuid: '22222222-2222-4222-8222-222222222222',
      input: {
        message:
          '#{_dp(\'{"pill_type":"output","provider":"netsuite","line":"dddddddd","path":["id"]}\')}',
      },
    },
    {
      number: 2,
      keyword: 'foreach',
      as: 'cccccccc',
      uuid: '33333333-3333-4333-8333-333333333333',
      source:
        '#{_dp(\'{"pill_type":"output","provider":"salesforce","line":"aaaaaaaa","path":["records"]}\')}',
      repeat_mode: 'simple',
      clear_scope: 'false',
      input: {},
      block: [
        {
          number: 3,
          keyword: 'if',
          uuid: '44444444-4444-4444-8444-444444444444',
          input: { type: 'compound', operand: 'and', conditions: [] },
          block: [
            {
              number: 4,
              keyword: 'action',
              provider: 'netsuite',
              name: 'add_record',
              as: 'dddddddd',
              uuid: '55555555-5555-4555-8555-555555555555',
              input: { record_type: 'customer' },
            },
          ],
        },
      ],
    },
  ],
});

const auditConfig = () => [
  {
    keyword: 'application',
    name: 'salesforce',
    provider: 'salesforce',
    skip_validation: false,
    account_id: 19092754,
  },
  {
    keyword: 'application',
    name: 'netsuite',
    provider: 'netsuite',
    skip_validation: true,
    account_id: 19308605,
  },
  { keyword: 'application', name: 'logger', provider: 'logger', skip_validation: false },
];

const okText = (payload: unknown): CallToolResult => ({
  isError: false,
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

interface Recorded {
  name: string;
  args: Record<string, unknown>;
}

/** A fake extension: records every call, answers the pull and the save. */
function makeCaller(options: { version_no?: number; code?: any; config?: unknown } = {}) {
  const calls: Recorded[] = [];
  const caller = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
    calls.push({ name, args });
    if (name === 'workato_pull_recipe') {
      return okText({
        recipe_id: args.recipe_id,
        code: options.code ? options.code() : auditCode(),
        version: {
          version_no: options.version_no ?? 7,
          name: 'Audit recipe',
          config: JSON.stringify(options.config ?? auditConfig()),
        },
      });
    }
    if (name === 'workato_ui_save_recipe_code') {
      return okText({
        recipe_id: args.recipe_id,
        version_no: (options.version_no ?? 7) + 1,
        code_errors: [],
        persisted: true,
        valid: true,
        verified: true,
      });
    }
    throw new Error(`unexpected tool ${name}`);
  };
  return { calls, caller };
}

const jsonOf = (result: CallToolResult): any => {
  const text = (result.content?.[0] as { text: string }).text;
  return JSON.parse(text.split('\n').slice(1).join('\n'));
};

const savedCall = (calls: Recorded[]): Recorded | undefined =>
  calls.find((call) => call.name === 'workato_ui_save_recipe_code');

beforeEach(() => {
  clearIdempotencyStore();
});

describe('workato_recipe_apply structural insertion', () => {
  test('the audit reproduction: add_step after_step 0 keeps both account_ids and renumbers the whole tree', async () => {
    const { calls, caller } = makeCaller();

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_add_step',
      {
        recipe_id: 10,
        after_step: 0,
        provider: 'logger',
        action_name: 'log_message',
        input: { message: 'inserted' },
      },
      caller,
    );

    expect(result.isError).toBe(false);
    const save = savedCall(calls);
    expect(save).toBeDefined();

    // Config is merged, never rebuilt: both bindings survive, including the
    // skip_validation:true the legacy path also reset.
    expect(save?.args.config).toEqual(auditConfig());

    const code = save?.args.code as any;
    const steps = indexSteps(code);
    expect(steps.map((entry) => entry.step.number)).toEqual([0, 1, 2, 3, 4, 5]);

    // The new step is the first action after the trigger.
    const inserted = code.block[0];
    expect(inserted.provider).toBe('logger');
    expect(inserted.name).toBe('log_message');
    expect(inserted.input).toEqual({ message: 'inserted' });
    expect(inserted.as).toMatch(/^[0-9a-f]{8}$/);
    expect(inserted.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted.number).toBe(1);

    // The nested steps moved down with the rest of the tree.
    expect(code.block[2].keyword).toBe('foreach');
    expect(code.block[2].number).toBe(3);
    expect(code.block[2].block[0].number).toBe(4);
    expect(code.block[2].block[0].block[0].number).toBe(5);

    expect(validateRecipeTree(code).errors).toEqual([]);
    expect(jsonOf(result)).toMatchObject({ persisted: true, valid: true, version_no: 8 });
  });

  test('inserts into a foreach block through an anchor', async () => {
    const { calls, caller } = makeCaller();

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 10,
        changes: [
          {
            op: 'insert_step',
            keyword: 'action',
            provider: 'logger',
            action_name: 'log_message',
            input: { message: 'inside the loop' },
            anchor: { mode: 'into', step: 'cccccccc', position: 'last' },
          },
        ],
      },
      caller,
    );

    expect(result.isError).toBe(false);
    const code = savedCall(calls)?.args.code as any;
    const loop = code.block[1];
    expect(loop.keyword).toBe('foreach');
    expect(loop.block).toHaveLength(2);
    expect(loop.block[1].input).toEqual({ message: 'inside the loop' });
    expect(indexSteps(code).map((entry) => entry.step.number)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('a provider new to the recipe gets a config entry, bound when connection_id is given', async () => {
    const { calls, caller } = makeCaller();

    await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 10,
        changes: [
          {
            op: 'insert_step',
            provider: 'jira',
            action_name: 'create_issue',
            connection_id: 42,
            anchor: { mode: 'after', step: 'bbbbbbbb' },
          },
        ],
      },
      caller,
    );

    const config = savedCall(calls)?.args.config as any[];
    expect(config).toHaveLength(4);
    expect(config[3]).toEqual({
      keyword: 'application',
      name: 'jira',
      provider: 'jira',
      skip_validation: false,
      account_id: 42,
    });
    expect(config[0]).toMatchObject({ provider: 'salesforce', account_id: 19092754 });
  });

  test('an unbound new provider is reported as connection_binding: missing', async () => {
    const { calls, caller } = makeCaller();

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 10,
        changes: [
          {
            op: 'insert_step',
            provider: 'jira',
            action_name: 'create_issue',
            anchor: { mode: 'after', step: 'bbbbbbbb' },
          },
        ],
      },
      caller,
    );

    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain('connection_binding: missing');
    expect(jsonOf(result).config).toMatchObject({
      connection_binding: 'missing',
      unbound_providers: ['jira'],
    });
    expect(savedCall(calls)).toBeDefined();
  });
});

describe('workato_recipe_apply batching and refusals', () => {
  test('three set_input changes are one pull and one save', async () => {
    const { calls, caller } = makeCaller();

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 10,
        changes: [
          { op: 'set_input', step: 'bbbbbbbb', path: 'message', value: 'one' },
          { op: 'set_input', step: 'dddddddd', path: 'record_type', value: 'vendor' },
          { op: 'set_input', step: 'dddddddd', path: 'fields[0].id', value: 'entityid' },
        ],
      },
      caller,
    );

    expect(calls.map((call) => call.name)).toEqual([
      'workato_pull_recipe',
      'workato_ui_save_recipe_code',
    ]);
    const code = savedCall(calls)?.args.code as any;
    expect(code.block[0].input.message).toBe('one');
    const netsuite = code.block[1].block[0].block[0];
    expect(netsuite.input.record_type).toBe('vendor');
    expect(netsuite.input.fields[0].id).toBe('entityid');
    expect(jsonOf(result).changed_paths).toEqual([
      'bbbbbbbb:input.message',
      'dddddddd:input.record_type',
      'dddddddd:input.fields[0].id',
    ]);
  });

  test('an invalid operation refuses the whole batch before the save', async () => {
    const { calls, caller } = makeCaller();

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 10,
        changes: [
          { op: 'set_input', step: 'bbbbbbbb', path: 'message', value: 'one' },
          { op: 'set_input', step: 999, path: 'message', value: 'two' },
        ],
      },
      caller,
    );

    expect(result.isError).toBe(true);
    expect(calls.map((call) => call.name)).toEqual(['workato_pull_recipe']);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain('change[1]');
    expect(text).toContain('step 999 not found');
    expect(JSON.parse(text.split('\n').pop() ?? '{}')).toMatchObject({
      ok: false,
      stage: 'apply',
      op_index: 1,
    });
  });

  test('an empty changes array is refused without touching the recipe', async () => {
    const { calls, caller } = makeCaller();
    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      { recipe_id: 10, changes: [] },
      caller,
    );
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test('more than 50 changes are refused', async () => {
    const { calls, caller } = makeCaller();
    const changes = Array.from({ length: 51 }, () => ({
      op: 'set_input',
      step: 'bbbbbbbb',
      path: 'message',
      value: 'x',
    }));
    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      { recipe_id: 10, changes },
      caller,
    );
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text: string }).text).toContain('the cap is 50');
    expect(calls.map((call) => call.name)).toEqual(['workato_pull_recipe']);
  });

  test('a stale expected_base_version_no is refused before the save', async () => {
    const { calls, caller } = makeCaller({ version_no: 9 });

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 10,
        expected_base_version_no: 7,
        changes: [{ op: 'set_input', step: 'bbbbbbbb', path: 'message', value: 'one' }],
      },
      caller,
    );

    expect(result.isError).toBe(true);
    expect(calls.map((call) => call.name)).toEqual(['workato_pull_recipe']);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain('is at version 9');
    expect(JSON.parse(text.split('\n').pop() ?? '{}')).toMatchObject({
      stage: 'version_lock',
      current_version_no: 9,
    });
  });

  test('dry_run validates and reports without saving', async () => {
    const { calls, caller } = makeCaller();

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 10,
        dry_run: true,
        changes: [{ op: 'set_input', step: 'bbbbbbbb', path: 'message', value: 'one' }],
      },
      caller,
    );

    expect(result.isError).toBe(false);
    expect(calls.map((call) => call.name)).toEqual(['workato_pull_recipe']);
    const payload = jsonOf(result);
    expect(payload).toMatchObject({
      dry_run: true,
      would_save_version: 8,
      persisted: false,
      verified: false,
      changed_paths: ['bbbbbbbb:input.message'],
    });
    expect((result.content?.[0] as { text: string }).text).toContain('nothing saved');
  });

  test('remove_step is refused while another step reads its datapill, and allowed with force', async () => {
    const refused = makeCaller();
    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      { recipe_id: 10, changes: [{ op: 'remove_step', step: 'dddddddd' }] },
      refused.caller,
    );

    expect(result.isError).toBe(true);
    expect(refused.calls.map((call) => call.name)).toEqual(['workato_pull_recipe']);
    expect((result.content?.[0] as { text: string }).text).toContain('referenced by 1 datapill');

    const forced = makeCaller();
    const ok = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      { recipe_id: 10, changes: [{ op: 'remove_step', step: 'dddddddd', force: true }] },
      forced.caller,
    );

    expect(ok.isError).toBe(false);
    const code = savedCall(forced.calls)?.args.code as any;
    expect(code.block[1].block[0].block).toHaveLength(0);
    expect(indexSteps(code).map((entry) => entry.step.number)).toEqual([0, 1, 2, 3]);
  });

  test('move_step relocates a subtree and renumbers', async () => {
    const { calls, caller } = makeCaller();

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 10,
        changes: [
          {
            op: 'move_step',
            step: 'bbbbbbbb',
            anchor: { mode: 'into', step: 'cccccccc', position: 'last' },
          },
        ],
      },
      caller,
    );

    expect(result.isError).toBe(false);
    const code = savedCall(calls)?.args.code as any;
    expect(code.block).toHaveLength(1);
    expect(code.block[0].block[1].as).toBe('bbbbbbbb');
    expect(indexSteps(code).map((entry) => entry.step.number)).toEqual([0, 1, 2, 3, 4]);
  });

  test('set_loop_source writes source at the node root and clears a stray input.source', async () => {
    const { calls, caller } = makeCaller();

    await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 10,
        changes: [
          {
            op: 'set_loop_source',
            step: 'cccccccc',
            source: 'netsuite.dddddddd.rows',
            repeat_mode: 'batch',
            batch_size: 25,
          },
        ],
      },
      caller,
    );

    const loop = (savedCall(calls)?.args.code as any).block[1];
    expect(loop.source).toBe(
      '#{_dp(\'{"pill_type":"output","provider":"netsuite","line":"dddddddd","path":["rows"]}\')}',
    );
    expect(loop.repeat_mode).toBe('batch');
    expect(loop.batch_size).toBe('25');
    expect(loop.input.source).toBeUndefined();
  });

  test('bind_connection sets account_id without touching the code tree', async () => {
    const { calls, caller } = makeCaller();

    await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      {
        recipe_id: 10,
        changes: [{ op: 'bind_connection', provider: 'logger', connection_id: 777 }],
      },
      caller,
    );

    const config = savedCall(calls)?.args.config as any[];
    expect(config.find((entry) => entry.provider === 'logger')).toMatchObject({ account_id: 777 });
    expect(config.find((entry) => entry.provider === 'netsuite')).toMatchObject({
      account_id: 19308605,
      skip_validation: true,
    });
  });

  test('a duplicated step number in a corrupted tree is refused, not guessed', async () => {
    const corrupted = () => {
      const code = auditCode();
      code.block[1].block[0].number = 1;
      return code;
    };
    const { calls, caller } = makeCaller({ code: corrupted });

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      { recipe_id: 10, changes: [{ op: 'set_input', step: 1, path: 'message', value: 'x' }] },
      caller,
    );

    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text: string }).text).toContain('numbering is corrupted');
    expect(calls.map((call) => call.name)).toEqual(['workato_pull_recipe']);
  });
});

describe('workato_recipe_apply idempotency', () => {
  test('a repeated idempotency_key returns the stored summary without saving again', async () => {
    const { calls, caller } = makeCaller();
    const args = {
      recipe_id: 10,
      idempotency_key: 'batch-1',
      changes: [{ op: 'set_input', step: 'bbbbbbbb', path: 'message', value: 'one' }],
    };

    const first = await handleWorkatoRecipeApplyCall('workato_recipe_apply', args, caller);
    const second = await handleWorkatoRecipeApplyCall('workato_recipe_apply', args, caller);

    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(calls.filter((call) => call.name === 'workato_ui_save_recipe_code')).toHaveLength(1);
    expect((second.content?.[0] as { text: string }).text).toContain(
      'idempotency_key already applied',
    );
  });

  test('a different key still saves', async () => {
    const { calls, caller } = makeCaller();
    const base = {
      recipe_id: 10,
      changes: [{ op: 'set_input', step: 'bbbbbbbb', path: 'message', value: 'one' }],
    };

    await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      { ...base, idempotency_key: 'a' },
      caller,
    );
    await handleWorkatoRecipeApplyCall(
      'workato_recipe_apply',
      { ...base, idempotency_key: 'b' },
      caller,
    );

    expect(calls.filter((call) => call.name === 'workato_ui_save_recipe_code')).toHaveLength(2);
  });
});

describe('legacy mutator names run through the engine', () => {
  test('workato_recipe_set_step_input maps to set_input', async () => {
    const { calls, caller } = makeCaller();

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_set_step_input',
      { recipe_id: 10, step_number: 'bbbbbbbb', field: 'message', value: 'legacy' },
      caller,
    );

    expect(result.isError).toBe(false);
    expect(calls.map((call) => call.name)).toEqual([
      'workato_pull_recipe',
      'workato_ui_save_recipe_code',
    ]);
    expect((savedCall(calls)?.args.code as any).block[0].input.message).toBe('legacy');
    expect(savedCall(calls)?.args.config).toEqual(auditConfig());
  });

  test('workato_recipe_map_datapill keeps its formula-mode output', async () => {
    const { calls, caller } = makeCaller();

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_map_datapill',
      {
        recipe_id: 10,
        target_step: 'dddddddd',
        target_field: 'record_type',
        source_step: 'aaaaaaaa',
        path: ['records[]', 'Name'],
      },
      caller,
    );

    expect(result.isError).toBe(false);
    const code = savedCall(calls)?.args.code as any;
    expect(code.block[1].block[0].block[0].input.record_type).toBe(
      '=_dp(\'{"pill_type":"output","provider":"salesforce","line":"aaaaaaaa","path":["records",{"path_element_type":"current_item"},"Name"]}\')',
    );
  });

  test('workato_recipe_add_step forwards tabId to both nested calls', async () => {
    const { calls, caller } = makeCaller();

    await handleWorkatoRecipeApplyCall(
      'workato_recipe_add_step',
      {
        recipe_id: 10,
        after_step: 'bbbbbbbb',
        provider: 'logger',
        action_name: 'log_message',
        tabId: 42,
      },
      caller,
    );

    expect(calls[0].args).toMatchObject({ tabId: 42, view: 'full' });
    expect(calls[1].args).toMatchObject({ tabId: 42, expected_base_version_no: 7 });
  });

  test('add_step refuses a malformed control-flow request before saving', async () => {
    const { calls, caller } = makeCaller();

    const result = await handleWorkatoRecipeApplyCall(
      'workato_recipe_add_step',
      {
        recipe_id: 10,
        after_step: 0,
        keyword: 'repeat_each',
        provider: 'logger',
        action_name: 'x',
      },
      caller,
    );

    expect(result.isError).toBe(true);
    expect(calls.map((call) => call.name)).toEqual(['workato_pull_recipe']);
    expect((result.content?.[0] as { text: string }).text).toContain('keyword must be one of');
  });

  test('add_step builds a repeat with its while_condition first and a try with a trailing catch', async () => {
    const repeatCaller = makeCaller();
    await handleWorkatoRecipeApplyCall(
      'workato_recipe_add_step',
      { recipe_id: 10, after_step: 'bbbbbbbb', keyword: 'repeat' },
      repeatCaller.caller,
    );
    const repeatNode = (savedCall(repeatCaller.calls)?.args.code as any).block[1];
    expect(repeatNode.keyword).toBe('repeat');
    expect(repeatNode.block[0].keyword).toBe('while_condition');

    const tryCaller = makeCaller();
    await handleWorkatoRecipeApplyCall(
      'workato_recipe_add_step',
      { recipe_id: 10, after_step: 'bbbbbbbb', keyword: 'try' },
      tryCaller.caller,
    );
    const tryNode = (savedCall(tryCaller.calls)?.args.code as any).block[1];
    expect(tryNode.keyword).toBe('try');
    expect(tryNode.block[tryNode.block.length - 1].keyword).toBe('catch');
  });
});

describe('config merge', () => {
  test('an existing entry is never rewritten by a new provider', () => {
    const merged = mergeRecipeConfig(auditConfig(), ['salesforce', 'jira']);
    expect(merged.added).toEqual(['jira']);
    expect(merged.config).toMatchObject([
      { provider: 'salesforce', account_id: 19092754 },
      { provider: 'netsuite', account_id: 19308605, skip_validation: true },
      { provider: 'logger' },
      { provider: 'jira' },
    ]);
    expect((merged.config as any[])[3].account_id).toBeUndefined();
    expect(merged.missing_binding).toEqual(['jira']);
  });

  test('a connectionless provider is not reported as unbound', () => {
    const merged = mergeRecipeConfig([], ['workato_recipe_function', 'jira']);
    expect(merged.missing_binding).toEqual(['jira']);
  });

  test('an unparseable config is passed through untouched', () => {
    const merged = mergeRecipeConfig('not json', ['jira']);
    expect(merged.config).toBe('not json');
    expect(merged.note).toContain('could not be parsed');
  });
});

describe('local tree validation', () => {
  test('accepts the audit fixture as pulled', () => {
    expect(validateRecipeTree(auditCode())).toMatchObject({ errors: [] });
  });

  test('reports a nested else that is not last inside its if block', () => {
    const code = auditCode();
    const ifNode = code.block[1].block[0];
    ifNode.block = [
      {
        number: 4,
        keyword: 'else',
        uuid: '66666666-6666-4666-8666-666666666666',
        input: {},
        block: [],
      },
      {
        number: 5,
        keyword: 'action',
        provider: 'logger',
        name: 'log_message',
        as: 'eeeeeeee',
        uuid: '77777777-7777-4777-8777-777777777777',
        input: {},
      },
    ];
    const touched = new Set<unknown>([ifNode]);
    const validation = validateRecipeTree(code, touched);
    expect(validation.errors.join('\n')).toContain('elsif and else must be the LAST entries');
  });

  test('a step this call created without a uuid is an error, an untouched one is a warning', () => {
    const code = auditCode();
    const orphan = code.block[1].block[0].block[0];
    delete orphan.uuid;

    expect(validateRecipeTree(code).errors).toEqual([]);
    expect(validateRecipeTree(code).warnings.join('\n')).toContain('has no uuid');
    expect(
      validateRecipeTree(code, new Set([orphan]), new Set([orphan])).errors.join('\n'),
    ).toContain('has no uuid');
  });

  test('a duplicated `as` anchor on a touched step is an error', () => {
    const code = auditCode();
    const step = code.block[1].block[0].block[0];
    step.as = 'bbbbbbbb';
    const validation = validateRecipeTree(code, new Set([step]));
    expect(validation.errors.join('\n')).toContain('is used by 2 steps');
  });

  test('a foreach whose source moved under input is reported', () => {
    const code = auditCode();
    const loop = code.block[1];
    loop.input = { source: loop.source };
    delete loop.source;
    const validation = validateRecipeTree(code, new Set([loop]));
    expect(validation.errors.join('\n')).toContain('belongs at the node root');
  });
});
