import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';
import { buildSlimRecipe, type RecipeListItem } from './slim-asset';

interface SearchRecipesArgs {
  text?: string;
  folder_id?: number;
  page?: number;
  sort?: 'latest_activity' | 'name' | 'updated_at' | 'created_at';
  full?: boolean;
}

interface RawSearchResponse {
  result?: {
    items?: unknown[];
    count?: number;
    page?: number;
    per_page?: number;
  };
}

interface InPageResult {
  ok: boolean;
  raw?: RawSearchResponse;
  failure?: {
    stage: 'search' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

/**
 * Runs in the Workato tab's MAIN world. Plain function returning a Promise
 * chain — DO NOT add async/await (see workato/csrf.ts comment + v1 pitfalls).
 */
function searchRecipesInPage(
  text: string,
  folderId: number | null,
  page: number,
  sort: string,
): Promise<InPageResult> {
  const params = new URLSearchParams();
  params.set('asset_type', 'recipe');
  params.set('sort_term', sort);
  params.set('page', String(page));
  if (text) params.set('text', text);
  if (folderId !== null) params.set('folder_id', String(folderId));
  const url = `/web_api/mixed_assets.json?${params.toString()}`;
  const fetchOpts: RequestInit = {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  };

  return fetch(url, fetchOpts).then((r) =>
    r.text().then((bodyText) => {
      if (r.status < 200 || r.status >= 300) {
        return {
          ok: false,
          failure: {
            stage: 'search' as const,
            status: r.status,
            body_excerpt: bodyText.slice(0, 1024),
            message: `GET ${url} returned HTTP ${r.status}`,
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
            body_excerpt: bodyText.slice(0, 1024),
            message: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        };
      }
      const result = (json as RawSearchResponse).result;
      if (!result || !Array.isArray(result.items)) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 1024),
            message: 'Unexpected response shape — missing result.items array.',
          },
        };
      }
      return { ok: true, raw: json as RawSearchResponse };
    }),
  );
}

class WorkatoSearchRecipesTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.SEARCH_RECIPES;

  async execute(args: SearchRecipesArgs): Promise<ToolResult> {
    try {
      const text = typeof args?.text === 'string' ? args.text : '';
      const folderId =
        typeof args?.folder_id === 'number' && Number.isFinite(args.folder_id)
          ? args.folder_id
          : null;
      const page =
        typeof args?.page === 'number' && Number.isFinite(args.page) && args.page >= 1
          ? Math.floor(args.page)
          : 1;
      const sort = args?.sort ?? 'latest_activity';
      const full = args?.full === true;

      const tab = await findWorkatoTab();
      const result = await runInWorkatoTab(tab.tabId, searchRecipesInPage, [
        text,
        folderId,
        page,
        sort,
      ]);

      if (!result.ok) {
        return createErrorResponse(
          `WorkatoApiError (${result.failure?.stage}): ${result.failure?.message}` +
            (result.failure?.body_excerpt
              ? `\n--- body excerpt ---\n${result.failure.body_excerpt}`
              : ''),
        );
      }

      const raw = result.raw!.result!;
      const payload = full
        ? raw
        : {
            count: Number(raw.count ?? 0),
            page: Number(raw.page ?? page),
            per_page: Number(raw.per_page ?? 20),
            recipes: (raw.items ?? []).map((item) => buildSlimRecipe(item as RecipeListItem)),
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
        `workato_search_recipes failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoSearchRecipesTool = new WorkatoSearchRecipesTool();
