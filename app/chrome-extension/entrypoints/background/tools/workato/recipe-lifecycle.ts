import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';

type RecipeLifecycleAction = 'start' | 'stop';

interface RecipeLifecycleArgs {
  recipe_id: number;
  force?: boolean;
  tabId?: number;
}

interface RecipeLifecycleSuccess {
  ok: true;
  recipe_id: number;
  action: RecipeLifecycleAction;
  status: string;
}

interface RecipeLifecycleFailure {
  ok: false;
  failure: {
    stage: 'csrf' | 'lifecycle' | 'shape' | 'workato';
    status?: number;
    body_excerpt?: string;
    message: string;
    details?: unknown;
  };
}

type RecipeLifecycleResult = RecipeLifecycleSuccess | RecipeLifecycleFailure;

/**
 * Runs in the Workato tab's MAIN world. Keep this function self-contained and
 * Promise-chain based so it can be passed through chrome.scripting.executeScript.
 */
export function changeRecipeLifecycleInPage(
  recipeId: number,
  action: RecipeLifecycleAction,
  force: boolean,
): Promise<RecipeLifecycleResult> {
  function readCookie(n: string): string | null {
    const escaped = n.replace(/[-.+*]/g, '\\$&');
    const m = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  let csrf = readCookie('XSRF-TOKEN-V2') || readCookie('XSRF-TOKEN') || readCookie('csrf-token');
  if (!csrf) {
    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    csrf = csrfMeta && csrfMeta.getAttribute('content');
  }
  if (!csrf) {
    return Promise.resolve({
      ok: false,
      failure: {
        stage: 'csrf',
        message:
          'could not find CSRF token in XSRF-TOKEN-V2 cookie or meta tag; ensure the active tab is a logged-in Workato page',
      },
    });
  }

  const body = action === 'stop' && force ? { force: true } : {};

  return fetch(`/web_api/recipes/${recipeId}/${action}.json`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf-token': csrf,
      'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify(body),
  }).then((r) =>
    r.text().then((bodyText) => {
      let json: unknown = null;
      try {
        json = bodyText.length > 0 ? JSON.parse(bodyText) : {};
      } catch (e) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            status: r.status,
            body_excerpt: bodyText.slice(0, 1024),
            message: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        };
      }

      const workatoError = (json as any)?.error;
      if (workatoError) {
        return {
          ok: false,
          failure: {
            stage: 'workato' as const,
            message: `Workato returned an error while trying to ${action} recipe ${recipeId}`,
            details: workatoError.details ?? workatoError,
          },
        };
      }

      if (r.status < 200 || r.status >= 300) {
        return {
          ok: false,
          failure: {
            stage: 'lifecycle' as const,
            status: r.status,
            body_excerpt: bodyText.slice(0, 1024),
            message: `POST /web_api/recipes/${recipeId}/${action}.json returned HTTP ${r.status}`,
          },
        };
      }

      const status = (json as any)?.status;
      if (typeof status !== 'string') {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: JSON.stringify(json).slice(0, 1024),
            message: 'Unexpected response shape - missing status string.',
          },
        };
      }

      return {
        ok: true,
        recipe_id: recipeId,
        action,
        status,
      };
    }),
  );
}

abstract class WorkatoRecipeLifecycleTool extends BaseBrowserToolExecutor {
  protected abstract readonly action: RecipeLifecycleAction;

  async execute(args: RecipeLifecycleArgs): Promise<ToolResult> {
    try {
      if (typeof args?.recipe_id !== 'number' || !Number.isFinite(args.recipe_id)) {
        return createErrorResponse('Param [recipe_id] must be a finite number');
      }

      const force = this.action === 'stop' && args.force === true;
      const tab = await findWorkatoTab(args.tabId);
      const result = await runInWorkatoTab(tab.tabId, changeRecipeLifecycleInPage, [
        args.recipe_id,
        this.action,
        force,
      ]);

      if (!result.ok) {
        const details =
          result.failure.details !== undefined
            ? `\n--- details ---\n${JSON.stringify(result.failure.details)}`
            : '';
        return createErrorResponse(
          `WorkatoApiError (${result.failure.stage}): ${result.failure.message}` +
            (result.failure.body_excerpt
              ? `\n--- body excerpt ---\n${result.failure.body_excerpt}`
              : '') +
            details,
        );
      }

      const payload = {
        recipe_id: result.recipe_id,
        action: result.action,
        status: result.status,
        force,
      };
      return {
        content: [
          {
            type: 'text',
            text:
              `${result.action} recipe ${result.recipe_id}: ${result.status}` +
              `\n${JSON.stringify(payload)}`,
          },
        ],
        isError: false,
      };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `${this.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

class WorkatoStartRecipeTool extends WorkatoRecipeLifecycleTool {
  name = TOOL_NAMES.WORKATO.START_RECIPE;
  protected readonly action = 'start';
}

class WorkatoStopRecipeTool extends WorkatoRecipeLifecycleTool {
  name = TOOL_NAMES.WORKATO.STOP_RECIPE;
  protected readonly action = 'stop';
}

export const workatoStartRecipeTool = new WorkatoStartRecipeTool();
export const workatoStopRecipeTool = new WorkatoStopRecipeTool();
