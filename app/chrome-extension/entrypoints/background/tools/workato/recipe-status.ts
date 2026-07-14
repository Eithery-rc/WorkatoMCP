import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';

/**
 * workato_recipe_status — the cheap post-write verification read.
 *
 * GET /recipes/<id>.json returns ~4 KB of metadata (no code tree). We slim it
 * to the handful of fields an agent needs to answer "did my start/stop/save
 * take effect?": running, state, version_no, last_run_at.
 *
 * Also exported for internal reuse: recipe-lifecycle.ts and
 * set-version-comment.ts use fetchRecipeStatusInPage to verify state after a
 * write times out, and to implement wait:true polling.
 */

export interface RecipeStatusSlim {
  recipe_id: number;
  name: string;
  running: boolean;
  state: string;
  version_no: number;
  last_run_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
  stopped_for_error: unknown;
  job_succeeded_count: number;
  job_failed_count: number;
}

interface StatusInPageResult {
  ok: boolean;
  status?: RecipeStatusSlim;
  failure?: {
    stage: 'fetch' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

/**
 * Runs in the Workato tab's MAIN world. Self-contained, promise-chain based
 * (see pull-recipe.ts for why async/await is forbidden here).
 */
export function fetchRecipeStatusInPage(recipeId: number): Promise<StatusInPageResult> {
  return fetch(`/recipes/${recipeId}.json`, {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  }).then((r) =>
    r.text().then((bodyText) => {
      if (r.status < 200 || r.status >= 300) {
        return {
          ok: false,
          failure: {
            stage: 'fetch' as const,
            status: r.status,
            body_excerpt: bodyText.slice(0, 512),
            message: `GET /recipes/${recipeId}.json returned HTTP ${r.status}`,
          },
        };
      }
      let json: unknown = null;
      try {
        json = JSON.parse(bodyText);
      } catch (e) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 512),
            message: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        };
      }
      const flow = (json as any)?.result?.recipe_data?.flow;
      const rd = (json as any)?.result?.recipe_data;
      if (!flow || typeof flow !== 'object') {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: JSON.stringify(json).slice(0, 512),
            message: 'Unexpected response shape — missing result.recipe_data.flow.',
          },
        };
      }
      return {
        ok: true,
        status: {
          recipe_id: recipeId,
          name: String(flow.name ?? ''),
          running: Boolean(rd?.running ?? flow.running),
          state: String(rd?.state ?? flow.state ?? 'unknown'),
          version_no: Number(flow.version_no ?? 0),
          last_run_at: flow.last_run_at != null ? String(flow.last_run_at) : null,
          stopped_at: flow.stopped_at != null ? String(flow.stopped_at) : null,
          stop_reason: flow.stop_reason != null ? String(flow.stop_reason) : null,
          stopped_for_error: flow.stopped_for_error ?? null,
          job_succeeded_count: Number(flow.job_succeeded_count ?? 0),
          job_failed_count: Number(flow.job_failed_count ?? 0),
        },
      };
    }),
  );
}

/** Fetch slim recipe status from the tool layer. Throws WorkatoDispatchError on transport failure. */
export async function fetchRecipeStatus(
  tabId: number,
  recipeId: number,
): Promise<RecipeStatusSlim> {
  const result = await runInWorkatoTab(tabId, fetchRecipeStatusInPage, [recipeId], {
    timeoutMs: 15_000,
  });
  if (!result.ok || !result.status) {
    throw new WorkatoDispatchError(
      'UnexpectedShape',
      `recipe status fetch failed (${result.failure?.stage}): ${result.failure?.message ?? 'unknown'}`,
    );
  }
  return result.status;
}

class WorkatoRecipeStatusTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.RECIPE_STATUS;

  async execute(args: { recipe_id: number; tabId?: number }): Promise<ToolResult> {
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse('Param [recipe_id] must be a finite number');
      }
      const tab = await findWorkatoTab(args.tabId);
      const status = await fetchRecipeStatus(tab.tabId, args.recipe_id);
      return {
        content: [{ type: 'text', text: JSON.stringify(status) }],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_recipe_status failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoRecipeStatusTool = new WorkatoRecipeStatusTool();
