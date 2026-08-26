import { describe, expect, test } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  handleWorkatoSaveWithDependentsCall,
  isWorkatoSaveWithDependentsTool,
  parseActiveDependentCount,
  treeCallsRecipe,
} from './workato-save-dependents';

const okText = (payload: unknown): CallToolResult => ({
  isError: false,
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

const errText = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});

/**
 * Fake Workato. `running` is the live state, mutated by start/stop exactly as
 * the real lifecycle tools would, so the test asserts on end state rather than
 * on call order alone.
 */
function makeWorkato(opts: {
  running: Record<number, boolean>;
  saveResult?: CallToolResult;
  statusFails?: number;
  stopFails?: number;
}) {
  const running = { ...opts.running };
  const calls: Array<{ name: string; args: any }> = [];

  const call = async (name: string, args: any): Promise<CallToolResult> => {
    calls.push({ name, args });
    if (name === 'workato_recipe_status') {
      if (opts.statusFails === args.recipe_id) return errText('boom');
      return okText({
        recipe_id: args.recipe_id,
        name: `recipe ${args.recipe_id}`,
        running: running[args.recipe_id] === true,
        version_no: 3,
      });
    }
    if (name === 'workato_stop_recipe') {
      if (opts.stopFails === args.recipe_id) return errText('stop refused');
      running[args.recipe_id] = false;
      return okText({ recipe_id: args.recipe_id, action: 'stop' });
    }
    if (name === 'workato_start_recipe') {
      running[args.recipe_id] = true;
      return okText({ recipe_id: args.recipe_id, action: 'start' });
    }
    if (name === 'workato_ui_save_recipe_code') {
      return (
        opts.saveResult ?? okText({ recipe_id: args.recipe_id, version_no: 18, code_errors: [] })
      );
    }
    return okText({});
  };

  return { call, calls, running };
}

const parse = (result: CallToolResult): any =>
  JSON.parse((result.content[0] as any).text.split('\n').slice(-1)[0]);

describe('treeCallsRecipe', () => {
  const tree = {
    keyword: 'trigger',
    block: [
      {
        keyword: 'if',
        block: [
          {
            keyword: 'action',
            provider: 'workato_recipe_function',
            name: 'call_recipe',
            input: { flow_id: '76902508' },
          },
        ],
      },
    ],
  };

  test('finds a call_recipe target nested inside a block', () => {
    expect(treeCallsRecipe(tree, 76902508)).toBe(true);
    expect(treeCallsRecipe(tree, 99999999)).toBe(false);
  });

  test('ignores steps that are not call_recipe', () => {
    const other = {
      keyword: 'action',
      provider: 'salesforce',
      name: 'call_recipe',
      input: { flow_id: '76902508' },
    };
    expect(treeCallsRecipe(other, 76902508)).toBe(false);
  });
});

describe('parseActiveDependentCount', () => {
  test('reads the count out of the real error shape', () => {
    expect(parseActiveDependentCount('{"active_dependent_recipes_count":[2]}')).toBe(2);
    expect(parseActiveDependentCount('active_dependent_recipes_count: 3')).toBe(3);
    expect(parseActiveDependentCount('some other error')).toBeNull();
  });
});

describe('handleWorkatoSaveWithDependentsCall', () => {
  test('stops running dependents, saves, and restores prior state', async () => {
    const wk = makeWorkato({ running: { 111: true, 222: false } });
    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: { keyword: 'trigger' }, dependent_recipe_ids: [111, 222] },
      wk.call,
    );

    expect(result.isError).toBe(false);
    const payload = parse(result);
    expect(payload.dependents).toEqual([
      { id: 111, name: 'recipe 111', was_running: true, stopped: true, restarted: true },
      { id: 222, name: 'recipe 222', was_running: false, stopped: false, restarted: null },
    ]);
    // 222 was stopped before the call and must still be stopped after it.
    expect(wk.running[111]).toBe(true);
    expect(wk.running[222]).toBe(false);
    expect(payload.discovery).toBe('explicit');
  });

  test('refuses when it has no way to know the dependents', async () => {
    const wk = makeWorkato({ running: {} });
    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {} },
      wk.call,
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text;
    expect(text).toMatch(/no way to determine which recipes call 999/);
    expect(text).toMatch(/dependent_recipe_ids/);
    expect(text).toMatch(/scan_folder_id/);
    // Nothing was saved on the refusal path.
    expect(wk.calls.some((c) => c.name === 'workato_ui_save_recipe_code')).toBe(false);
  });

  test('restores what it stopped when the save fails, and surfaces a count mismatch', async () => {
    const wk = makeWorkato({
      running: { 111: true },
      saveResult: errText('Workato: {"active_dependent_recipes_count":[2]}'),
    });
    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111] },
      wk.call,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text;
    expect(text).toMatch(/2 dependent recipe\(s\) still ACTIVE, but only 1 were known/);
    expect(wk.running[111]).toBe(true); // put back
  });

  test('a stop failure aborts before saving and restarts what it already stopped', async () => {
    const wk = makeWorkato({ running: { 111: true, 222: true }, stopFails: 222 });
    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111, 222] },
      wk.call,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toMatch(/failed to stop dependent 222/);
    expect(wk.calls.some((c) => c.name === 'workato_ui_save_recipe_code')).toBe(false);
    expect(wk.running[111]).toBe(true);
  });

  test('a status read failure aborts rather than guessing the prior state', async () => {
    const wk = makeWorkato({ running: { 111: true }, statusFails: 111 });
    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111] },
      wk.call,
    );
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toMatch(/could not read status of dependent 111/);
  });

  test('discovers dependents by folder scan when asked', async () => {
    const calls: Array<{ name: string; args: any }> = [];
    const call = async (name: string, args: any): Promise<CallToolResult> => {
      calls.push({ name, args });
      if (name === 'workato_search_recipes') {
        return okText({ items: [{ id: 111 }, { id: 222 }, { id: 999 }] });
      }
      if (name === 'workato_pull_recipe') {
        const callsTarget = args.recipe_id === 111;
        return okText({
          code: callsTarget
            ? {
                keyword: 'action',
                provider: 'workato_recipe_function',
                name: 'call_recipe',
                input: { flow_id: '999' },
              }
            : { keyword: 'action', provider: 'salesforce', name: 'search' },
        });
      }
      if (name === 'workato_recipe_status') return okText({ running: false, name: 'r' });
      if (name === 'workato_ui_save_recipe_code') {
        return okText({ recipe_id: 999, version_no: 2, code_errors: [] });
      }
      return okText({});
    };

    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, scan_folder_id: 30573643 },
      call,
    );

    expect(result.isError).toBe(false);
    const payload = parse(result);
    expect(payload.discovery).toBe('folder_scan:30573643');
    expect(payload.dependents.map((d: any) => d.id)).toEqual([111]);
    // The callee itself is never treated as its own dependent.
    expect(
      calls.filter((c) => c.name === 'workato_pull_recipe').map((c) => c.args.recipe_id),
    ).toEqual([111, 222]);
  });

  test('requires a code payload and a numeric recipe id', async () => {
    const wk = makeWorkato({ running: {} });
    const noCode = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 1, dependent_recipe_ids: [] },
      wk.call,
    );
    expect(noCode.isError).toBe(true);
    expect((noCode.content[0] as any).text).toMatch(/pass code \(object\) or code_path/);

    const noId = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { code: {} },
      wk.call,
    );
    expect(noId.isError).toBe(true);
  });

  test('passes code_path and a neutral default comment to the save tool', async () => {
    const wk = makeWorkato({ running: {} });
    await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code_path: '/tmp/r.json', dependent_recipe_ids: [] },
      wk.call,
    );
    const save = wk.calls.find((c) => c.name === 'workato_ui_save_recipe_code')!;
    expect(save.args.code_path).toBe('/tmp/r.json');
    expect(save.args.comment).toBe('schema refresh');
    expect(save.args.restart_if_running).toBe(true);
  });

  test('isWorkatoSaveWithDependentsTool matches only its own tool', () => {
    expect(isWorkatoSaveWithDependentsTool('workato_recipe_save_with_dependents')).toBe(true);
    expect(isWorkatoSaveWithDependentsTool('workato_ui_save_recipe_code')).toBe(false);
  });
});
