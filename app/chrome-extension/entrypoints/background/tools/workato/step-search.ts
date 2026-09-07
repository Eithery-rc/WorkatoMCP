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
 * Scope: workspace-wide by default, one or more folders with folder_ids
 * (server-supported and non-recursive), or an explicit recipe_ids list that
 * skips the listing entirely.
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
  /** Folders to scan, non-recursive. Omit to scan the workspace list. */
  folder_ids?: number[];
  /** Read exactly these recipes and skip the listing entirely. */
  recipe_ids?: number[];
  /** Keep only steps whose serialized input matches this. */
  input_query?: string;
  /** How input_query is compared. Default substring (case-insensitive). */
  input_match?: 'substring' | 'regex';
  /** Serialized input longer than this comes back as a preview. Default 2000, 0 = unbounded. */
  preview_chars?: number;
  /** Max matching steps returned. Default 5, clamped 1–25. */
  limit?: number;
  /** Max recipes whose code is read. Default 8, clamped 1–25. */
  max_recipes?: number;
  /** Pages of the recipe list to scan per folder, 20 per page. Default 5, clamped 1-25. */
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

/** Single JSON-serializable argument for the in-page candidate walk. */
export interface StepSearchWalkOptions {
  provider: string;
  maxPages: number;
  maxRecipes: number;
  /** Empty = scan the workspace list. */
  folderIds: number[];
  /** Non-empty = read exactly these recipes and skip the listing. */
  recipeIds: number[];
}

export interface StepSearchWalkResult {
  ok: boolean;
  /** Recipes whose code was read and cheaply prefiltered. */
  candidates?: CandidateCode[];
  /** How many recipes the list scan flagged as using this provider. */
  flagged?: number;
  /** How many recipe list pages were actually read. */
  pages_scanned?: number;
  folders_scanned?: number;
  recipes_requested?: number;
  /** True when a page failed mid-walk: the scan stopped short of the list end. */
  incomplete?: boolean;
  incomplete_reason?: string;
  /** True when max_pages stopped a scope while its list still had full pages. */
  pages_truncated?: boolean;
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
export function fetchStepCandidatesInPage(
  opts: StepSearchWalkOptions,
): Promise<StepSearchWalkResult> {
  const PER_PAGE = 20;
  const provider = opts.provider;
  const maxPages = opts.maxPages;
  const maxRecipes = opts.maxRecipes;
  const folderIds = Array.isArray(opts.folderIds) ? opts.folderIds : [];
  const recipeIds = Array.isArray(opts.recipeIds) ? opts.recipeIds : [];
  const fetchOpts: RequestInit = {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  };
  const needle = `"provider":"${provider}"`;
  const state = {
    pages: 0,
    incomplete: false,
    pagesTruncated: false,
    reason: undefined as string | undefined,
  };

  function listPage(
    page: number,
    folderId: number | null,
  ): Promise<{ items: unknown[]; ok: boolean; message?: string }> {
    let url = `/web_api/mixed_assets.json?asset_type=recipe&sort_term=latest_activity&page=${page}`;
    if (folderId !== null) url = `${url}&folder_id=${folderId}`;
    return fetch(url, fetchOpts).then((r) =>
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

  function collectFolderPages(
    page: number,
    pagesDone: number,
    folderId: number | null,
    flagged: Record<string, unknown>[],
  ): Promise<{ fatal?: string }> {
    return listPage(page, folderId).then((res) => {
      if (!res.ok) {
        // First page ever: a real error. Later page: the scan stopped short,
        // which must NOT be reported as the end of the list.
        if (state.pages === 0) return { fatal: res.message };
        state.incomplete = true;
        state.reason = res.message;
        return {};
      }
      state.pages++;
      for (let i = 0; i < res.items.length; i++) {
        if (usesProvider(res.items[i])) flagged.push(res.items[i] as Record<string, unknown>);
      }
      if (res.items.length < PER_PAGE) return {};
      if (pagesDone + 1 >= maxPages) {
        state.pagesTruncated = true;
        return {};
      }
      return collectFolderPages(page + 1, pagesDone + 1, folderId, flagged);
    });
  }

  function collectScopes(
    index: number,
    flagged: Record<string, unknown>[],
  ): Promise<{ flagged: Record<string, unknown>[]; fatal?: string }> {
    if (folderIds.length === 0) {
      return collectFolderPages(1, 0, null, flagged).then((res) => ({
        flagged: flagged,
        fatal: res.fatal,
      }));
    }
    if (index >= folderIds.length) return Promise.resolve({ flagged: flagged });
    return collectFolderPages(1, 0, folderIds[index], flagged).then((res) => {
      if (res.fatal) return { flagged: flagged, fatal: res.fatal };
      return collectScopes(index + 1, flagged);
    });
  }

  function fetchCode(item: Record<string, unknown>): Promise<CandidateCode | null> {
    const id = Number(item.id);
    const url = `/recipes/${id}/code.json?mode=view&hideHeader=false&noBorderRadius=false&banHotkeys=false`;
    return fetch(url, fetchOpts).then(
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

  /** recipe_ids skip the listing, so the name has to come from the cheap metadata read. */
  function fetchIdentity(id: number): Promise<Record<string, unknown>> {
    return fetch(`/recipes/${id}.json`, fetchOpts).then(
      (r) =>
        r.text().then((body) => {
          if (r.status < 200 || r.status >= 300) return { id: id, name: '' };
          try {
            const json = JSON.parse(body) as {
              result?: { recipe_data?: { flow?: { name?: unknown; folder_id?: unknown } } };
            };
            const flow = json.result && json.result.recipe_data && json.result.recipe_data.flow;
            return {
              id: id,
              name: flow && flow.name != null ? String(flow.name) : '',
              folder_id: flow && flow.folder_id != null ? Number(flow.folder_id) : undefined,
            };
          } catch (e) {
            return { id: id, name: '' };
          }
        }),
      () => ({ id: id, name: '' }),
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

  function walkIds(index: number, acc: CandidateCode[]): Promise<CandidateCode[]> {
    if (index >= recipeIds.length) return Promise.resolve(acc);
    return fetchIdentity(recipeIds[index]).then((item) =>
      fetchCode(item).then((hit) => {
        if (hit) acc.push(hit);
        return walkIds(index + 1, acc);
      }),
    );
  }

  if (recipeIds.length > 0) {
    return walkIds(0, []).then((candidates) => ({
      ok: true,
      candidates: candidates,
      flagged: recipeIds.length,
      pages_scanned: 0,
      recipes_requested: recipeIds.length,
      incomplete: false,
    }));
  }

  return collectScopes(0, []).then((listed) => {
    if (listed.fatal && listed.flagged.length === 0) {
      return { ok: false, failure: { stage: 'list' as const, message: listed.fatal } };
    }
    return walkCandidates(listed.flagged, 0, []).then((candidates) => ({
      ok: true,
      candidates: candidates,
      flagged: listed.flagged.length,
      pages_scanned: state.pages,
      folders_scanned: folderIds.length,
      incomplete: state.incomplete,
      incomplete_reason: state.reason,
      pages_truncated: state.pagesTruncated,
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
  /** Set instead of `input` when the serialized input exceeded preview_chars. */
  input_preview?: string;
  input_truncated?: boolean;
  input_chars?: number;
  /** True when this step declares its own schema rather than taking the adapter's. */
  has_extended_schema?: boolean;
  /** True when the step is disabled in that recipe, so it is a weaker example. */
  skip?: boolean;
}

export interface StepMatchOptions {
  /** Keep only steps whose serialized input matches. */
  inputQuery?: string | null;
  inputMatch?: 'substring' | 'regex';
  /** Serialized input longer than this is returned as a preview. 0 = unbounded. */
  previewChars?: number;
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
  options?: StepMatchOptions,
): Omit<StepHit, 'recipe_id' | 'recipe_name' | 'folder_id'>[] {
  const out: Omit<StepHit, 'recipe_id' | 'recipe_name' | 'folder_id'>[] = [];
  const wantedAction = action?.toLowerCase() ?? null;
  const inputQuery = options?.inputQuery ? String(options.inputQuery) : null;
  const previewChars = options?.previewChars ?? 0;
  let inputRegex: RegExp | null = null;
  if (inputQuery !== null && options?.inputMatch === 'regex') {
    try {
      inputRegex = new RegExp(inputQuery, 'i');
    } catch {
      // Validated in the handler; an unusable pattern matches nothing here
      // rather than throwing mid-walk.
      return out;
    }
  }

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
        let serialized: string | null = null;
        if (value.input !== undefined) {
          const cleaned = stripConnectionSecrets(value.input, { allowKeys: STEP_VISIBLE_KEYS });
          serialized = safeStringify(cleaned);
          if (previewChars > 0 && serialized.length > previewChars) {
            hit.input_preview = serialized.slice(0, previewChars) + '...';
            hit.input_truncated = true;
            hit.input_chars = serialized.length;
          } else {
            hit.input = cleaned;
          }
        }
        if (
          value.extended_input_schema !== undefined ||
          value.extended_output_schema !== undefined
        ) {
          hit.has_extended_schema = true;
        }
        const inputSatisfied =
          inputQuery === null
            ? true
            : serialized !== null &&
              (inputRegex
                ? inputRegex.test(serialized)
                : serialized.toLowerCase().includes(inputQuery.toLowerCase()));
        if (inputSatisfied) out.push(hit);
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

function safeStringify(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s === undefined ? String(value) : s;
  } catch {
    return String(value);
  }
}

/** Parse one candidate's code string and attach the recipe identity to each hit. */
export function hitsForCandidate(
  candidate: CandidateCode,
  provider: string,
  action: string | null,
  options?: StepMatchOptions,
): StepHit[] {
  let tree: unknown;
  try {
    tree = JSON.parse(candidate.code);
  } catch {
    return [];
  }
  return collectMatchingSteps(tree, provider, action, options).map((hit) => ({
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

      const folderIds = numericList(args?.folder_ids);
      if (folderIds === null) {
        return createErrorResponse('Param [folder_ids] must be an array of numeric folder ids.');
      }
      const recipeIds = numericList(args?.recipe_ids);
      if (recipeIds === null) {
        return createErrorResponse('Param [recipe_ids] must be an array of numeric recipe ids.');
      }
      if (recipeIds.length > 25) {
        return createErrorResponse('Param [recipe_ids] accepts at most 25 recipe ids per call.');
      }
      if (recipeIds.length > 0 && folderIds.length > 0) {
        return createErrorResponse(
          'Pass either [recipe_ids] (read exactly those recipes) or [folder_ids] (scan those ' +
            'folders), not both.',
        );
      }

      const inputMatch = args?.input_match === 'regex' ? 'regex' : 'substring';
      let inputQuery: string | null = null;
      if (args?.input_query !== undefined) {
        if (typeof args.input_query !== 'string' || args.input_query.trim() === '') {
          return createErrorResponse('Param [input_query] must be a non-empty string.');
        }
        inputQuery = args.input_query;
        if (inputMatch === 'regex') {
          try {
            new RegExp(inputQuery, 'i');
          } catch (e) {
            return createErrorResponse(
              `Param [input_query] is not a valid regular expression: ${
                e instanceof Error ? e.message : String(e)
              }`,
            );
          }
        }
      }
      const previewChars =
        typeof args?.preview_chars === 'number' && Number.isFinite(args.preview_chars)
          ? Math.min(Math.max(Math.floor(args.preview_chars), 0), 20_000)
          : 2000;

      const action = args.action?.trim() || null;
      const limit = Math.min(Math.max(args.limit ?? 5, 1), 25);
      const maxRecipes = Math.min(Math.max(args.max_recipes ?? 8, 1), 25);
      const maxPages = Math.min(Math.max(args.max_pages ?? 5, 1), 25);
      const timeoutMs = Math.min(Math.max(args.timeout_ms ?? 45_000, 10_000), 110_000);

      const tab = await findWorkatoTab(args.tabId);
      const result = await runInWorkatoTab(
        tab.tabId,
        fetchStepCandidatesInPage,
        [
          {
            provider,
            maxPages,
            maxRecipes: recipeIds.length > 0 ? recipeIds.length : maxRecipes,
            folderIds,
            recipeIds,
          },
        ],
        { timeoutMs },
      );

      if (!result.ok) {
        return createErrorResponse(
          `workato_recipe_step_search (${result.failure?.stage}): ${result.failure?.message}`,
        );
      }

      const matchOptions: StepMatchOptions = { inputQuery, inputMatch, previewChars };
      const candidates = result.candidates ?? [];
      const hits: StepHit[] = [];
      for (const candidate of candidates) {
        for (const hit of hitsForCandidate(candidate, provider, action, matchOptions)) {
          hits.push(hit);
          if (hits.length >= limit) break;
        }
        if (hits.length >= limit) break;
      }

      const flagged = result.flagged ?? 0;
      const truncatedByMaxRecipes = recipeIds.length === 0 && flagged > candidates.length;
      const pagesTruncated = result.pages_truncated === true;
      const payload: Record<string, unknown> = {
        provider,
        ...(action === null ? {} : { action }),
        ...(inputQuery === null ? {} : { input_query: inputQuery, input_match: inputMatch }),
        count: hits.length,
        limit,
        recipes_flagged: flagged,
        recipes_read: candidates.length,
        pages_scanned: result.pages_scanned ?? 0,
        scope:
          recipeIds.length > 0
            ? { recipe_ids: recipeIds }
            : folderIds.length > 0
              ? { folder_ids: folderIds, recursive: false }
              : { workspace: true },
        coverage: {
          complete:
            result.incomplete !== true &&
            !pagesTruncated &&
            !truncatedByMaxRecipes &&
            hits.length < limit,
          incomplete_reason: result.incomplete
            ? result.incomplete_reason
            : pagesTruncated
              ? `max_pages=${maxPages} stopped the list scan before the end of the list`
              : truncatedByMaxRecipes
                ? `max_recipes=${maxRecipes} stopped the read after ${candidates.length} of ${flagged} flagged recipes`
                : hits.length >= limit
                  ? `limit=${limit} was filled; more steps may exist`
                  : undefined,
        },
        steps: hits,
      };

      if (hits.length === 0) {
        payload.hint =
          flagged === 0
            ? `No recipe in the ${result.pages_scanned ?? 0} page(s) scanned uses ` +
              `"${provider}". This connector may simply never have been used here — that is not an ` +
              'error, and workato_adapter_meta still describes it in full. Raise max_pages, or ' +
              'widen folder_ids, if the scope scanned was smaller than the workspace.'
            : `${flagged} recipe(s) are tagged with "${provider}" but no step matched` +
              (action === null
                ? '. The tag can come from the trigger app alone.'
                : ` action "${action}". Call again without [action] to see which of its operations ARE used here.`) +
              (inputQuery === null ? '' : ` input_query "${inputQuery}" also had to match.`);
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

/** null = invalid; [] = not supplied. */
function numericList(value: unknown): number[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null;
    out.push(Math.floor(entry));
  }
  return out;
}

export const workatoRecipeStepSearchTool = new WorkatoRecipeStepSearchTool();
