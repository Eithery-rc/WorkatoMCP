/**
 * @fileoverview Tests for the in-page half of workato_list_jobs: URL building,
 * the local scan, the two budgets, the retention stop and the resume cursor.
 *
 * The walk runs in the page, so it is exercised here exactly as Chrome would
 * run it: the real function, with fetch stubbed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  listJobsInPage,
  type ListJobsWalkOptions,
} from '@/entrypoints/background/tools/workato/list-jobs';

const COLUMNS = [
  { name: 'custom_column_0', label: 'Marker code' },
  { name: 'custom_column_1', label: 'Marker pill' },
];

function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `j-${Math.random().toString(36).slice(2, 10)}-CD`,
    title: '',
    status: 'succeeded',
    started_at: '2026-09-05T09:41:12.000-07:00',
    completed_at: '2026-09-05T09:41:13.000-07:00',
    erased: false,
    zero_retention: false,
    is_test: false,
    report: {},
    ...overrides,
  };
}

function page(jobs: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    job_count: 2092,
    job_scope_count: 2092,
    job_succeeded_count: 2085,
    job_failed_count: 7,
    job_per_page: 25,
    jobs,
  };
}

function fullPage(prefix: string, count = 25): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => job({ id: `j-${prefix}-${i}-CD` }));
}

function options(overrides: Partial<ListJobsWalkOptions> = {}): ListJobsWalkOptions {
  return {
    recipeId: 82145436,
    limit: 25,
    status: null,
    query: null,
    startedAt: null,
    startedFrom: null,
    startedTo: null,
    groupByMaster: false,
    cursor: null,
    budgetMs: 20_000,
    scanBudget: 500,
    stopOnErased: true,
    match: null,
    columns: COLUMNS,
    ...overrides,
  };
}

/** Serve pages in order; record every requested URL. */
function stubPages(pages: Array<Record<string, unknown>>): { urls: string[] } {
  const urls: string[] = [];
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      const body = JSON.stringify(pages[Math.min(call, pages.length - 1)]);
      call += 1;
      return Promise.resolve({ status: 200, text: () => Promise.resolve(body) });
    }),
  );
  return { urls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listJobsInPage URL building', () => {
  it('sends per_page=25 and every supported filter', async () => {
    const { urls } = stubPages([page([job()])]);
    await listJobsInPage(
      options({
        status: 'failed',
        query: 'GIRAFFE',
        startedAt: '24.hours',
        startedFrom: '2026-07-18T00:00:00-07:00',
        startedTo: '2026-08-05T23:59:59-07:00',
        groupByMaster: true,
      }),
    );
    const url = urls[0];
    expect(url).toContain('/web_api/recipes/82145436/jobs.json?');
    expect(url).toContain('per_page=25');
    expect(url).toContain('status=failed');
    expect(url).toContain('query=GIRAFFE');
    expect(url).toContain('started_at=24.hours');
    expect(url).toContain('started_at_from=2026-07-18T00%3A00%3A00-07%3A00');
    expect(url).toContain('started_at_to=2026-08-05T23%3A59%3A59-07%3A00');
    expect(url).toContain('group_by_master_job=true');
    expect(url).not.toContain('offset_job_id');
  });

  it('resumes from a cursor with prev=false', async () => {
    const { urls } = stubPages([page([job()])]);
    await listJobsInPage(options({ cursor: 'j-Aaw3P6HX-or3ndJ-CD' }));
    expect(urls[0]).toContain('offset_job_id=j-Aaw3P6HX-or3ndJ-CD');
    expect(urls[0]).toContain('prev=false');
  });

  it('walks to the next page using the last job id', async () => {
    const first = fullPage('p1');
    const { urls } = stubPages([page(first), page([job({ id: 'j-last-CD' })])]);
    const result = await listJobsInPage(options({ limit: 100 }));
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain(`offset_job_id=${first[24].id}`);
    expect(result.scanned).toBe(26);
    expect(result.complete).toBe(true);
    expect(result.stopped_reason).toBe('end_of_list');
  });
});

describe('listJobsInPage backend mode', () => {
  it('returns every scanned job and reports full coverage', async () => {
    stubPages([page([job({ id: 'j-a-CD' }), job({ id: 'j-b-CD' })])]);
    const result = await listJobsInPage(options());
    expect(result.ok).toBe(true);
    expect(result.jobs?.map((j) => j.id)).toEqual(['j-a-CD', 'j-b-CD']);
    expect(result.matched).toBe(2);
    expect(result.scanned).toBe(2);
    expect(result.complete).toBe(true);
    expect(result.meta).toEqual({
      job_count: 2092,
      job_scope_count: 2092,
      job_succeeded_count: 2085,
      job_failed_count: 7,
    });
  });

  it('surfaces an HTTP failure on the first page as a meta failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ status: 500, text: () => Promise.resolve('boom') })),
    );
    const result = await listJobsInPage(options());
    expect(result.ok).toBe(false);
    expect(result.failure?.stage).toBe('meta');
  });
});

describe('listJobsInPage local scan', () => {
  const marked = job({
    id: 'j-AbWgaWbC-WpahEG-CD',
    report: { custom_column_0: 'GIRAFFE-4412 static', custom_column_1: 'GIRAFFE-4412' },
  });
  const failed = job({
    id: 'j-Aaw3P6HX-or3ndJ-CD',
    status: 'failed',
    error: { message: 'Failed records to review', error_type: 'Stop processing', line_number: 7 },
  });
  const plain = job({ id: 'j-plain-CD' });

  it('matches a report column by its configured label', async () => {
    stubPages([page([plain, marked, failed])]);
    const result = await listJobsInPage(
      options({
        match: { mode: 'substring', fields: ['report.Marker code'], value: 'giraffe' },
      }),
    );
    expect(result.jobs?.map((j) => j.id)).toEqual(['j-AbWgaWbC-WpahEG-CD']);
    expect(result.matched).toBe(1);
    expect(result.scanned).toBe(3);
  });

  it('matches error text, which the server query cannot', async () => {
    stubPages([page([plain, marked, failed])]);
    const result = await listJobsInPage(
      options({ match: { mode: 'substring', fields: ['error'], value: 'records to review' } }),
    );
    expect(result.jobs?.map((j) => j.id)).toEqual(['j-Aaw3P6HX-or3ndJ-CD']);
  });

  it('supports exact and regex modes', async () => {
    stubPages([page([plain, marked, failed])]);
    const exact = await listJobsInPage(
      options({
        match: { mode: 'exact', fields: ['report'], value: 'GIRAFFE-4412' },
      }),
    );
    expect(exact.matched).toBe(1);

    stubPages([page([plain, marked, failed])]);
    const substring = await listJobsInPage(
      options({ match: { mode: 'substring', fields: ['report'], value: 'GIRAFFE-4412' } }),
    );
    expect(substring.matched).toBe(1);

    stubPages([page([plain, marked, failed])]);
    const regex = await listJobsInPage(
      options({ match: { mode: 'regex', fields: ['id'], value: '^j-(plain|Aaw3)' } }),
    );
    expect(regex.matched).toBe(2);
  });

  it('refuses an unusable regex without fetching anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await listJobsInPage(
      options({ match: { mode: 'regex', fields: ['id'], value: '([' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.failure?.stage).toBe('match');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a resume cursor from the last SCANNED job even when nothing matched', async () => {
    const jobs = fullPage('scan');
    stubPages([page(jobs), page(fullPage('scan2'))]);
    const result = await listJobsInPage(
      options({
        scanBudget: 25,
        match: { mode: 'substring', fields: ['id'], value: 'no-such-job' },
      }),
    );
    expect(result.matched).toBe(0);
    expect(result.jobs).toEqual([]);
    expect(result.scanned).toBe(25);
    expect(result.complete).toBe(false);
    expect(result.stopped_reason).toBe('scan_budget');
    expect(result.last_scanned_id).toBe(jobs[24].id);
  });

  it('stops at the limit of MATCHES, not of jobs looked at', async () => {
    const jobs = [
      ...fullPage('noise', 10),
      job({ id: 'j-hit-1-CD', title: 'marker' }),
      job({ id: 'j-hit-2-CD', title: 'marker' }),
      job({ id: 'j-hit-3-CD', title: 'marker' }),
    ];
    stubPages([page(jobs)]);
    const result = await listJobsInPage(
      options({ limit: 2, match: { mode: 'substring', fields: ['title'], value: 'marker' } }),
    );
    expect(result.jobs).toHaveLength(2);
    expect(result.scanned).toBe(12);
    expect(result.stopped_reason).toBe('limit');
    expect(result.complete).toBe(false);
  });
});

describe('listJobsInPage retention handling', () => {
  const erased = (id: string) =>
    job({
      id,
      erased: true,
      report: null,
      status: 'failed',
      started_at: '2026-06-18T09:18:14-07:00',
    });

  it('stops after three consecutive erased jobs and says the boundary was reached', async () => {
    const jobs = [
      job({ id: 'j-kept-CD' }),
      erased('j-e1-CD'),
      erased('j-e2-CD'),
      erased('j-e3-CD'),
      job({ id: 'j-never-looked-at-CD' }),
    ];
    stubPages([page(jobs)]);
    const result = await listJobsInPage(options());
    expect(result.scanned).toBe(4);
    expect(result.erased_seen).toBe(3);
    expect(result.retention_boundary_reached).toBe(true);
    expect(result.stopped_reason).toBe('erased_boundary');
    // Nothing older is searchable, so the covered ground really is complete.
    expect(result.complete).toBe(true);
  });

  it('does not stop on erased jobs that are not consecutive', async () => {
    const jobs = [erased('j-e1-CD'), job({ id: 'j-kept-CD' }), erased('j-e2-CD')];
    stubPages([page(jobs)]);
    const result = await listJobsInPage(options());
    expect(result.scanned).toBe(3);
    expect(result.erased_seen).toBe(2);
    expect(result.retention_boundary_reached).toBe(false);
  });

  it('walks past the boundary when stop_on_erased is off', async () => {
    const jobs = [erased('j-e1-CD'), erased('j-e2-CD'), erased('j-e3-CD'), job({ id: 'j-x-CD' })];
    stubPages([page(jobs)]);
    const result = await listJobsInPage(options({ stopOnErased: false }));
    expect(result.scanned).toBe(4);
    expect(result.retention_boundary_reached).toBe(false);
  });

  it('reports the scanned window from first to last job seen', async () => {
    stubPages([
      page([
        job({ id: 'j-newest-CD', started_at: '2026-09-05T09:41:12.000-07:00' }),
        job({ id: 'j-oldest-CD', started_at: '2026-07-20T08:06:38.122-07:00' }),
      ]),
    ]);
    const result = await listJobsInPage(options());
    expect(result.from_started_at).toBe('2026-09-05T09:41:12.000-07:00');
    expect(result.through_started_at).toBe('2026-07-20T08:06:38.122-07:00');
  });
});
