/**
 * @fileoverview Tests for the scope, input query and coverage half of
 * workato_recipe_step_search.
 *
 * The candidate walk runs in the page, so it is exercised here the way Chrome
 * runs it: the real function with fetch stubbed. The point of most of these
 * cases is coverage honesty, because a mid-walk page failure used to end the
 * scan silently and read as "that is the whole workspace".
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectMatchingSteps,
  fetchStepCandidatesInPage,
  type StepSearchWalkOptions,
} from '@/entrypoints/background/tools/workato/step-search';

const PER_PAGE = 20;

function listItem(id: number, overrides: Record<string, unknown> = {}) {
  return {
    asset_type: 'recipe',
    id,
    name: `Recipe ${id}`,
    folder_id: 30945905,
    running: true,
    trigger_application: 'salesforce',
    action_applications: ['netsuite'],
    ...overrides,
  };
}

/** A code.json body for a recipe with one netsuite step: result is the stringified tree. */
function codeBody(recipeId: number, internalId = 'ABC-1') {
  return JSON.stringify({
    result: JSON.stringify({
      number: 0,
      keyword: 'trigger',
      provider: 'salesforce',
      name: 'new_object',
      block: [
        {
          number: 1,
          keyword: 'action',
          provider: 'netsuite',
          name: 'add_object',
          as: `step_${recipeId}`,
          input: { internalId, sublists: { item: [{ quantity: 1 }] } },
        },
      ],
    }),
  });
}

function options(overrides: Partial<StepSearchWalkOptions> = {}): StepSearchWalkOptions {
  return {
    provider: 'netsuite',
    maxPages: 5,
    maxRecipes: 8,
    folderIds: [],
    recipeIds: [],
    ...overrides,
  };
}

/** Route each request by URL through `routes`; record every URL requested. */
function stubRoutes(routes: Array<[RegExp, () => { status: number; body: string }]>): {
  urls: string[];
} {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      for (const [pattern, respond] of routes) {
        if (pattern.test(url)) {
          const res = respond();
          return Promise.resolve({ status: res.status, text: () => Promise.resolve(res.body) });
        }
      }
      return Promise.resolve({ status: 404, text: () => Promise.resolve('no route') });
    }),
  );
  return { urls };
}

function listBody(items: unknown[]) {
  return JSON.stringify({ result: { items, count: items.length, per_page: PER_PAGE } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchStepCandidatesInPage scope', () => {
  it('scans the workspace list when no scope is given', async () => {
    const { urls } = stubRoutes([
      [/mixed_assets/, () => ({ status: 200, body: listBody([listItem(101)]) })],
      [/code\.json/, () => ({ status: 200, body: codeBody(101) })],
    ]);

    const result = await fetchStepCandidatesInPage(options());

    expect(result.ok).toBe(true);
    expect(result.folders_scanned).toBe(0);
    expect(urls[0]).toContain('asset_type=recipe');
    expect(urls[0]).not.toContain('folder_id=');
    expect(result.candidates?.map((c) => c.recipe_id)).toEqual([101]);
  });

  it('loops the folders it was given, one list scan each', async () => {
    const { urls } = stubRoutes([
      [/folder_id=30945905/, () => ({ status: 200, body: listBody([listItem(101)]) })],
      [/folder_id=30573643/, () => ({ status: 200, body: listBody([listItem(202)]) })],
      [/code\.json/, () => ({ status: 200, body: codeBody(101) })],
    ]);

    const result = await fetchStepCandidatesInPage(options({ folderIds: [30945905, 30573643] }));

    const listUrls = urls.filter((u) => u.includes('mixed_assets'));
    expect(listUrls).toHaveLength(2);
    expect(listUrls[0]).toContain('folder_id=30945905');
    expect(listUrls[1]).toContain('folder_id=30573643');
    expect(result.folders_scanned).toBe(2);
    expect(result.pages_scanned).toBe(2);
    expect(result.flagged).toBe(2);
  });

  it('reads recipe_ids directly and never touches the recipe list', async () => {
    const { urls } = stubRoutes([
      [
        /^\/recipes\/\d+\.json/,
        () => ({
          status: 200,
          body: JSON.stringify({
            result: { recipe_data: { flow: { name: 'Named by metadata', folder_id: 7 } } },
          }),
        }),
      ],
      [/code\.json/, () => ({ status: 200, body: codeBody(303) })],
    ]);

    const result = await fetchStepCandidatesInPage(options({ recipeIds: [303, 404] }));

    expect(urls.some((u) => u.includes('mixed_assets'))).toBe(false);
    expect(result.pages_scanned).toBe(0);
    expect(result.recipes_requested).toBe(2);
    expect(result.candidates?.map((c) => c.recipe_name)).toEqual([
      'Named by metadata',
      'Named by metadata',
    ]);
    expect(result.candidates?.map((c) => c.folder_id)).toEqual([7, 7]);
  });
});

describe('fetchStepCandidatesInPage coverage honesty', () => {
  it('reports a failed later page as incomplete instead of the end of the list', async () => {
    let listCalls = 0;
    stubRoutes([
      [
        /mixed_assets/,
        () => {
          listCalls += 1;
          if (listCalls === 1) {
            return {
              status: 200,
              body: listBody(Array.from({ length: PER_PAGE }, (_, i) => listItem(100 + i))),
            };
          }
          return { status: 502, body: 'bad gateway' };
        },
      ],
      [/code\.json/, () => ({ status: 200, body: codeBody(100) })],
    ]);

    const result = await fetchStepCandidatesInPage(options({ maxRecipes: 1 }));

    expect(result.ok).toBe(true);
    expect(result.incomplete).toBe(true);
    expect(result.incomplete_reason).toMatch(/HTTP 502/);
    expect(result.pages_scanned).toBe(1);
  });

  it('fails outright when the very first page fails', async () => {
    stubRoutes([[/mixed_assets/, () => ({ status: 500, body: 'boom' })]]);

    const result = await fetchStepCandidatesInPage(options());

    expect(result.ok).toBe(false);
    expect(result.failure?.stage).toBe('list');
    expect(result.failure?.message).toMatch(/HTTP 500/);
  });

  it('flags a scope cut short by max_pages', async () => {
    stubRoutes([
      [
        /mixed_assets/,
        () => ({
          status: 200,
          body: listBody(Array.from({ length: PER_PAGE }, (_, i) => listItem(200 + i))),
        }),
      ],
      [/code\.json/, () => ({ status: 200, body: codeBody(200) })],
    ]);

    const result = await fetchStepCandidatesInPage(options({ maxPages: 2, maxRecipes: 1 }));

    expect(result.pages_scanned).toBe(2);
    expect(result.pages_truncated).toBe(true);
    expect(result.incomplete).toBe(false);
  });

  it('treats a short page as the real end of the list', async () => {
    stubRoutes([
      [/mixed_assets/, () => ({ status: 200, body: listBody([listItem(301)]) })],
      [/code\.json/, () => ({ status: 200, body: codeBody(301) })],
    ]);

    const result = await fetchStepCandidatesInPage(options());

    expect(result.pages_truncated).toBe(false);
    expect(result.incomplete).toBe(false);
    expect(result.pages_scanned).toBe(1);
  });
});

describe('collectMatchingSteps input query', () => {
  const TREE = {
    number: 0,
    keyword: 'trigger',
    provider: 'salesforce',
    name: 'new_object',
    block: [
      {
        number: 1,
        keyword: 'action',
        provider: 'netsuite',
        name: 'add_object',
        as: 'ns01',
        input: { internalId: 'GIRAFFE-4412', memo: 'first' },
      },
      {
        number: 2,
        keyword: 'action',
        provider: 'netsuite',
        name: 'add_object',
        as: 'ns02',
        input: { externalId: 'ZEBRA-7731', memo: 'second' },
      },
    ],
  };

  it('keeps only steps whose serialized input contains the query', () => {
    const hits = collectMatchingSteps(TREE, 'netsuite', null, { inputQuery: 'giraffe' });
    expect(hits.map((h) => h.as)).toEqual(['ns01']);
  });

  it('supports a regex input query', () => {
    const hits = collectMatchingSteps(TREE, 'netsuite', null, {
      inputQuery: '(external|internal)Id":"Z',
      inputMatch: 'regex',
    });
    expect(hits.map((h) => h.as)).toEqual(['ns02']);
  });

  it('matches nothing rather than throwing on an unusable regex', () => {
    const hits = collectMatchingSteps(TREE, 'netsuite', null, {
      inputQuery: '([unclosed',
      inputMatch: 'regex',
    });
    expect(hits).toEqual([]);
  });

  it('returns every step when no input query is given', () => {
    expect(collectMatchingSteps(TREE, 'netsuite', null, {}).map((h) => h.as)).toEqual([
      'ns01',
      'ns02',
    ]);
  });

  it('previews an input past preview_chars and reports its real size', () => {
    const [hit] = collectMatchingSteps(TREE, 'netsuite', null, { previewChars: 20 });
    expect(hit.input).toBeUndefined();
    expect(hit.input_truncated).toBe(true);
    expect(hit.input_preview?.endsWith('...')).toBe(true);
    expect(hit.input_preview).toHaveLength(23);
    expect(hit.input_chars).toBeGreaterThan(20);
  });

  it('returns the whole input block when it fits inside preview_chars', () => {
    const [hit] = collectMatchingSteps(TREE, 'netsuite', null, { previewChars: 2000 });
    expect(hit.input).toEqual({ internalId: 'GIRAFFE-4412', memo: 'first' });
    expect(hit.input_preview).toBeUndefined();
    expect(hit.input_truncated).toBeUndefined();
  });

  it('matches the input query against the preview text of a truncated input too', () => {
    const hits = collectMatchingSteps(TREE, 'netsuite', null, {
      inputQuery: 'ZEBRA',
      previewChars: 10,
    });
    expect(hits.map((h) => h.as)).toEqual(['ns02']);
    expect(hits[0].input_truncated).toBe(true);
  });
});
