/**
 * @fileoverview Tests for workato_recipe_callers.
 *
 * The fixture is the shape the feedback described: five callers spread over
 * three folders, one of them only reachable on page 2 of its folder listing.
 * The whole point of the tool is that a scan which stops at page 1 (as the old
 * save_with_dependents folder scan did) silently loses that caller, so the
 * pagination assertion is the load-bearing one here.
 *
 * The in-page functions are exercised directly with a stubbed fetch, the way
 * recipe-lifecycle.test.ts does it; everything downstream of them is pure.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCallersPayload,
  classifyFlowId,
  computeTransitive,
  extractCallTargets,
  fetchCalleeJobCallersInPage,
  fetchCallerScanInPage,
  fetchRecipeCallStepsInPage,
  planIndexReads,
  trimCallerIndex,
  type CallerIndex,
  type CallerIndexEntry,
  type CandidateRow,
  type FailedRead,
  type ScopeInfo,
} from '@/entrypoints/background/tools/workato/recipe-callers';

const CALLEE = 999;

/** A call_recipe step, in the shape /recipes/<id>/code.json returns. */
function callStep(
  flowId: string,
  as: string,
  stepNumber: number,
  async = false,
): Record<string, unknown> {
  return {
    as,
    number: stepNumber,
    keyword: 'action',
    name: async ? 'call_recipe_async' : 'call_recipe',
    provider: 'workato_recipe_function',
    description: 'Call <span class="provider">Time Journal Engine (callable)</span>',
    dynamicPickListSelection: { flow_id: 'Time Journal Engine (callable)' },
    input: { flow_id: flowId, parameters: { DryRun: 'true' } },
  };
}

/** A recipe whose call sits inside an if block, to prove the walk descends. */
function nestedRecipe(step: Record<string, unknown>): Record<string, unknown> {
  return {
    keyword: 'trigger',
    provider: 'salesforce',
    block: [{ keyword: 'if', number: 1, block: [step] }],
  };
}

const DYNAMIC_FLOW_ID =
  '#{_dp(\'{"pill_type":"output","provider":"workato_variable","line":"21e7dfb1","path":["flow"]}\')}';

const CODE: Record<number, Record<string, unknown>> = {
  101: nestedRecipe(callStep(String(CALLEE), 'aaaa1111', 2)),
  102: nestedRecipe(callStep('777', 'bbbb2222', 2)),
  103: nestedRecipe(callStep(String(CALLEE), 'cccc3333', 3)),
  201: nestedRecipe(callStep(String(CALLEE), 'dddd4444', 1, true)),
  202: nestedRecipe(callStep(String(CALLEE), 'eeee5555', 4)),
  301: nestedRecipe(callStep(String(CALLEE), 'ffff6666', 1)),
  [CALLEE]: nestedRecipe(callStep('888', '11112222', 5)),
};

const NAMES: Record<number, string> = {
  101: 'Get Time Entries',
  102: 'Unrelated caller',
  103: 'Export time entries',
  201: 'Process time entries',
  202: 'Nightly reconciliation',
  301: 'Payment milestone sync',
  [CALLEE]: 'Time Journal Engine (callable)',
};

/** folder -> pages of recipe ids, per_page 2 so page 2 is reachable in a fixture. */
const FOLDER_PAGES: Record<number, number[][]> = {
  10: [[101, 102], [103]],
  20: [[201, 202]],
  30: [[301, CALLEE]],
};

function listItem(id: number, folderId: number): Record<string, unknown> {
  return {
    asset_type: 'recipe',
    id,
    name: NAMES[id],
    folder_id: folderId,
    project_id: 15842038,
    running: id !== 202,
    state: id !== 202 ? 'running' : 'inactive',
    updated_at: `2026-09-0${(id % 7) + 1}T10:00:00.000-07:00`,
    trigger_application: 'salesforce',
    action_applications: ['workato_recipe_function'],
  };
}

/** Verbatim shape from GET /dependency_graphs/<id>.json?asset_type=recipe. */
const GRAPH = {
  paths: [
    { from_type: 'LCAP::Models::Page', from_id: 61604, to_type: 'Flow', to_id: 101 },
    { from_type: 'Flow', from_id: 101, to_type: 'Flow', to_id: CALLEE },
    { from_type: 'Flow', from_id: 103, to_type: 'Flow', to_id: CALLEE },
    { from_type: 'Flow', from_id: 201, to_type: 'Flow', to_id: CALLEE },
    { from_type: 'Flow', from_id: 202, to_type: 'Flow', to_id: CALLEE },
    { from_type: 'Flow', from_id: 301, to_type: 'Flow', to_id: CALLEE },
    { from_type: 'Flow', from_id: CALLEE, to_type: 'LookupTable', to_id: 4969151 },
    { from_type: 'Flow', from_id: CALLEE, to_type: 'SharedAccount', to_id: 19106688 },
    { from_type: 'Flow', from_id: CALLEE, to_type: 'Flow', to_id: 888 },
  ],
  objects: [
    { type: 'Flow', id: 101, name: NAMES[101], active: 1, folder_id: 10, provider: 'salesforce' },
    { type: 'Flow', id: 103, name: NAMES[103], active: 1, folder_id: 10, provider: 'salesforce' },
    { type: 'Flow', id: 201, name: NAMES[201], active: 1, folder_id: 20, provider: 'salesforce' },
    { type: 'Flow', id: 202, name: NAMES[202], active: 0, folder_id: 20, provider: 'clock' },
    { type: 'Flow', id: 301, name: NAMES[301], active: 1, folder_id: 30, provider: 'salesforce' },
    { type: 'Flow', id: 888, name: 'Downstream callable', active: 1, folder_id: 30 },
    {
      type: 'Flow',
      id: CALLEE,
      name: NAMES[CALLEE],
      active: 1,
      folder_id: 30,
      provider: 'workato_recipe_function',
      root: true,
    },
    {
      type: 'LCAP::Models::Page',
      id: 61604,
      name: '**Time Journal Submission form**',
      active: null,
    },
    { type: 'LookupTable', id: 4969151, name: 'PF Time Journal Config' },
    {
      type: 'SharedAccount',
      id: 19106688,
      name: 'Netsuite REST v2',
      active: 1,
      provider: 'netsuite',
    },
  ],
};

interface StubOptions {
  code?: Record<number, Record<string, unknown>>;
  codeStatus?: Record<number, number>;
  graphStatus?: number;
  jobs?: Array<Record<string, unknown>>;
}

function stubFetch(options: StubOptions = {}) {
  const codeMap = options.code ?? CODE;
  const urls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    urls.push(url);
    const respond = (status: number, body: unknown) => ({
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    });

    if (url.startsWith('/dependency_graphs/')) {
      if (options.graphStatus && options.graphStatus >= 300) {
        return respond(options.graphStatus, '{"error":"nope"}');
      }
      return respond(200, { result: GRAPH });
    }

    if (url.startsWith('/web_api/mixed_assets.json')) {
      const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
      const folderId = Number(params.get('folder_id'));
      const page = Number(params.get('page'));
      const pages = FOLDER_PAGES[folderId] ?? [];
      const items = (pages[page - 1] ?? []).map((id) => listItem(id, folderId));
      const count = pages.reduce((total, p) => total + p.length, 0);
      return respond(200, { result: { items, count, page, per_page: 2 } });
    }

    const codeMatch = /^\/recipes\/(\d+)\/code\.json/.exec(url);
    if (codeMatch) {
      const id = Number(codeMatch[1]);
      const status = options.codeStatus?.[id];
      if (status && status >= 300) return respond(status, '{"error":"forbidden"}');
      return respond(200, { result: JSON.stringify(codeMap[id] ?? {}) });
    }

    if (url.startsWith('/web_api/recipes/')) {
      return respond(200, { jobs: options.jobs ?? [] });
    }

    return respond(404, '{"error":"No route matches"}');
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, urls };
}

const SCAN_OPTIONS = {
  recipeId: CALLEE,
  wantGraph: true,
  wantCode: true,
  scopeMode: 'folders',
  folderIds: [10, 20, 30],
  projectId: '',
  maxPages: 25,
  maxRecipes: 200,
};

/** Run the scan and the code reads the way the handler chains them. */
async function scanAndRead(options: StubOptions = {}) {
  const { urls } = stubFetch(options);
  const scan = await fetchCallerScanInPage(SCAN_OPTIONS);
  const candidates = scan.candidates ?? [];
  const index: CallerIndex = {};
  const plan = planIndexReads(candidates, index, false);
  const reads = await fetchRecipeCallStepsInPage(plan.to_read, 10_000);
  const failedReads: FailedRead[] = [];
  for (const read of reads.reads) {
    const candidate = candidates.find((c) => c.id === read.recipe_id);
    if (!read.ok) {
      failedReads.push({
        recipe_id: read.recipe_id,
        name: candidate?.name,
        reason: read.message ?? 'read failed',
        status: read.status,
      });
      continue;
    }
    const extracted = extractCallTargets(read.steps ?? []);
    const entry: CallerIndexEntry = {
      recipe_id: read.recipe_id,
      name: candidate?.name,
      folder_id: candidate?.folder_id,
      updated_at: candidate?.updated_at,
      targets: extracted.targets,
      dynamic_targets: extracted.dynamic_targets,
      scanned_at: '2026-09-07T12:00:00.000Z',
    };
    index[String(read.recipe_id)] = entry;
  }
  const scope: ScopeInfo = {
    mode: 'folders',
    folder_ids: scan.folder_ids ?? [],
    recipes_listed: candidates.length,
    recipes_read: reads.reads.filter((r) => r.ok).length,
    pages: scan.pages ?? 0,
    complete: scan.listing_complete !== false && failedReads.length === 0,
  };
  return { scan, candidates, index, plan, failedReads, scope, urls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCallerScanInPage', () => {
  it('walks every page of every folder, reaching the caller on page 2', async () => {
    const { scan, urls } = await scanAndRead();

    expect(scan.ok).toBe(true);
    expect(scan.listing_complete).toBe(true);
    expect((scan.candidates ?? []).map((c) => c.id).sort((a, b) => a - b)).toEqual([
      101,
      102,
      103,
      201,
      202,
      301,
      CALLEE,
    ]);
    // Folder 10 has three recipes at per_page 2: page 1 is not the end of it.
    expect(urls).toContain(
      '/web_api/mixed_assets.json?asset_type=recipe&adapters=workato_recipe_function' +
        '&sort_term=name&per_page=20&page=2&folder_id=10',
    );
    // A folder whose count is satisfied on page 1 is not paged again.
    expect(urls.some((u) => u.includes('page=2&folder_id=20'))).toBe(false);
  });

  it('filters the listing to recipe-function recipes server-side', async () => {
    const { urls } = await scanAndRead();
    const listings = urls.filter((u) => u.startsWith('/web_api/mixed_assets.json'));
    expect(listings.length).toBeGreaterThan(0);
    for (const url of listings) {
      expect(url).toContain('adapters=workato_recipe_function');
      expect(url).toContain('asset_type=recipe');
    }
  });

  it('reports a graph failure without losing the code scan', async () => {
    const { scan } = await scanAndRead({ graphStatus: 500 });
    expect(scan.ok).toBe(true);
    expect(scan.graph).toBeUndefined();
    expect(scan.graph_error).toMatch(/HTTP 500/);
    expect((scan.candidates ?? []).length).toBe(7);
  });
});

describe('caller discovery over the five-caller fixture', () => {
  it('finds all five callers across three folders and calls the scan complete', async () => {
    const { candidates, index, plan, failedReads, scope, scan } = await scanAndRead();

    const payload = buildCallersPayload({
      recipe_id: CALLEE,
      sources: ['graph', 'code'],
      graph: scan.graph,
      graph_fetched_at: '2026-09-07T12:00:00.000Z',
      candidates,
      index,
      hits: plan.hits,
      failed_reads: failedReads,
      scope,
      include_callees: true,
      include_transitive: false,
    });

    const callers = payload.callers as Array<Record<string, any>>;
    expect(callers.map((c) => c.recipe_id)).toEqual([101, 103, 201, 202, 301]);
    expect(payload.completeness).toBe('complete');
    expect(payload.completeness_reasons).toEqual([]);

    // The page-2 caller carries its calling step, which only the code scan knows.
    const pageTwoCaller = callers.find((c) => c.recipe_id === 103)!;
    expect(pageTwoCaller.sources).toEqual(['graph', 'code']);
    expect(pageTwoCaller.step).toEqual({ as: 'cccc3333', number: 3, async: false });
    expect(pageTwoCaller.name).toBe('Export time entries');
    expect(pageTwoCaller.folder_id).toBe(10);

    // call_recipe_async is reported as such.
    expect(callers.find((c) => c.recipe_id === 201)!.step.async).toBe(true);
    // A stopped caller is reported as stopped, not omitted.
    expect(callers.find((c) => c.recipe_id === 202)!.running).toBe(false);
    // The recipe that calls something else is not a caller of this one.
    expect(callers.some((c) => c.recipe_id === 102)).toBe(false);
    // Nor is the callee its own caller.
    expect(callers.some((c) => c.recipe_id === CALLEE)).toBe(false);

    const callees = payload.callees as Array<Record<string, any>>;
    expect(callees.map((c) => c.recipe_id)).toEqual([888]);
    expect(callees[0].step).toEqual({ async: false, as: '11112222', number: 5 });

    expect(payload.lookup_tables).toEqual([{ id: 4969151, name: 'PF Time Journal Config' }]);
    expect(payload.connections).toEqual([
      { id: 19106688, name: 'Netsuite REST v2', provider: 'netsuite', active: true },
    ]);
    expect(payload.lcap_pages).toEqual([]);
    expect((payload.freshness as any).index_hits).toBe(0);
    expect((payload.freshness as any).index_misses).toBe(7);
  });

  it('reports a dynamic flow_id instead of pretending the scan was exhaustive', async () => {
    const code = { ...CODE, 102: nestedRecipe(callStep(DYNAMIC_FLOW_ID, 'bbbb2222', 2)) };
    const { candidates, index, plan, failedReads, scope, scan } = await scanAndRead({ code });

    const payload = buildCallersPayload({
      recipe_id: CALLEE,
      sources: ['graph', 'code'],
      graph: scan.graph,
      candidates,
      index,
      hits: plan.hits,
      failed_reads: failedReads,
      scope,
      include_callees: false,
      include_transitive: false,
    });

    const dynamic = payload.unresolved_dynamic_targets as Array<Record<string, any>>;
    expect(dynamic).toHaveLength(1);
    expect(dynamic[0]).toMatchObject({
      recipe_id: 102,
      step_as: 'bbbb2222',
      step_number: 2,
      async: false,
    });
    expect(dynamic[0].expression).toBe(DYNAMIC_FLOW_ID);
    expect(payload.completeness).toBe('partial');
    expect((payload.completeness_reasons as string[]).join(' ')).toMatch(
      /flow_id built at runtime/,
    );
  });

  it('names the recipes it could not read and drops them from the index', async () => {
    const { candidates, index, plan, failedReads, scope, scan } = await scanAndRead({
      codeStatus: { 301: 403 },
    });

    expect(index['301']).toBeUndefined();

    const payload = buildCallersPayload({
      recipe_id: CALLEE,
      sources: ['graph', 'code'],
      graph: scan.graph,
      candidates,
      index,
      hits: plan.hits,
      failed_reads: failedReads,
      scope,
      include_callees: false,
      include_transitive: false,
    });

    expect(payload.completeness).toBe('partial');
    const failed = payload.failed_reads as Array<Record<string, any>>;
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ recipe_id: 301, status: 403 });
    // The graph still knows 301 calls the callee; the source list says so.
    const callers = payload.callers as Array<Record<string, any>>;
    expect(callers.find((c) => c.recipe_id === 301)!.sources).toEqual(['graph']);
    expect(callers.find((c) => c.recipe_id === 301)!.step).toBeUndefined();
  });
});

describe('index reuse', () => {
  it('reads no code on a second call when nothing changed', async () => {
    const first = await scanAndRead();
    expect(first.plan.to_read).toHaveLength(7);

    const second = planIndexReads(first.candidates, first.index, false);
    expect(second.to_read).toEqual([]);
    expect(second.hits).toHaveLength(7);
  });

  it('re-reads only the recipe whose updated_at moved', async () => {
    const first = await scanAndRead();
    const changed: CandidateRow[] = first.candidates.map((c) =>
      c.id === 201 ? { ...c, updated_at: '2026-09-07T23:59:00.000-07:00' } : c,
    );
    const plan = planIndexReads(changed, first.index, false);
    expect(plan.to_read).toEqual([201]);
  });

  it('re-reads everything when refresh is asked for', async () => {
    const first = await scanAndRead();
    const plan = planIndexReads(first.candidates, first.index, true);
    expect(plan.to_read).toHaveLength(7);
    expect(plan.hits).toEqual([]);
  });

  it('never trusts a candidate with no updated_at', async () => {
    const first = await scanAndRead();
    const noStamp = first.candidates.map((c) => ({ ...c, updated_at: undefined }));
    expect(planIndexReads(noStamp, first.index, false).to_read).toHaveLength(7);
  });
});

describe('classifyFlowId', () => {
  it('accepts a plain recipe id in either form', () => {
    expect(classifyFlowId('76902508')).toEqual({ literal: '76902508' });
    expect(classifyFlowId(76902508)).toEqual({ literal: '76902508' });
    expect(classifyFlowId(' 999 ')).toEqual({ literal: '999' });
  });

  it('treats a datapill, a formula and a missing value as unresolvable', () => {
    expect(classifyFlowId(DYNAMIC_FLOW_ID).dynamic).toBe(DYNAMIC_FLOW_ID);
    expect(classifyFlowId("=_dp('x')").dynamic).toBe("=_dp('x')");
    expect(classifyFlowId(undefined).dynamic).toBe('<missing flow_id>');
    expect(classifyFlowId('').dynamic).toBe('<empty flow_id>');
  });
});

describe('extractCallTargets', () => {
  it('finds calls at any depth and ignores look-alike steps', () => {
    const tree = {
      keyword: 'trigger',
      block: [
        {
          keyword: 'repeat_each',
          block: [
            {
              keyword: 'if',
              block: [callStep('123', 'aaaaaaaa', 4, true)],
            },
          ],
        },
        // Same action name, different provider: not a recipe-function call.
        { keyword: 'action', provider: 'salesforce', name: 'call_recipe', input: { flow_id: '5' } },
      ],
    };
    const extracted = extractCallTargets(tree);
    expect(extracted.targets).toEqual([
      { flow_id: '123', async: true, step_as: 'aaaaaaaa', step_number: 4 },
    ]);
    expect(extracted.dynamic_targets).toEqual([]);
  });

  it('works on the slim step projection the page returns', () => {
    const extracted = extractCallTargets([
      { name: 'call_recipe', provider: 'workato_recipe_function', as: 'bb', input: { flow_id: 7 } },
    ]);
    expect(extracted.targets).toEqual([{ flow_id: '7', async: false, step_as: 'bb' }]);
  });
});

describe('computeTransitive', () => {
  it('reports indirect callers with their hop depth', () => {
    const result = computeTransitive(
      [
        [101, CALLEE],
        [201, 101],
        [301, 201],
        [401, 888],
      ],
      CALLEE,
    );
    expect(result.indirect_callers).toEqual([
      { recipe_id: 201, depth: 2 },
      { recipe_id: 301, depth: 3 },
    ]);
    expect(result.cycles).toEqual([]);
  });

  it('detects a cycle instead of walking it forever', () => {
    const result = computeTransitive(
      [
        [101, CALLEE],
        [CALLEE, 201],
        [201, 101],
      ],
      CALLEE,
    );
    expect(result.cycles).toHaveLength(1);
    const cycle = result.cycles[0];
    expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    expect(new Set(cycle)).toEqual(new Set([101, CALLEE, 201]));
    expect(result.edges).toHaveLength(3);
  });

  it('deduplicates edges seen by both the graph and the code scan', () => {
    const result = computeTransitive(
      [
        [101, CALLEE],
        [101, CALLEE],
      ],
      CALLEE,
    );
    expect(result.edges).toEqual([[101, CALLEE]]);
  });

  it('is reachable from the payload when include_transitive is set', async () => {
    const { candidates, index, plan, failedReads, scope, scan } = await scanAndRead();
    const payload = buildCallersPayload({
      recipe_id: CALLEE,
      sources: ['graph', 'code'],
      graph: scan.graph,
      candidates,
      index,
      hits: plan.hits,
      failed_reads: failedReads,
      scope,
      include_callees: false,
      include_transitive: true,
    });
    const transitive = payload.transitive as any;
    expect(transitive.edges.length).toBeGreaterThan(0);
    expect(transitive.cycles).toEqual([]);
  });
});

describe('job evidence', () => {
  it('labels calling_recipe_id as observed execution history', async () => {
    stubFetch({
      jobs: [
        { id: 'j-1', calling_recipe_id: 101, started_at: '2026-09-01T10:00:00.000-07:00' },
        { id: 'j-2', calling_recipe_id: 101, started_at: '2026-09-05T10:00:00.000-07:00' },
        { id: 'j-3', calling_recipe_id: 707, started_at: '2026-09-02T10:00:00.000-07:00' },
        { id: 'j-4', started_at: '2026-09-03T10:00:00.000-07:00' },
      ],
    });
    const jobs = await fetchCalleeJobCallersInPage(CALLEE, 50);
    expect(jobs.ok).toBe(true);
    expect(jobs.jobs).toEqual([
      { calling_recipe_id: 101, started_at: '2026-09-01T10:00:00.000-07:00' },
      { calling_recipe_id: 101, started_at: '2026-09-05T10:00:00.000-07:00' },
      { calling_recipe_id: 707, started_at: '2026-09-02T10:00:00.000-07:00' },
    ]);

    const scope: ScopeInfo = {
      mode: 'folders',
      folder_ids: [10],
      recipes_listed: 0,
      recipes_read: 0,
      pages: 0,
      complete: true,
    };
    const payload = buildCallersPayload({
      recipe_id: CALLEE,
      sources: ['graph', 'jobs'],
      graph: GRAPH,
      candidates: [],
      index: {},
      hits: [],
      failed_reads: [],
      jobs: jobs.jobs,
      scope,
      include_callees: false,
      include_transitive: false,
    });
    const callers = payload.callers as Array<Record<string, any>>;
    // A caller only jobs know about is still reported, with its source named.
    expect(callers.find((c) => c.recipe_id === 707)!.sources).toEqual(['jobs']);
    expect(callers.find((c) => c.recipe_id === 101)!.observed_at).toBe(
      '2026-09-05T10:00:00.000-07:00',
    );
    expect((payload.jobs_evidence as any).note).toMatch(/observed execution history/);
    // The code scan was skipped, so the answer cannot claim to be complete.
    expect(payload.completeness).toBe('partial');
  });
});

describe('trimCallerIndex', () => {
  it('keeps the newest scans when the index outgrows its cap', () => {
    const index: CallerIndex = {
      '1': { recipe_id: 1, targets: [], dynamic_targets: [], scanned_at: '2026-09-01T00:00:00Z' },
      '2': { recipe_id: 2, targets: [], dynamic_targets: [], scanned_at: '2026-09-03T00:00:00Z' },
      '3': { recipe_id: 3, targets: [], dynamic_targets: [], scanned_at: '2026-09-02T00:00:00Z' },
    };
    expect(Object.keys(trimCallerIndex(index, 2)).sort()).toEqual(['2', '3']);
    expect(Object.keys(trimCallerIndex(index, 5)).sort()).toEqual(['1', '2', '3']);
  });
});
