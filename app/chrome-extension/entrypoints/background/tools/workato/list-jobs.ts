import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';

interface ListJobsArgs {
  recipe_id: number;
  limit?: number;
  status?: string;
  query?: string;
  started_at?: string;
  group_by_master_job?: boolean;
  cursor?: string;
  full?: boolean;
}

interface RawJobsPage {
  job_count?: number;
  job_scope_count?: number;
  job_succeeded_count?: number;
  job_failed_count?: number;
  job_offset_count?: number;
  job_per_page?: number;
  jobs?: Array<Record<string, unknown>>;
}

interface InPageResult {
  ok: boolean;
  pages?: RawJobsPage[];
  failure?: {
    stage: 'meta' | 'page' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

/**
 * In-page function. Plain function returning a Promise chain — DO NOT add
 * async/await. Recurses via .then() to walk pages until limit reached.
 *
 * CRITICAL: This function is serialized via Function.prototype.toString()
 * by chrome.scripting.executeScript. Module-scope constants referenced
 * inside the function body do NOT survive serialization — they become
 * undefined in the page context. All constants must be declared INSIDE
 * the function (same class of pitfall as v1's `_pullInPage` issue).
 */
function listJobsInPage(
  recipeId: number,
  limit: number,
  status: string | null,
  query: string | null,
  startedAt: string | null,
  groupByMaster: boolean,
  startCursor: string | null,
): Promise<InPageResult> {
  const PER_PAGE = 25;
  const HARD_CAP = 100;

  function buildUrl(cursor: string | null): string {
    const params = new URLSearchParams();
    params.set('per_page', String(PER_PAGE));
    if (cursor) {
      params.set('offset_job_id', cursor);
      params.set('prev', 'false');
    }
    if (status) params.set('status', status);
    if (query) params.set('query', query);
    if (startedAt) params.set('started_at', startedAt);
    if (groupByMaster) params.set('group_by_master_job', 'true');
    return `/web_api/recipes/${recipeId}/jobs.json?${params.toString()}`;
  }

  const fetchOpts: RequestInit = {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  };

  function fetchPage(
    cursor: string | null,
  ): Promise<{ ok: true; page: RawJobsPage } | { ok: false; failure: InPageResult['failure'] }> {
    const url = buildUrl(cursor);
    return fetch(url, fetchOpts).then((r) =>
      r.text().then((bodyText) => {
        if (r.status < 200 || r.status >= 300) {
          return {
            ok: false as const,
            failure: {
              stage: 'page' as const,
              status: r.status,
              body_excerpt: bodyText.slice(0, 1024),
              message: `GET ${url} returned HTTP ${r.status}`,
            },
          };
        }
        let json: RawJobsPage;
        try {
          json = JSON.parse(bodyText) as RawJobsPage;
        } catch (e) {
          return {
            ok: false as const,
            failure: {
              stage: 'shape' as const,
              body_excerpt: bodyText.slice(0, 1024),
              message: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
            },
          };
        }
        if (!Array.isArray(json.jobs)) {
          return {
            ok: false as const,
            failure: {
              stage: 'shape' as const,
              body_excerpt: bodyText.slice(0, 1024),
              message: 'Unexpected response shape — missing jobs array.',
            },
          };
        }
        return { ok: true as const, page: json };
      }),
    );
  }

  function loop(cursor: string | null, pagesAcc: RawJobsPage[]): Promise<InPageResult> {
    return fetchPage(cursor).then((res) => {
      if (!res.ok) {
        // First-page failure is 'meta' stage (no pages collected yet).
        const failure = res.failure!;
        if (pagesAcc.length === 0 && failure.stage === 'page') {
          failure.stage = 'meta';
        }
        return { ok: false, failure };
      }
      const pages = pagesAcc.concat(res.page);
      const collected = pages.reduce((n, p) => n + (p.jobs?.length ?? 0), 0);
      const reachedLimit = collected >= limit;
      const lastPage = (res.page.jobs?.length ?? 0) < PER_PAGE;
      const reachedCap = collected >= HARD_CAP;
      if (reachedLimit || lastPage || reachedCap) {
        return { ok: true, pages };
      }
      const lastJob = res.page.jobs![res.page.jobs!.length - 1];
      const nextCursor = lastJob && typeof lastJob.id === 'string' ? lastJob.id : null;
      if (!nextCursor) return { ok: true, pages };
      return loop(nextCursor, pages);
    });
  }

  return loop(startCursor, []);
}

interface SlimJob {
  id: string;
  status: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  error_summary?: string;
  error_line_number?: number;
  title: string;
  report: { col_0: string; col_1: string; col_2: string };
}

function shapeSlimJob(raw: Record<string, unknown>): SlimJob {
  const started = String(raw.started_at ?? '');
  const completed = String(raw.completed_at ?? '');
  const rawDuration =
    started && completed ? new Date(completed).getTime() - new Date(started).getTime() : 0;
  const duration_ms = Number.isFinite(rawDuration) ? rawDuration : 0;
  const err = raw.error as Record<string, unknown> | undefined;
  const report = (raw.report as Record<string, unknown> | undefined) ?? {};
  return {
    id: String(raw.id ?? ''),
    status: String(raw.status ?? 'unknown'),
    started_at: started,
    completed_at: completed,
    duration_ms,
    error_summary: err?.message ? String(err.message) : undefined,
    error_line_number: typeof err?.line_number === 'number' ? err.line_number : undefined,
    title: String(raw.title ?? ''),
    report: {
      col_0: String(report.custom_column_0 ?? ''),
      col_1: String(report.custom_column_1 ?? ''),
      col_2: String(report.custom_column_2 ?? ''),
    },
  };
}

class WorkatoListJobsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.LIST_JOBS;

  async execute(args: ListJobsArgs): Promise<ToolResult> {
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse('Param [recipe_id] must be a finite number');
      }
      const limit =
        typeof args?.limit === 'number' && Number.isFinite(args.limit) && args.limit >= 1
          ? Math.min(Math.floor(args.limit), 100)
          : 25;
      const status = typeof args?.status === 'string' && args.status ? args.status : null;
      const query = typeof args?.query === 'string' && args.query ? args.query : null;
      const startedAt =
        typeof args?.started_at === 'string' && args.started_at ? args.started_at : null;
      const groupByMaster = args?.group_by_master_job === true;
      const cursor = typeof args?.cursor === 'string' && args.cursor ? args.cursor : null;
      const full = args?.full === true;

      const tab = await findWorkatoTab();
      const result = await runInWorkatoTab(tab.tabId, listJobsInPage, [
        args.recipe_id,
        limit,
        status,
        query,
        startedAt,
        groupByMaster,
        cursor,
      ]);

      if (!result.ok) {
        return createErrorResponse(
          `WorkatoApiError (${result.failure?.stage}): ${result.failure?.message}` +
            (result.failure?.body_excerpt
              ? `\n--- body excerpt ---\n${result.failure.body_excerpt}`
              : ''),
        );
      }

      const pages = result.pages!;
      const allJobs: Array<Record<string, unknown>> = [];
      for (const p of pages) {
        for (const j of p.jobs ?? []) allJobs.push(j);
      }
      // Truncate to limit (in case the last page overshot).
      const trimmedJobs = allJobs.slice(0, limit);
      const lastPage = pages[pages.length - 1] ?? {};
      const meta = {
        total: Number(lastPage.job_count ?? 0),
        scope: Number(lastPage.job_scope_count ?? 0),
        succeeded: Number(lastPage.job_succeeded_count ?? 0),
        failed: Number(lastPage.job_failed_count ?? 0),
      };
      // Compute next_cursor only when more remains (scope > collected and last page was full).
      // PER_PAGE mirrors the in-page constant — kept inline to avoid module-scope coupling
      // with the serialized in-page function.
      const collected = trimmedJobs.length;
      const lastPageJobs = lastPage.jobs ?? [];
      const lastPageFull = lastPageJobs.length >= 25;
      const moreRemains = meta.scope > collected && lastPageFull;
      const lastJobId =
        moreRemains && trimmedJobs.length > 0
          ? String(trimmedJobs[trimmedJobs.length - 1]?.id ?? '')
          : '';
      const nextCursor = moreRemains && lastJobId ? lastJobId : undefined;

      // In full mode, return raw jobs (untrimmed, truncated only at the auto-walk
      // limit, not by .slice). Drop `pages` so the response isn't doubled.
      const payload = full
        ? { ...meta, next_cursor: nextCursor, jobs: trimmedJobs }
        : {
            ...meta,
            next_cursor: nextCursor,
            jobs: trimmedJobs.map(shapeSlimJob),
          };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_list_jobs failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoListJobsTool = new WorkatoListJobsTool();
