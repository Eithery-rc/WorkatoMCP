/**
 * @fileoverview Tests for workato_search_recipes: the client-side match modes,
 * the app filter, highlight cleanup, and the in-page page walk that has to tell
 * "the list ended" apart from "a page failed".
 *
 * Fixtures follow a live capture (2026-09-07) where text=ECO matched
 * "New/updated records" through the action titles, not the name.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  nameMatches,
  searchRecipesInPage,
  usesApps,
  type SearchRecipesWalkOptions,
} from '@/entrypoints/background/tools/workato/search-recipes';
import {
  cleanHighlightMarkup,
  extractHighlights,
} from '@/entrypoints/background/tools/workato/slim-asset';

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asset_type: 'recipe',
    id: 82145141,
    name: 'Project Accounting nightly reconciliation',
    folder_id: 30945905,
    project_id: 15842038,
    running: true,
    state: 'running',
    last_run_at: '2026-09-04T08:19:22.982-07:00',
    job_succeeded_count: 68,
    job_failed_count: 4,
    trigger_application: 'salesforce',
    trigger_business_object: 'Opportunity',
    action_applications: ['netsuite', 'email'],
    highlights: { name: null, description: null, actions: [] },
    ...overrides,
  };
}

function options(overrides: Partial<SearchRecipesWalkOptions> = {}): SearchRecipesWalkOptions {
  return {
    text: '',
    folderId: null,
    startPage: 1,
    maxPages: 5,
    sort: 'latest_activity',
    adapter: null,
    keepHighlights: false,
    budgetMs: 20_000,
    ...overrides,
  };
}

function body(items: unknown[], count = items.length): string {
  return JSON.stringify({ result: { items, count, page: 1, per_page: 20 } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nameMatches', () => {
  const name = 'Project Accounting nightly reconciliation';

  it('is a pass-through in fulltext mode: the server already decided', () => {
    expect(nameMatches('New/updated records', 'ECO', 'fulltext')).toBe(true);
  });

  it('matches a substring case-insensitively', () => {
    expect(nameMatches(name, 'eco', 'name_substring')).toBe(true);
    expect(nameMatches('New/updated records', 'eco', 'name_substring')).toBe(true);
    expect(nameMatches(name, 'zebra', 'name_substring')).toBe(false);
  });

  it('matches whole words only in name_word mode', () => {
    expect(nameMatches(name, 'nightly', 'name_word')).toBe(true);
    expect(nameMatches(name, 'night', 'name_word')).toBe(false);
    expect(nameMatches('Copy of Opportunity Change Order', 'order', 'name_word')).toBe(true);
  });

  it('matches the whole name in name_exact mode', () => {
    expect(nameMatches(name, name.toUpperCase(), 'name_exact')).toBe(true);
    expect(nameMatches(name, 'Project Accounting', 'name_exact')).toBe(false);
  });

  it('matches a regex, and treats an unusable one as no match', () => {
    expect(nameMatches(name, '^Project .*reconciliation$', 'name_regex')).toBe(true);
    expect(nameMatches(name, '([', 'name_regex')).toBe(false);
  });
});

describe('usesApps', () => {
  it('accepts the trigger app or any action app, and ANDs several', () => {
    const recipe = item();
    expect(usesApps(recipe, [])).toBe(true);
    expect(usesApps(recipe, ['salesforce'])).toBe(true);
    expect(usesApps(recipe, ['email'])).toBe(true);
    expect(usesApps(recipe, ['salesforce', 'netsuite'])).toBe(true);
    expect(usesApps(recipe, ['salesforce', 'slack'])).toBe(false);
  });
});

describe('highlight cleanup', () => {
  it('strips the span markup Workato wraps a match in', () => {
    expect(
      cleanHighlightMarkup(
        'Project Accounting nightly r<span class="text-highlight">eco</span>nciliation',
      ),
    ).toBe('Project Accounting nightly reconciliation');
    expect(cleanHighlightMarkup(null)).toBe('');
  });

  it('returns why a recipe matched, or null when it carries nothing', () => {
    const highlights = extractHighlights(
      item({
        highlights: {
          name: null,
          description: 'inactivates related r<span class="text-highlight">eco</span>rds',
          actions: ['New/updated r<span class="text-highlight">eco</span>rds'],
        },
      }) as never,
    );
    expect(highlights).toEqual({
      description: 'inactivates related records',
      actions: ['New/updated records'],
    });
    expect(extractHighlights(item() as never)).toBeNull();
  });
});

describe('searchRecipesInPage', () => {
  it('builds the mixed_assets URL with text, folder and the adapters filter', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        urls.push(url);
        return Promise.resolve({ status: 200, text: () => Promise.resolve(body([item()])) });
      }),
    );
    await searchRecipesInPage(
      options({
        text: 'ECO',
        folderId: 30945905,
        adapter: 'workato_recipe_function',
        sort: 'relevance',
        keepHighlights: true,
      }),
    );
    expect(urls[0]).toContain('asset_type=recipe');
    expect(urls[0]).toContain('sort_term=relevance');
    expect(urls[0]).toContain('text=ECO');
    expect(urls[0]).toContain('folder_id=30945905');
    expect(urls[0]).toContain('adapters=workato_recipe_function');
  });

  it('drops the per-character highlight noise when there is no text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(body([item({ highlights: { name: '<span>a</span><span>b</span>' } })])),
        }),
      ),
    );
    const result = await searchRecipesInPage(options());
    expect((result.items?.[0] as Record<string, unknown>).highlights).toBeUndefined();
    expect((result.items?.[0] as Record<string, unknown>).name).toBe(
      'Project Accounting nightly reconciliation',
    );
  });

  it('walks pages until a short one proves the list ended', async () => {
    const full = Array.from({ length: 20 }, (_, i) => item({ id: i }));
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        call += 1;
        const items = call === 1 ? full : [item({ id: 99 })];
        return Promise.resolve({ status: 200, text: () => Promise.resolve(body(items, 21)) });
      }),
    );
    const result = await searchRecipesInPage(options());
    expect(result.pages_scanned).toBe(2);
    expect(result.items).toHaveLength(21);
    expect(result.end_of_list).toBe(true);
    expect(result.incomplete).toBe(false);
  });

  it('stops at max_pages without claiming the list ended', async () => {
    const full = Array.from({ length: 20 }, (_, i) => item({ id: i }));
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ status: 200, text: () => Promise.resolve(body(full, 500)) })),
    );
    const result = await searchRecipesInPage(options({ maxPages: 2 }));
    expect(result.pages_scanned).toBe(2);
    expect(result.end_of_list).toBe(false);
    expect(result.last_page).toBe(2);
  });

  it('reports a failed later page as incomplete, not as the end of the list', async () => {
    const full = Array.from({ length: 20 }, (_, i) => item({ id: i }));
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        call += 1;
        if (call === 1) {
          return Promise.resolve({ status: 200, text: () => Promise.resolve(body(full, 500)) });
        }
        return Promise.resolve({ status: 502, text: () => Promise.resolve('bad gateway') });
      }),
    );
    const result = await searchRecipesInPage(options());
    expect(result.ok).toBe(true);
    expect(result.pages_scanned).toBe(1);
    expect(result.end_of_list).toBe(false);
    expect(result.incomplete).toBe(true);
    expect(result.incomplete_reason).toMatch(/HTTP 502/);
  });

  it('surfaces a first-page failure as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ status: 500, text: () => Promise.resolve('boom') })),
    );
    const result = await searchRecipesInPage(options());
    expect(result.ok).toBe(false);
    expect(result.failure?.stage).toBe('search');
  });
});
