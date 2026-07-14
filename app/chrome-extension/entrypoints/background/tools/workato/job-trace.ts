import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';
import {
  buildSlimTrace,
  stripSchemaNoise,
  type RawMetaResponse,
  type RawLineDetailsResponse,
} from './slim-trace';

interface JobTraceArgs {
  recipe_id: number;
  job_id: string | number;
  full?: boolean;
  /** Only return steps whose recipe_line_number is in this exact set. */
  lines?: number[];
  /** Only return steps whose recipe_line_number falls in [from, to] inclusive. */
  line_range?: [number, number];
  /**
   * 'summary' (default): truncated input/output summaries.
   * 'full': exact, untruncated (schema-stripped) input/output — requires
   * [lines] or [line_range] selecting at most 20 steps.
   */
  detail?: 'summary' | 'full';
  /** In-page script timeout. Default 30000, clamped 10000–110000. Raise for huge traces. */
  timeout_ms?: number;
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

      // Line selection: exact set and/or inclusive range.
      const lineSet =
        Array.isArray(args.lines) && args.lines.length > 0
          ? new Set(args.lines.filter((n) => typeof n === 'number' && Number.isFinite(n)))
          : null;
      const range =
        Array.isArray(args.line_range) &&
        args.line_range.length === 2 &&
        typeof args.line_range[0] === 'number' &&
        typeof args.line_range[1] === 'number'
          ? ([args.line_range[0], args.line_range[1]] as [number, number])
          : null;
      const hasSelection = lineSet !== null || range !== null;
      const lineSelected = (n: number): boolean => {
        if (!hasSelection) return true;
        if (lineSet?.has(n)) return true;
        if (range && n >= range[0] && n <= range[1]) return true;
        return false;
      };
      const detail = args.detail === 'full' ? 'full' : 'summary';
      if (detail === 'full' && !hasSelection) {
        return createErrorResponse(
          "detail:'full' requires [lines] or [line_range] — select the specific step(s) you need " +
            '(max 20) to avoid flooding the response with a whole trace of untruncated payloads.',
        );
      }

      const timeoutMs = Math.min(Math.max(args.timeout_ms ?? 30_000, 10_000), 110_000);
      const tab = await findWorkatoTab(args.tabId);
      const result = await runInWorkatoTab(tab.tabId, tracePageFn, [args.recipe_id, jobId], {
        timeoutMs,
      });

      if (!result.ok) {
        return createErrorResponse(
          `WorkatoApiError (${result.failure?.stage}): ${result.failure?.message}` +
            (result.failure?.body_excerpt
              ? `\n--- body excerpt ---\n${result.failure.body_excerpt}`
              : ''),
        );
      }

      let payload: unknown;
      if (full) {
        payload = { job_id: jobId, meta: result.meta, line_details: result.lineDetails };
      } else if (detail === 'full') {
        const selected = (result.lineDetails?.line_details ?? []).filter((l) =>
          lineSelected(Number(l.recipe_line_number ?? -1)),
        );
        if (selected.length > 20) {
          return createErrorResponse(
            `detail:'full' selection matched ${selected.length} steps — narrow [lines]/[line_range] to at most 20.`,
          );
        }
        const slim = buildSlimTrace(jobId, result.meta!, result.lineDetails!);
        payload = {
          ...slim,
          steps: selected.map((l) => ({
            recipe_line_number: Number(l.recipe_line_number ?? -1),
            adapter_name: String(l.adapter_name ?? ''),
            adapter_operation: String(l.adapter_operation ?? ''),
            input: stripSchemaNoise(l.input),
            output: stripSchemaNoise(l.output),
          })),
        };
      } else {
        const slim = buildSlimTrace(jobId, result.meta!, result.lineDetails!);
        payload = hasSelection
          ? { ...slim, steps: slim.steps.filter((s) => lineSelected(s.recipe_line_number)) }
          : slim;
      }

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
