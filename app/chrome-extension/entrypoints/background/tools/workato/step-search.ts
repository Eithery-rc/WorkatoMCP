import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';
import { stripConnectionSecrets } from './strip-secrets';

/**
 * workato_recipe_step_search — find how a connector is actually used HERE.
 *
 * workato_adapter_meta says what a field is called and what it accepts. It
 * cannot say what a working value looks like: which datapill shape the team
 * uses, which optional fields they always set, how they format a NetSuite
 * internal id. That knowledge only exists in the recipes already running in
 * the workspace, and reading it was a manual loop of search_recipes →
 * pull_recipe → scroll → repeat.
 *
 * The list endpoint makes the search cheap: every item in
 * /web_api/mixed_assets.json?asset_type=recipe already carries
 * `trigger_application` and `action_applications`, so candidate recipes are
 * identified without opening any of them. (No server-side adapter filter was
 * found — five plausible parameter names were tried and all silently returned
 * the full list — so the filter is applied client-side against those fields,
 * which is exact.)
 *
 * Returned `input` blocks are templates, not values to copy blindly: they
 * carry datapills bound to THAT recipe's steps. Connection secrets are
 * stripped on the way out.
 */

interface StepSearchArgs {
  /** Adapter name to look for, e.g. "salesforce", "email". Matches step.provider. */
  provider: string;
  /** Optional action/trigger name, e.g. "send_mail". Matches step.name exactly (case-insensitive). */
  action?: string;
  /** Max matching steps returned. Default 5, clamped 1–25. */
  limit?: number;
  /** Max recipes whose code is read. Default 8, clamped 1–25. */
  max_recipes?: number;
  /** Pages of the recipe list to scan, 20 per page. Default 5, clamped 1–25. */
  max_pages?: number;
  /** In-page fetch timeout. Default 45000, clamped 10000–110000. */
  timeout_ms?: number;
  tabId?: number;
}

interface CandidateCode {
  recipe_id: number;
  recipe_name: string;
  folder_id?: number;
  /** Raw recipe code JSON string, as returned inside code.json's `result`. */
  code: string;
}

interface InPageResult {
  ok: boolean;
  /** Recipes whose code was read and cheaply prefiltered. */
  candidates?: CandidateCode[];
  /** How many recipes the list scan flagged as using this provider. */
  flagged?: number;
  /** How many recipe list pages were actually read. */
  pages_scanned?: number;
  failure?: { stage: 'list' | 'code' | 'shape'; status?: number; message: string };
}

/**
 * Runs in the Workato tab's MAIN world. Self-contained, promise-chain based —
 * DO NOT add async/await (WXT/Vite rewrites it into a hoisted helper that does
 * not survive Function.prototype.toString; see pull-recipe.ts).
 *
 * Does the fetching and a cheap substring prefilter only. The structural walk
 * that decides what counts as a matching step lives in the background script,
 * where it is unit-tested.
 */
function fetchStepCandidatesInPage(
  provider: string,
  maxPages: number,
  maxRecipes: number,
): Promise<InPageResult> {
  const opts: RequestInit = {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  };
  const needle = `"provider":"${provider}"`;

  function listPage(page: number): Promise<{ items: unknown[]; ok: boolean; message?: string }> {
    const url = `/web_api/mixed_assets.json?asset_type=recipe&sort_term=latest_activity&page=${page}`;
    return fetch(url, opts).then((r) =>
      r.text().then((body) => {
        if (r.status < 200 || r.status >= 300) {
          return { items: [], ok: false, message: `GET ${url} returned HTTP ${r.status}` };
        }
        try {
          const json = JSON.parse(body) as { result?: { items?: unknown[] } };
          const items = json.result && Array.isArray(json.result.items) ? json.result.items : [];
          return { items: items, ok: true };
        } catch (e) {
          return {
            items: [],
            ok: false,
            message: `GET ${url}: JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      }),
    );
  }

  /** A recipe uses the provider when it is its trigger app or one of its action apps. */
  function usesProvider(item: unknown): boolean {
    if (!item || typeof item !== 'object') return false;
    const rec = item as Record<string, unknown>;
    if (rec.trigger_application === provider) return true;
    return Array.isArray(rec.action_applications) && rec.action_applications.indexOf(provider) >= 0;
  }

  function collectPages(
    page: number,
    flagged: Record<string, unknown>[],
  ): Promise<{ flagged: Record<string, unknown>[]; pages: number; message?: string }> {
    return listPage(page).then((res) => {
      if (!res.ok && page === 1) return { flagged: flagged, pages: page, message: res.message };
      for (let i = 0; i < res.items.length; i++) {
        if (usesProvider(res.items[i])) flagged.push(res.items[i] as Record<string, unknown>);
      }
      if (res.items.length === 0 || page >= maxPages) {
        return { flagged: flagged, pages: page };
      }
      return collectPages(page + 1, flagged);
    });
  }

  function fetchCode(item: Record<string, unknown>): Promise<CandidateCode | null> {
    const id = Number(item.id);
    const url = `/recipes/${id}/code.json?mode=view&hideHeader=false&noBorderRadius=false&banHotkeys=false`;
    return fetch(url, opts).then(
      (r) =>
        r.text().then((body) => {
          if (r.status < 200 || r.status >= 300) return null;
          try {
            const json = JSON.parse(body) as { result?: unknown };
            const code =
              typeof json.result === 'string' ? json.result : JSON.stringify(json.result);
            // Cheap prefilter: a recipe flagged by the list can still hold no
            // step for this provider (the flag covers the trigger too).
            if (!code || code.indexOf(needle) < 0) return null;
            return {
              recipe_id: id,
              recipe_name: String(item.name ?? ''),
              folder_id: item.folder_id === undefined ? undefined : Number(item.folder_id),
              code: code,
            };
          } catch (e) {
            return null;
          }
        }),
      () => null,
    );
  }

  // Sequential, not Promise.all: a workspace can flag dozens of recipes and
  // this stops as soon as enough have real matches.
  function walkCandidates(
    queue: Record<string, unknown>[],
    index: number,
    acc: CandidateCode[],
  ): Promise<CandidateCode[]> {
    if (index >= queue.length || acc.length >= maxRecipes) return Promise.resolve(acc);
    return fetchCode(queue[index]).then((hit) => {
      if (hit) acc.push(hit);
      return walkCandidates(queue, index + 1, acc);
    });
  }

  return collectPages(1, []).then((listed) => {
    if (listed.message && listed.flagged.length === 0) {
      return { ok: false, failure: { stage: 'list' as const, message: listed.message } };
    }
    return walkCandidates(listed.flagged, 0, []).then((candidates) => ({
      ok: true,
      candidates: candidates,
      flagged: listed.flagged.length,
      pages_scanned: listed.pages,
    }));
  });
}

// ---------------------------------------------------------------------------
// Pure shaping helpers. Exported for unit tests — no browser needed.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Keys the connection stripper denies by default but a STEP must show.
 *
 * A connection's `url` can embed credentials, which is why it is denied there.
 * A step's `url` is the endpoint being called — the single most useful line of
 * an HTTP or custom-REST example, and worthless to return blanked. Credentials
 * left in the userinfo part are redacted by the stripper.
 */
const STEP_VISIBLE_KEYS: ReadonlySet<string> = new Set(['url', 'uri', 'path', 'endpoint']);

export interface StepHit {
  recipe_id: number;
  recipe_name: string;
  folder_id?: number;
  /** Step number as the editor shows it. 0 is the trigger. */
  step_number?: number;
  /** "action", "trigger", "if", "repeat_each", … */
  keyword?: string;
  provider: string;
  /** Action or trigger name — what goes into step.name. */
  name?: string;
  /** The step's `as` anchor, which datapills in later steps refer to. */
  as?: string;
  description?: string;
  /** The step's configured input — the actual template being looked for. */
  input?: unknown;
  /** True when this step declares its own schema rather than taking the adapter's. */
  has_extended_schema?: boolean;
  /** True when the step is disabled in that recipe, so it is a weaker example. */
  skip?: boolean;
}

/**
 * Walk a parsed recipe code tree and collect every step for `provider`.
 *
 * Generic on purpose: it recurses through any nested array, so steps inside
 * if / repeat_each / try blocks are found at any depth without hard-coding the
 * block key names, which differ between control-flow keywords.
 */
export function collectMatchingSteps(
  node: unknown,
  provider: string,
  action: string | null,
): Omit<StepHit, 'recipe_id' | 'recipe_name' | 'folder_id'>[] {
  const out: Omit<StepHit, 'recipe_id' | 'recipe_name' | 'folder_id'>[] = [];
  const wantedAction = action?.toLowerCase() ?? null;

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (!isRecord(value)) return;

    // A step always carries a keyword ("trigger" for the root, "action",
    // "if", "repeat_each", ...). A recipe's `config` entries carry `provider`
    // too, under keyword "application" — those are connection bindings, not
    // steps, and returning one as an example would be nonsense.
    const keyword = typeof value.keyword === 'string' ? value.keyword : null;
    if (value.provider === provider && keyword !== null && keyword !== 'application') {
      const stepName = typeof value.name === 'string' ? value.name : undefined;
      if (wantedAction === null || stepName?.toLowerCase() === wantedAction) {
        const hit: Omit<StepHit, 'recipe_id' | 'recipe_name' | 'folder_id'> = { provider };
        if (typeof value.number === 'number') hit.step_number = value.number;
        hit.keyword = keyword;
        if (value.skip === true) hit.skip = true;
        if (stepName !== undefined) hit.name = stepName;
        if (typeof value.as === 'string') hit.as = value.as;
        if (typeof value.description === 'string') hit.description = value.description;
        if (value.input !== undefined) {
          hit.input = stripConnectionSecrets(value.input, { allowKeys: STEP_VISIBLE_KEYS });
        }
        if (
          value.extended_input_schema !== undefined ||
          value.extended_output_schema !== undefined
        ) {
          hit.has_extended_schema = true;
        }
        out.push(hit);
      }
    }

    // Keep descending regardless: a matching step can nest inside another
    // step's block, and `input` can hold provider-shaped data that is not a step.
    for (const [key, child] of Object.entries(value)) {
      if (key === 'input' || key === 'extended_input_schema' || key === 'extended_output_schema') {
        continue;
      }
      if (Array.isArray(child) || isRecord(child)) visit(child);
    }
  };

  visit(node);
  return out;
}

/** Parse one candidate's code string and attach the recipe identity to each hit. */
export function hitsForCandidate(
  candidate: CandidateCode,
  provider: string,
  action: string | null,
): StepHit[] {
  let tree: unknown;
  try {
    tree = JSON.parse(candidate.code);
  } catch {
    return [];
  }
  return collectMatchingSteps(tree, provider, action).map((hit) => ({
    recipe_id: candidate.recipe_id,
    recipe_name: candidate.recipe_name,
    ...(candidate.folder_id === undefined ? {} : { folder_id: candidate.folder_id }),
    ...hit,
  }));
}

class WorkatoRecipeStepSearchTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.RECIPE_STEP_SEARCH;

  async execute(args: StepSearchArgs): Promise<ToolResult> {
    try {
      const provider = typeof args?.provider === 'string' ? args.provider.trim() : '';
      if (provider.length === 0) {
        return createErrorResponse(
          'Param [provider] must be a non-empty adapter name, e.g. "salesforce", "email", ' +
            '"netsuite_rest_connector_5105163_1745592003". Use workato_apps_list to find it.',
        );
      }
      if (args.action != null && typeof args.action !== 'string') {
        return createErrorResponse('Param [action] must be a string action/trigger name');
      }

      const action = args.action?.trim() || null;
      const limit = Math.min(Math.max(args.limit ?? 5, 1), 25);
      const maxRecipes = Math.min(Math.max(args.max_recipes ?? 8, 1), 25);
      const maxPages = Math.min(Math.max(args.max_pages ?? 5, 1), 25);
      const timeoutMs = Math.min(Math.max(args.timeout_ms ?? 45_000, 10_000), 110_000);

      const tab = await findWorkatoTab(args.tabId);
      const result = await runInWorkatoTab(
        tab.tabId,
        fetchStepCandidatesInPage,
        [provider, maxPages, maxRecipes],
        { timeoutMs },
      );

      if (!result.ok) {
        return createErrorResponse(
          `workato_recipe_step_search (${result.failure?.stage}): ${result.failure?.message}`,
        );
      }

      const candidates = result.candidates ?? [];
      const hits: StepHit[] = [];
      for (const candidate of candidates) {
        for (const hit of hitsForCandidate(candidate, provider, action)) {
          hits.push(hit);
          if (hits.length >= limit) break;
        }
        if (hits.length >= limit) break;
      }

      const payload: Record<string, unknown> = {
        provider,
        ...(action === null ? {} : { action }),
        count: hits.length,
        recipes_flagged: result.flagged ?? 0,
        recipes_read: candidates.length,
        pages_scanned: result.pages_scanned ?? 0,
        steps: hits,
      };

      if (hits.length === 0) {
        payload.hint =
          (result.flagged ?? 0) === 0
            ? `No recipe in the first ${result.pages_scanned ?? 0} page(s) of the recipe list uses ` +
              `"${provider}". This connector may simply never have been used here — that is not an ` +
              'error, and workato_adapter_meta still describes it in full. Raise max_pages if the ' +
              'workspace has more recipes than were scanned.'
            : `${result.flagged} recipe(s) are tagged with "${provider}" but no step matched` +
              (action === null
                ? '. The tag can come from the trigger app alone.'
                : ` action "${action}". Call again without [action] to see which of its operations ARE used here.`);
      }

      return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_recipe_step_search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoRecipeStepSearchTool = new WorkatoRecipeStepSearchTool();
