import { afterAll, describe, expect, test } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  describeDependentCountMismatch,
  handleWorkatoSaveWithDependentsCall,
  isWorkatoSaveWithDependentsTool,
  parseActiveDependentCount,
  readScanScope,
  treeCallsRecipe,
} from './workato-save-dependents';
import { resetOperationsDirCache } from './workato-operations';

// Every orchestrator call now journals to disk; keep that out of the real
// bridge state directory.
const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wops-sd-'));
process.env.WORKATOMCP_OPERATIONS_DIR = journalDir;
resetOperationsDirCache();

afterAll(() => {
  try {
    fs.rmSync(journalDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

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

describe('readScanScope', () => {
  test('keeps the original single-folder argument working', () => {
    expect(readScanScope({ scan_folder_id: 30573643 })).toEqual({
      folder_ids: [30573643],
      project_id: undefined,
      scope: undefined,
    });
  });

  test('merges scan_folder_id into scan_folder_ids without duplicating it', () => {
    expect(readScanScope({ scan_folder_id: 10, scan_folder_ids: [10, 20] })?.folder_ids).toEqual([
      10, 20,
    ]);
  });

  test('accepts a project or workspace scope on its own', () => {
    expect(readScanScope({ scan_project_id: '15842038' })).toEqual({
      folder_ids: [],
      project_id: '15842038',
      scope: undefined,
    });
    expect(readScanScope({ scan_scope: 'workspace' })?.scope).toBe('workspace');
  });

  test('is null when no scope was asked for', () => {
    expect(readScanScope({ recipe_id: 1 })).toBeNull();
    expect(readScanScope({ scan_scope: 'nonsense' })).toBeNull();
  });
});

describe('describeDependentCountMismatch', () => {
  test('warns when Workato counts more active dependents than were discovered', () => {
    const note = describeDependentCountMismatch(
      'Workato: {"active_dependent_recipes_count":[3]}',
      [111],
      1,
      'recipe_callers:folders(30573643):complete',
    );
    expect(note).toMatch(/WARNING/);
    expect(note).toMatch(/3 dependent recipe\(s\) still ACTIVE/);
    expect(note).toMatch(/discovered 1 caller\(s\) \(\[111\]\)/);
    expect(note).toMatch(/recipe_callers:folders\(30573643\):complete/);
  });

  test('says nothing when Workato reported no count', () => {
    expect(describeDependentCountMismatch('some other error', [111], 1, 'explicit')).toBe('');
    expect(
      describeDependentCountMismatch('active_dependent_recipes_count: 0', [111], 1, 'explicit'),
    ).toBe('');
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
      {
        id: 111,
        name: 'recipe 111',
        was_running: true,
        stopped: true,
        restarted: true,
        // The fake's start reports no outcome, so the single status re-check
        // is what proves the restart, exactly as it would against Workato.
        restart_outcome: 'state_reached_after_recheck',
        connections_healthy: null,
      },
      { id: 222, name: 'recipe 222', was_running: false, stopped: false, restarted: null },
    ]);
    expect(typeof payload.operation_id).toBe('string');
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
    expect(text).toMatch(/scan_scope/);
    expect(text).toMatch(/workato_recipe_callers/);
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
    expect(text).toMatch(/WARNING: Workato reports 2 dependent recipe\(s\) still ACTIVE/);
    expect(text).toMatch(
      /discovered 1 caller\(s\) \(\[111\]\) and stopped the 1 that were running/,
    );
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

  /**
   * The discovery fixture is the real workato_recipe_callers response shape:
   * a summary line, then the payload with `callers`, `scope` and
   * `completeness`. The old fixture stubbed workato_search_recipes with an
   * `items[]` key the slim tool never returned.
   */
  function makeDiscovering(
    callers: any[],
    completeness: 'complete' | 'partial' = 'complete',
    reasons: string[] = [],
    scope: any = { mode: 'folders', folder_ids: [30573643], complete: completeness === 'complete' },
  ) {
    const calls: Array<{ name: string; args: any }> = [];
    const running: Record<number, boolean> = {};
    for (const caller of callers) running[caller.recipe_id] = caller.running === true;

    const call = async (name: string, args: any): Promise<CallToolResult> => {
      calls.push({ name, args });
      if (name === 'workato_recipe_callers') {
        return {
          isError: false,
          content: [
            {
              type: 'text',
              text:
                `${callers.length} caller(s) of recipe ${args.recipe_id}\n` +
                JSON.stringify({
                  recipe_id: args.recipe_id,
                  sources: ['graph', 'code'],
                  callers,
                  unresolved_dynamic_targets: [],
                  failed_reads: [],
                  scope,
                  completeness,
                  completeness_reasons: reasons,
                }),
            },
          ],
        };
      }
      if (name === 'workato_recipe_status') {
        return okText({
          recipe_id: args.recipe_id,
          name: `recipe ${args.recipe_id}`,
          running: running[args.recipe_id] === true,
          version_no: 3,
        });
      }
      if (name === 'workato_stop_recipe') {
        running[args.recipe_id] = false;
        return okText({ recipe_id: args.recipe_id, action: 'stop' });
      }
      if (name === 'workato_start_recipe') {
        running[args.recipe_id] = true;
        return okText({ recipe_id: args.recipe_id, action: 'start' });
      }
      if (name === 'workato_ui_save_recipe_code') {
        return okText({ recipe_id: 999, version_no: 2, code_errors: [] });
      }
      return okText({});
    };
    return { call, calls, running };
  }

  test('discovers dependents through workato_recipe_callers when a folder is given', async () => {
    const wk = makeDiscovering([
      { recipe_id: 111, name: 'Get Time Entries', running: true, sources: ['graph', 'code'] },
      { recipe_id: 222, name: 'Export time entries', running: false, sources: ['code'] },
    ]);

    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, scan_folder_id: 30573643 },
      wk.call,
    );

    expect(result.isError).toBe(false);
    const payload = parse(result);
    expect(payload.discovery).toBe('recipe_callers:folders(30573643):complete');
    expect(payload.discovery_completeness).toBe('complete');
    expect(payload.dependents.map((d: any) => d.id)).toEqual([111, 222]);
    // One discovery call up front plus one revalidation after the stops, not
    // one pull per recipe in the folder.
    const discoveryCalls = wk.calls.filter((c) => c.name === 'workato_recipe_callers');
    expect(discoveryCalls).toHaveLength(2);
    expect(discoveryCalls[0].args.folder_ids).toEqual([30573643]);
    expect(wk.calls.some((c) => c.name === 'workato_pull_recipe')).toBe(false);
    // Prior state is restored: 111 was running, 222 was not.
    expect(wk.running[111]).toBe(true);
    expect(wk.running[222]).toBe(false);
  });

  test('maps the wider scan arguments onto the discovery call', async () => {
    const wk = makeDiscovering([], 'complete', [], {
      mode: 'workspace',
      folder_ids: [],
      complete: true,
    });
    await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      {
        recipe_id: 999,
        code: {},
        scan_folder_ids: [10, 20],
        scan_project_id: '15842038',
        scan_scope: 'workspace',
      },
      wk.call,
    );
    const args = wk.calls.find((c) => c.name === 'workato_recipe_callers')!.args;
    expect(args.folder_ids).toEqual([10, 20]);
    expect(args.project_id).toBe('15842038');
    expect(args.scope).toBe('workspace');
    expect(args.sources).toEqual(['graph', 'code']);
  });

  test('a partial discovery is reported as a warning, not smoothed over', async () => {
    const wk = makeDiscovering(
      [{ recipe_id: 111, name: 'Get Time Entries', running: true, sources: ['graph'] }],
      'partial',
      ['2 recipe(s) could not be read'],
    );

    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, scan_folder_id: 30573643 },
      wk.call,
    );

    expect(result.isError).toBe(false);
    const text = (result.content[0] as any).text;
    expect(text).toMatch(/caller discovery was PARTIAL/);
    const payload = parse(result);
    expect(payload.discovery_completeness).toBe('partial');
    expect(payload.discovery_reasons).toEqual(['2 recipe(s) could not be read']);
  });

  test('a discovery failure aborts instead of saving as if there were no callers', async () => {
    const calls: Array<{ name: string; args: any }> = [];
    const call = async (name: string, args: any): Promise<CallToolResult> => {
      calls.push({ name, args });
      if (name === 'workato_recipe_callers') return errText('TabNotFound: no Workato tab');
      return okText({});
    };

    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, scan_scope: 'workspace' },
      call,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toMatch(/TabNotFound/);
    expect(calls.some((c) => c.name === 'workato_ui_save_recipe_code')).toBe(false);
  });

  test('the callee is never treated as its own dependent', async () => {
    const wk = makeDiscovering([
      { recipe_id: 999, name: 'itself', running: true, sources: ['graph'] },
      { recipe_id: 111, name: 'Get Time Entries', running: false, sources: ['code'] },
    ]);
    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, scan_folder_id: 30573643 },
      wk.call,
    );
    expect(parse(result).dependents.map((d: any) => d.id)).toEqual([111]);
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
