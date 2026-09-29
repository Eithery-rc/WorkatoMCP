/**
 * @fileoverview Tests for the pure half of the environment and deployment
 * tools: environment/workspace resolution, manifest selection, the plan join,
 * the unified diff, the remap-aware recipe diff and the run state machine.
 *
 * Fixtures mirror the shapes captured live on 2026-09-29 (Legacy, Dev to Prod,
 * deployment 313765) with synthetic names and code.
 */

import { describe, expect, it } from 'vitest';

import {
  decideRun,
  diffDeployRecipe,
  isStopRequired,
  joinPlan,
  resolveEnvironment,
  resolveWorkspace,
  selectManifest,
  unifiedDiff,
  type DiffAsset,
  type ManifestAsset,
} from '@/entrypoints/background/tools/workato/deploy-logic';

const ENVS = [
  { id: 8070978, name: 'Development', type: 'dev' },
  { id: 8070982, name: 'Test', type: 'test' },
  { id: 8070980, name: 'Production', type: 'prod' },
];

describe('resolveEnvironment', () => {
  it('accepts type aliases, names and ids', () => {
    expect(resolveEnvironment('prod', ENVS)).toEqual({ ok: true, value: ENVS[2] });
    expect(resolveEnvironment('Production', ENVS)).toEqual({ ok: true, value: ENVS[2] });
    expect(resolveEnvironment('development', ENVS)).toEqual({ ok: true, value: ENVS[0] });
    expect(resolveEnvironment(8070982, ENVS)).toEqual({ ok: true, value: ENVS[1] });
    expect(resolveEnvironment('8070982', ENVS)).toEqual({ ok: true, value: ENVS[1] });
  });

  it('names the candidates on a miss', () => {
    const miss = resolveEnvironment('staging', ENVS);
    expect(miss.ok).toBe(false);
    expect(!miss.ok && miss.error).toMatch(/Production \(prod, id 8070980\)/);
    expect(resolveEnvironment(1, ENVS).ok).toBe(false);
  });

  it('refuses a type two environments share', () => {
    const two = [...ENVS, { id: 1, name: 'Prod EU', type: 'prod' }];
    const res = resolveEnvironment('prod', two);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/matches 2 environments/);
  });
});

describe('resolveWorkspace', () => {
  const teams = [
    { id: 8070978, name: 'Legacy' },
    { id: 7633674, name: 'Power Factors' },
    { id: 5105163, name: 'Blu Banyan Workspace' },
    { id: 5621727, name: 'Blu Opportunity' },
  ];

  it('prefers an exact name, then a unique substring, then an id', () => {
    expect(resolveWorkspace('legacy', teams)).toEqual({ ok: true, value: teams[0] });
    expect(resolveWorkspace('power', teams)).toEqual({ ok: true, value: teams[1] });
    expect(resolveWorkspace(7633674, teams)).toEqual({ ok: true, value: teams[1] });
  });

  it('refuses an ambiguous substring and lists the matches', () => {
    const res = resolveWorkspace('blu', teams);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/Blu Banyan Workspace \(5105163\)/);
    expect(!res.ok && res.error).toMatch(/Blu Opportunity \(5621727\)/);
  });
});

/** The Vantiv project manifest shape: listener -> processor -> create fn -> lookup. */
function manifest(): ManifestAsset[] {
  return [
    {
      id: 4934952,
      name: 'Payments Config',
      type: 'lookup_table',
      zip_name: 'payments_config.lookup_table.json',
      deps: [],
      checked: true,
    },
    {
      id: 73975178,
      name: 'Create Payments',
      type: 'recipe',
      zip_name: 'P/Recipes/create_payments.recipe.json',
      deps: [
        { id: 19415308, type: 'connection', name: 'NetSuite', unreachable: true },
        { id: 4934952, type: 'lookup_table', name: 'Payments Config' },
      ],
      checked: true,
    },
    {
      id: 73975333,
      name: 'Files Processor',
      type: 'recipe',
      zip_name: 'P/Recipes/files_processor.recipe.json',
      deps: [
        { id: 19415308, type: 'connection', name: 'NetSuite', unreachable: true },
        { id: 73975178, type: 'recipe', name: 'Create Payments' },
        { id: 126437, type: 'workato_db_table', name: 'Errors' },
      ],
      checked: true,
    },
    {
      id: 73975368,
      name: 'Files Listener',
      type: 'recipe',
      zip_name: 'P/Recipes/files_listener.recipe.json',
      deps: [{ id: 73975333, type: 'recipe', name: 'Files Processor' }],
      checked: true,
    },
    {
      id: 126437,
      name: 'Errors',
      type: 'workato_db_table',
      zip_name: 'P/errors.workato_db_table.json',
      deps: [],
      checked: true,
    },
  ];
}

function checkedIds(assets: ManifestAsset[]): number[] {
  return assets.filter((a) => a.checked).map((a) => a.id);
}

describe('selectManifest', () => {
  it('recipe_with_deps reproduces the recipe page preselection', () => {
    const res = selectManifest(manifest(), { mode: 'recipe_with_deps', recipeId: 73975333 });
    expect(res.ok).toBe(true);
    const ids = res.ok ? checkedIds(res.value) : [];
    // Processor, the recipe it calls, that recipe's lookup table, the data table.
    expect(ids.sort()).toEqual([126437, 4934952, 73975178, 73975333].sort());
    // The caller of the processor stays out.
    expect(ids).not.toContain(73975368);
  });

  it('exclude wins over the closure and include adds back', () => {
    const res = selectManifest(manifest(), {
      mode: 'recipe_with_deps',
      recipeId: 73975333,
      exclude: [73975178, 4934952],
      include: [73975368],
    });
    expect(res.ok && checkedIds(res.value).sort()).toEqual([126437, 73975333, 73975368].sort());
  });

  it('all keeps every asset and refuses unknown ids', () => {
    const all = selectManifest(manifest(), { mode: 'all' });
    expect(all.ok && checkedIds(all.value)).toHaveLength(5);
    const bad = selectManifest(manifest(), { mode: 'all', exclude: [42] });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/42/);
  });

  it('refuses a recipe outside the manifest and an empty selection', () => {
    expect(selectManifest(manifest(), { mode: 'recipe_with_deps', recipeId: 1 }).ok).toBe(false);
    const empty = selectManifest(manifest(), {
      mode: 'all',
      exclude: [4934952, 73975178, 73975333, 73975368, 126437],
    });
    expect(empty.ok).toBe(false);
  });
});

describe('joinPlan', () => {
  const withDiff: DiffAsset[] = [
    {
      id: 4936468,
      name: 'Payments Config',
      type: 'lookup_table',
      state: 'no_change',
      zip_name: 'payments_config.lookup_table.json',
      include_data: false,
    },
    {
      id: 134082,
      name: 'Errors',
      type: 'workato_db_table',
      state: 'no_change',
      zip_name: 'P/errors.workato_db_table.json',
    },
    {
      id: 74546899,
      name: 'Create Payments',
      type: 'recipe',
      state: 'no_change',
      running: true,
      zip_name: 'P/Recipes/create_payments.recipe.json',
    },
    {
      id: 74546900,
      name: 'Files Processor',
      type: 'recipe',
      state: 'changed',
      changes: ['code'],
      running: true,
      zip_name: 'P/Recipes/files_processor.recipe.json',
    },
  ];

  it('joins source and target ids by zip_name and predicts the stop', () => {
    const selected = selectManifest(manifest(), { mode: 'recipe_with_deps', recipeId: 73975333 });
    const plan = joinPlan(selected.ok ? selected.value : [], withDiff);
    expect(plan.summary).toEqual({ added: 0, updated: 1, unchanged: 3 });
    const processor = plan.assets.find((a) => a.name === 'Files Processor');
    expect(processor).toMatchObject({
      source_id: 73975333,
      target_id: 74546900,
      state: 'changed',
      changes: ['code'],
      running: true,
    });
    // Only a CHANGED running recipe is stopped; the unchanged running one is not.
    expect(plan.will_stop).toEqual([
      { name: 'Files Processor', source_id: 73975333, target_id: 74546900 },
    ]);
    expect(plan.not_included).toEqual([
      { name: 'Files Listener', type: 'recipe', source_id: 73975368 },
    ]);
    expect(plan.id_map.get('126437')).toBe('134082');
    expect(plan.id_map.get('73975178')).toBe('74546899');
  });

  it('counts unknown states apart instead of guessing', () => {
    const plan = joinPlan(manifest(), [
      { id: 1, name: 'X', type: 'recipe', state: 'weird', zip_name: 'x' },
    ]);
    expect(plan.summary).toEqual({ added: 0, updated: 0, unchanged: 0, other: 1 });
  });
});

describe('unifiedDiff', () => {
  it('renders hunks with context and counts lines', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');
    const after = ['a', 'b', 'C', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].join('\n');
    const d = unifiedDiff(before, after, { context: 1 });
    expect(d.added_lines).toBe(2);
    expect(d.removed_lines).toBe(1);
    expect(d.diff).toContain('-c');
    expect(d.diff).toContain('+C');
    expect(d.diff).toContain('+k');
    // Two hunks: the change at line 3 and the append at the end.
    expect(d.diff.match(/^@@/gm)).toHaveLength(2);
    expect(d.truncated).toBe(false);
  });

  it('caps the output and reports the full size', () => {
    const before = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
    const after = Array.from({ length: 400 }, (_, i) => `LINE ${i}`).join('\n');
    const d = unifiedDiff(before, after, { maxLines: 50 });
    expect(d.truncated).toBe(true);
    expect(d.diff.split('\n')).toHaveLength(50);
    expect(d.total_lines).toBeGreaterThan(800);
  });

  it('returns only the header for equal texts', () => {
    const d = unifiedDiff('same\ntext', 'same\ntext');
    expect(d.diff.split('\n')).toHaveLength(2);
    expect(d.added_lines + d.removed_lines).toBe(0);
  });
});

function tableRef(id: string) {
  return { id, type: 'workato_db_table', folder: 'P', name: 'Errors' };
}

function recipeCode(opts: {
  code: string;
  tableId: string;
  flowId: string;
  lookupId?: number;
  extraStep?: boolean;
}) {
  const block: Record<string, unknown>[] = [
    {
      number: 1,
      keyword: 'action',
      provider: 'workato_db_table',
      name: 'search_records',
      as: '560e704b',
      input: { table_id: tableRef(opts.tableId) },
    },
    {
      number: 2,
      keyword: 'action',
      provider: 'py_eval',
      name: 'invoke_custom_py_code',
      as: '38ef2487',
      input: { code: opts.code },
    },
    {
      number: 3,
      keyword: 'action',
      provider: 'workato_recipe_function',
      name: 'call_recipe',
      as: 'ff58e2e3',
      input: {
        flow_id: { id: opts.flowId, type: 'recipe', folder: 'P/Recipes', name: 'Create Payments' },
        lookup: opts.lookupId,
      },
    },
  ];
  if (opts.extraStep) {
    block.push({ number: 4, keyword: 'action', provider: 'logger', name: 'log', as: 'aa11bb22' });
  }
  return JSON.stringify({
    number: 0,
    keyword: 'trigger',
    provider: 'workato_recipe_function',
    name: 'execute',
    as: 'trigger0',
    block,
  });
}

const CONFIG = JSON.stringify([{ keyword: 'application', name: 'py_eval', provider: 'py_eval' }]);

describe('diffDeployRecipe', () => {
  const oldCode = ['# Version: 1.5.0', 'x = 1', 'skip()', 'done()'].join('\n');
  const newCode = ['# Version: 1.5.1', 'x = 1', 'error()', 'done()'].join('\n');

  it('reports the real change and moves environment remaps aside', () => {
    const idMap = new Map([
      ['4934952', '4936468'],
      ['126437', '134082'],
      ['73975178', '74546899'],
    ]);
    const diff = diffDeployRecipe(
      {
        code: recipeCode({
          code: oldCode,
          tableId: '134082',
          flowId: '74546899',
          lookupId: 4936468,
        }),
        connection_config: CONFIG,
      },
      {
        code: recipeCode({
          code: newCode,
          tableId: '126437',
          flowId: '73975178',
          lookupId: 4934952,
        }),
        connection_config: CONFIG,
      },
      idMap,
    );
    expect(diff.steps_changed.map((s) => s.as)).toEqual(['38ef2487']);
    const field = diff.steps_changed[0].fields[0];
    expect(field).toMatchObject({ path: 'input.code', kind: 'code' });
    expect(field.diff).toContain('-# Version: 1.5.0');
    expect(field.diff).toContain('+# Version: 1.5.1');
    expect(diff.remaps).toEqual([
      {
        as: '560e704b',
        path: 'input.table_id',
        type: 'workato_db_table',
        name: 'Errors',
        from: '126437',
        to: '134082',
      },
      {
        as: 'ff58e2e3',
        path: 'input.flow_id',
        type: 'recipe',
        name: 'Create Payments',
        from: '73975178',
        to: '74546899',
      },
      { as: 'ff58e2e3', path: 'input.lookup', from: '4934952', to: '4936468' },
    ]);
    expect(diff.steps_added).toEqual([]);
    expect(diff.steps_removed).toEqual([]);
    expect(diff.connection_config).toBeUndefined();
  });

  it('flags a same-named ref to an asset the deployment does not map as a change', () => {
    // The step was rewired to a different table that happens to share the name.
    const idMap = new Map([['126437', '134082']]);
    const diff = diffDeployRecipe(
      { code: recipeCode({ code: oldCode, tableId: '134082', flowId: '2' }) },
      { code: recipeCode({ code: oldCode, tableId: '999999', flowId: '2' }) },
      idMap,
    );
    expect(diff.remaps).toEqual([]);
    expect(diff.steps_changed.map((s) => s.as)).toEqual(['560e704b']);
    expect(diff.steps_changed[0].fields).toEqual([
      { path: 'input.table_id.id', kind: 'value', before: '134082', after: '999999' },
    ]);
  });

  it('flags a bare id the deployment does not map as a change', () => {
    const diff = diffDeployRecipe(
      { code: recipeCode({ code: oldCode, tableId: '1', flowId: '2', lookupId: 10 }) },
      { code: recipeCode({ code: oldCode, tableId: '1', flowId: '2', lookupId: 11 }) },
    );
    expect(diff.steps_changed).toHaveLength(1);
    expect(diff.steps_changed[0].fields).toEqual([
      { path: 'input.lookup', kind: 'value', before: '10', after: '11' },
    ]);
  });

  it('lists added and removed steps and a changed connection config', () => {
    const diff = diffDeployRecipe(
      { code: recipeCode({ code: oldCode, tableId: '1', flowId: '2' }), connection_config: CONFIG },
      {
        code: recipeCode({ code: oldCode, tableId: '1', flowId: '2', extraStep: true }),
        connection_config: JSON.stringify([]),
      },
    );
    expect(diff.steps_added.map((s) => s.as)).toEqual(['aa11bb22']);
    expect(diff.steps_changed).toEqual([]);
    expect(diff.connection_config).toBeDefined();

    const reverse = diffDeployRecipe(
      { code: recipeCode({ code: oldCode, tableId: '1', flowId: '2', extraStep: true }) },
      { code: recipeCode({ code: oldCode, tableId: '1', flowId: '2' }) },
    );
    expect(reverse.steps_removed.map((s) => s.as)).toEqual(['aa11bb22']);
  });
});

describe('run state machine', () => {
  it('treats "Recipes require action: stop" as a question, not a failure', () => {
    const stop = {
      state: 'deploy_failed',
      error: 'Recipes require action: stop',
      recipes_to_stop: [{ id: 74546900, name: 'Files Processor', stop_reason: null }],
    };
    expect(isStopRequired(stop)).toBe(true);
    expect(decideRun(stop)).toEqual({ kind: 'needs_stop' });
  });

  it('maps every captured state', () => {
    expect(decideRun({ state: 'diff_calculation_finished' })).toEqual({ kind: 'start' });
    expect(decideRun({ state: 'deploy_started' })).toEqual({ kind: 'poll' });
    expect(decideRun({ state: 'deploy_finished' })).toEqual({ kind: 'finished' });
    expect(decideRun({ state: 'deploy_failed', error: 'boom' })).toEqual({ kind: 'failed' });
    expect(decideRun({ state: 'pending' })).toEqual({ kind: 'not_ready' });
    expect(decideRun({ state: 'diff_calculation_started' })).toEqual({ kind: 'not_ready' });
    expect(decideRun({ state: 'diff_calculation_failed' })).toEqual({ kind: 'failed' });
  });
});
