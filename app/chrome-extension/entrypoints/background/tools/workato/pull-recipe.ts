import { TOOL_NAMES } from 'chrome-mcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';

interface PullRecipeArgs {
  recipe_id: number;
}

interface InPageResult {
  ok: boolean;
  /** present when ok=true */
  code?: unknown;
  version?: {
    version_no: number;
    name: string;
    folder_id: number;
    config: string;
    visibility_private: boolean;
    description: string;
    worker_concurrency: number;
    job_data_retention_policy: string;
  };
  /** present when ok=false */
  failure?: {
    stage: 'meta' | 'code' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

/**
 * Function executed in the Workato tab's MAIN world. MUST be self-contained
 * and MUST NOT use `async`/`await` — WXT/Vite rewrites async function
 * declarations into a sync wrapper that calls a hoisted `_<name>` helper.
 * Only the wrapper survives `Function.prototype.toString()`, so the helper
 * reference dangles in the page context ("ReferenceError: _pullInPage is not
 * defined"). Promise chains pass through the bundler untouched.
 */
function pullInPage(recipeId: number): Promise<InPageResult> {
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
          /* keep raw body for diagnostics */
        }
        return { status: r.status, bodyText, json };
      }),
    );

  return fetchAndParse(`/recipes/${recipeId}.json?error_format=json`).then((meta) => {
    if (meta.status < 200 || meta.status >= 300) {
      return {
        ok: false,
        failure: {
          stage: 'meta' as const,
          status: meta.status,
          body_excerpt: meta.bodyText.slice(0, 1024),
          message: `GET /recipes/${recipeId}.json returned HTTP ${meta.status}`,
        },
      };
    }

    return fetchAndParse(
      `/recipes/${recipeId}/code.json?mode=view&hideHeader=false&noBorderRadius=false&banHotkeys=false`,
    ).then((code) => {
      if (code.status < 200 || code.status >= 300) {
        return {
          ok: false,
          failure: {
            stage: 'code' as const,
            status: code.status,
            body_excerpt: code.bodyText.slice(0, 1024),
            message: `GET /recipes/${recipeId}/code.json returned HTTP ${code.status}`,
          },
        };
      }

      // Shape: meta.result.recipe_data.flow.{version_no,name,folder_id,config,...}
      //        code.result === "<stringified JSON of code tree>"
      const flow = (meta.json as any)?.result?.recipe_data?.flow;
      const codeStr = (code.json as any)?.result;
      if (!flow || typeof codeStr !== 'string') {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: JSON.stringify({
              meta_keys: Object.keys((meta.json as any) ?? {}),
              code_keys: Object.keys((code.json as any) ?? {}),
            }).slice(0, 1024),
            message:
              'Unexpected response shape — missing result.recipe_data.flow or result string. ' +
              'Workato API may have drifted; check SKILL.md.',
          },
        };
      }

      let parsedCode: unknown;
      try {
        parsedCode = JSON.parse(codeStr);
      } catch (e) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: codeStr.slice(0, 1024),
            message: `JSON.parse(code.result) failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        };
      }

      const versionNo = Number(flow.version_no);
      if (!Number.isFinite(versionNo) || versionNo <= 0) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: JSON.stringify({ version_no: flow.version_no }).slice(0, 1024),
            message:
              `result.recipe_data.flow.version_no is not a positive finite number ` +
              `(got ${JSON.stringify(flow.version_no)}). Workato API may have drifted.`,
          },
        };
      }

      return {
        ok: true,
        code: parsedCode,
        version: {
          version_no: versionNo,
          name: String(flow.name ?? ''),
          folder_id: Number(flow.folder_id),
          config: typeof flow.config === 'string' ? flow.config : JSON.stringify(flow.config ?? {}),
          visibility_private: Boolean(flow.visibility_private),
          description: String(flow.description ?? ''),
          worker_concurrency: Number(flow.worker_concurrency ?? 1),
          job_data_retention_policy: String(flow.job_data_retention_policy ?? 'default'),
        },
      };
    });
  });
}

class WorkatoPullRecipeTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.PULL_RECIPE;

  async execute(args: PullRecipeArgs): Promise<ToolResult> {
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse('Param [recipe_id] must be a finite number');
      }

      const tab = await findWorkatoTab();
      const result = await runInWorkatoTab(tab.tabId, pullInPage, [args.recipe_id]);

      if (!result.ok) {
        return createErrorResponse(
          `WorkatoApiError (${result.failure?.stage}): ${result.failure?.message}` +
            (result.failure?.body_excerpt
              ? `\n--- body excerpt ---\n${result.failure.body_excerpt}`
              : ''),
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              recipe_id: args.recipe_id,
              code: result.code,
              version: result.version,
            }),
          },
        ],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_pull_recipe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoPullRecipeTool = new WorkatoPullRecipeTool();
