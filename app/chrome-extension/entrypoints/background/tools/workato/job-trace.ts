import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';
import { buildSlimTrace, type RawMetaResponse, type RawLineDetailsResponse } from './slim-trace';

interface JobTraceArgs {
  recipe_id: number;
  job_id: string | number;
  full?: boolean;
  tabId?: number;
}

interface InPageResult {
  ok: boolean;
  meta?: RawMetaResponse;
  lineDetails?: RawLineDetailsResponse;
  failure?: {
    stage: 'meta' | 'line_details';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

/**
 * In-page function. See pull-recipe.ts for why this MUST NOT use async/await.
 */
function tracePageFn(recipeId: number, jobId: string | number): Promise<InPageResult> {
  const fetchOpts: RequestInit = {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  };
  const fetchAndParse = (
    url: string,
  ): Promise<{ status: number; bodyText: string; json: unknown }> =>
    fetch(url, fetchOpts).then((r) =>
      r.text().then((bodyText) => {
        let json: unknown = null;
        try {
          json = JSON.parse(bodyText);
        } catch {
          /* swallow */
        }
        return { status: r.status, bodyText, json };
      }),
    );

  return fetchAndParse(`/web_api/recipes/${recipeId}/jobs/${jobId}`).then((meta) => {
    if (meta.status < 200 || meta.status >= 300) {
      return {
        ok: false,
        failure: {
          stage: 'meta' as const,
          status: meta.status,
          body_excerpt: meta.bodyText.slice(0, 1024),
          message: `GET /web_api/recipes/${recipeId}/jobs/${jobId} returned HTTP ${meta.status}`,
        },
      };
    }

    return fetchAndParse(
      `/web_api/recipes/${recipeId}/jobs/${jobId}/line_details?stringify_big_numbers=true`,
    ).then((trace) => {
      if (trace.status < 200 || trace.status >= 300) {
        return {
          ok: false,
          failure: {
            stage: 'line_details' as const,
            status: trace.status,
            body_excerpt: trace.bodyText.slice(0, 1024),
            message: `GET /web_api/recipes/${recipeId}/jobs/${jobId}/line_details returned HTTP ${trace.status}`,
          },
        };
      }

      return {
        ok: true,
        meta: meta.json as RawMetaResponse,
        lineDetails: trace.json as RawLineDetailsResponse,
      };
    });
  });
}

class WorkatoJobTraceTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.JOB_TRACE;

  async execute(args: JobTraceArgs): Promise<ToolResult> {
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse('Param [recipe_id] must be a finite number');
      }
      const jobId = args?.job_id;
      if (
        jobId === undefined ||
        jobId === null ||
        (typeof jobId === 'string' && jobId.trim() === '') ||
        (typeof jobId === 'number' && !Number.isFinite(jobId))
      ) {
        return createErrorResponse('Param [job_id] must be a non-empty string or finite number');
      }
      const full = args.full === true;

      const tab = await findWorkatoTab(args.tabId);
      const result = await runInWorkatoTab(tab.tabId, tracePageFn, [args.recipe_id, jobId]);

      if (!result.ok) {
        return createErrorResponse(
          `WorkatoApiError (${result.failure?.stage}): ${result.failure?.message}` +
            (result.failure?.body_excerpt
              ? `\n--- body excerpt ---\n${result.failure.body_excerpt}`
              : ''),
        );
      }

      const payload = full
        ? { job_id: jobId, meta: result.meta, line_details: result.lineDetails }
        : buildSlimTrace(jobId, result.meta!, result.lineDetails!);

      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_job_trace failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoJobTraceTool = new WorkatoJobTraceTool();
