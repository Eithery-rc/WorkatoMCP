import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';

/**
 * workato_apps_list — "which apps can I build a step with here, and what are
 * they called?"
 *
 * workato_adapter_meta answers everything about ONE connector, but only once
 * its technical name is known, and that name is the part nobody can guess for
 * a custom connector (`netsuite_rest_connector_5105163_1745592003`) or a
 * renamed one. This tool is the step before it.
 *
 * Four sources, all read-only, merged by adapter name:
 *   /web_api/mixed_assets.json?asset_type=connection  — apps with a real
 *       connection, i.e. the ones a step can actually authenticate as.
 *   /web_api/mixed_assets/adapters.json               — adapters already used
 *       by recipes here. Tiny, and the fastest read of "what is built with".
 *   /web_api/published_custom_adapters.json           — this workspace's own
 *       SDK connectors: title -> generated name.
 *   /web_api/certified_custom_adapters.json           — Workato's certified
 *       community catalogue (~70 KB), searched only when asked.
 *
 * A fifth source is Workato's own built-in connectors, seeded from a fixed
 * list of NAMES and enriched live from /integrations/meta. Those are the ones
 * whose name nobody can derive from what a person calls them: "HTTP" is `rest`,
 * "Workato Event Streams" is `workato_pub_sub`, "Scheduler" is `clock`.
 *
 * KNOWN LIMIT, stated in the response rather than hidden: Workato serves no
 * catalogue of its ~1000 STANDARD connectors. The recipe editor's app picker
 * issues no network request at all — the list is compiled into its bundle, and
 * the DOM carries titles without technical names. So a standard app that has
 * no connection here cannot be enumerated. It can still be resolved in one
 * call: /integrations/meta accepts a comma-separated list and omits names it
 * does not know, which is what workato_adapter_meta's array form does.
 */

interface AppsListArgs {
  /** Case-insensitive substring matched against adapter name, title and aliases. */
  query?: string;
  /** Search the certified community catalogue too. Defaults to true when `query` is set. */
  include_certified?: boolean;
  /** Max apps returned. Default 200, clamped 1–1000. */
  limit?: number;
  /** In-page fetch timeout. Default 30000, clamped 10000–110000. */
  timeout_ms?: number;
  tabId?: number;
}

/** One source's outcome — a failed optional source must not sink the whole call. */
interface SourceResult {
  ok: boolean;
  status?: number;
  body?: unknown;
  message?: string;
}

interface InPageResult {
  connections: SourceResult;
  usedAdapters: SourceResult;
  custom: SourceResult;
  certified: SourceResult;
  /** Built-in connectors, already reduced in-page to name/title/aliases/categories. */
  builtins: SourceResult;
}

/**
 * Runs in the Workato tab's MAIN world. Self-contained, promise-chain based —
 * DO NOT add async/await (WXT/Vite rewrites it into a hoisted helper that does
 * not survive Function.prototype.toString; see pull-recipe.ts).
 */
function fetchAppSourcesInPage(
  includeCertified: boolean,
  connectionPages: number,
  builtinNames: string[],
): Promise<InPageResult> {
  const opts: RequestInit = {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  };

  function getJson(url: string): Promise<SourceResult> {
    return fetch(url, opts).then(
      (r) =>
        r.text().then((body) => {
          if (r.status < 200 || r.status >= 300) {
            return {
              ok: false,
              status: r.status,
              message: `GET ${url} returned HTTP ${r.status}: ${body.slice(0, 200)}`,
            };
          }
          try {
            return { ok: true, status: r.status, body: JSON.parse(body) };
          } catch (e) {
            return {
              ok: false,
              status: r.status,
              message: `GET ${url}: JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
            };
          }
        }),
      (e) => ({
        ok: false,
        message: `GET ${url} failed: ${e instanceof Error ? e.message : String(e)}`,
      }),
    );
  }

  // Connections paginate at 20; walk a bounded number of pages and concatenate.
  function fetchConnections(page: number, acc: unknown[]): Promise<SourceResult> {
    const url = `/web_api/mixed_assets.json?asset_type=connection&sort_term=name&page=${page}`;
    return getJson(url).then((res) => {
      if (!res.ok) return page === 1 ? res : { ok: true, body: { result: { items: acc } } };
      const result = (res.body as { result?: { items?: unknown[] } } | null)?.result;
      const items = result && Array.isArray(result.items) ? result.items : [];
      const next = acc.concat(items);
      if (items.length === 0 || page >= connectionPages) {
        return { ok: true, body: { result: { items: next } } };
      }
      return fetchConnections(page + 1, next);
    });
  }

  // Workato's own built-in connectors. Only the NAMES are known ahead of time;
  // titles, aliases and categories are read live, so a renamed connector shows
  // its current name rather than a stale copy. Reduced here rather than shipped
  // whole: the response is one document per adapter.
  function fetchBuiltins(): Promise<SourceResult> {
    if (builtinNames.length === 0) return Promise.resolve({ ok: true, body: null });
    return getJson(`/integrations/meta?name=${encodeURIComponent(builtinNames.join(','))}`).then(
      (res) => {
        if (!res.ok) return res;
        const doc = res.body as Record<string, any> | null;
        if (!doc || typeof doc !== 'object') return { ok: true, body: { result: [] } };
        const slim = [];
        for (const key of Object.keys(doc)) {
          const a = doc[key];
          if (!a || typeof a !== 'object') continue;
          slim.push({
            name: key,
            title: typeof a.title === 'string' ? a.title : undefined,
            aliases: Array.isArray(a.aliases) ? a.aliases : undefined,
            categories: Array.isArray(a.categories) ? a.categories : undefined,
            connection_required:
              a.config && typeof a.config.required === 'boolean' ? a.config.required : undefined,
          });
        }
        return { ok: true, body: { result: slim } };
      },
    );
  }

  return Promise.all([
    fetchConnections(1, []),
    getJson('/web_api/mixed_assets/adapters.json'),
    getJson('/web_api/published_custom_adapters.json'),
    includeCertified
      ? getJson('/web_api/certified_custom_adapters.json')
      : Promise.resolve({ ok: true, body: null } as SourceResult),
    fetchBuiltins(),
  ]).then((r) => ({
    connections: r[0],
    usedAdapters: r[1],
    custom: r[2],
    certified: r[3],
    builtins: r[4],
  }));
}

// ---------------------------------------------------------------------------
// Pure shaping helpers. Exported for unit tests — no browser needed.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** One connection, trimmed to what decides whether a step can use it. */
export interface AppConnection {
  id: number;
  name: string;
  /** Workato's authorization_status, e.g. "success". Anything else means the step will fail. */
  status?: string;
}

export interface AppEntry {
  /** The technical adapter name — what goes into step.provider. */
  name: string;
  title?: string;
  aliases?: string[];
  /**
   * Where this app was seen. Order of usefulness:
   *   connection — has a working connection here, usable right now
   *   recipes    — already used by a recipe here, so there are live examples
   *   builtin    — one of Workato's own connectors, always available
   *   custom     — this workspace's own SDK connector
   *   certified  — in Workato's certified catalogue, not installed here
   */
  source: ('connection' | 'recipes' | 'builtin' | 'custom' | 'certified')[];
  connections?: AppConnection[];
  categories?: string[];
  /** False = no connection needed, and no `account_id` in the recipe config entry. */
  connection_required?: boolean;
  triggers_count?: number;
  actions_count?: number;
}

/** Build the case-insensitive name/title/alias matcher. */
export function buildAppMatcher(query: string): (app: AppEntry) => boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return () => true;
  return (app) =>
    app.name.toLowerCase().includes(needle) ||
    (app.title?.toLowerCase().includes(needle) ?? false) ||
    (app.aliases?.some((a) => a.toLowerCase().includes(needle)) ?? false);
}

function upsert(map: Map<string, AppEntry>, name: string): AppEntry {
  const existing = map.get(name);
  if (existing) return existing;
  const created: AppEntry = { name, source: [] };
  map.set(name, created);
  return created;
}

function markSource(app: AppEntry, source: AppEntry['source'][number]): void {
  if (!app.source.includes(source)) app.source.push(source);
}

/** Pull `{title, aliases, triggers_count, actions_count}` out of a custom-adapter record. */
function applyAdapterConfig(app: AppEntry, config: unknown): void {
  if (!isRecord(config)) return;
  if (typeof config.title === 'string' && !app.title) app.title = config.title;
  if (Array.isArray(config.aliases)) {
    const aliases = config.aliases.filter((a): a is string => typeof a === 'string');
    if (aliases.length > 0) app.aliases = aliases;
  }
  if (typeof config.triggers_count === 'number') app.triggers_count = config.triggers_count;
  if (typeof config.actions_count === 'number') app.actions_count = config.actions_count;
}

/**
 * Merge the four raw source bodies into one adapter-name-keyed list.
 *
 * Sorted so the immediately usable apps come first: connected, then used in
 * recipes, then the rest alphabetically. An agent that reads only the head of
 * a long list still gets the ones it can actually build against.
 */
export function mergeAppSources(sources: {
  connections?: unknown;
  usedAdapters?: unknown;
  builtins?: unknown;
  custom?: unknown;
  certified?: unknown;
}): AppEntry[] {
  const map = new Map<string, AppEntry>();

  const connItems = isRecord(sources.connections)
    ? (sources.connections.result as { items?: unknown[] } | undefined)?.items
    : undefined;
  if (Array.isArray(connItems)) {
    for (const raw of connItems) {
      if (!isRecord(raw)) continue;
      const provider = typeof raw.provider === 'string' ? raw.provider : '';
      if (!provider) continue;
      const app = upsert(map, provider);
      markSource(app, 'connection');
      const conn: AppConnection = {
        id: Number(raw.id ?? 0),
        name: String(raw.name ?? ''),
      };
      if (typeof raw.authorization_status === 'string') conn.status = raw.authorization_status;
      (app.connections ??= []).push(conn);
    }
  }

  const used = isRecord(sources.usedAdapters) ? sources.usedAdapters.result : undefined;
  if (Array.isArray(used)) {
    for (const name of used) {
      if (typeof name !== 'string' || name.length === 0) continue;
      markSource(upsert(map, name), 'recipes');
    }
  }

  const builtins = isRecord(sources.builtins) ? sources.builtins.result : undefined;
  if (Array.isArray(builtins)) {
    for (const raw of builtins) {
      if (!isRecord(raw)) continue;
      const name = typeof raw.name === 'string' ? raw.name : '';
      if (!name) continue;
      const app = upsert(map, name);
      markSource(app, 'builtin');
      // Applied the same way as a custom adapter's config block, plus the two
      // fields only the built-ins carry here.
      applyAdapterConfig(app, raw);
      if (Array.isArray(raw.categories)) {
        const categories = raw.categories.filter((c): c is string => typeof c === 'string');
        if (categories.length > 0) app.categories = categories;
      }
      if (typeof raw.connection_required === 'boolean') {
        app.connection_required = raw.connection_required;
      }
    }
  }

  const custom = isRecord(sources.custom) ? sources.custom.result : undefined;
  if (Array.isArray(custom)) {
    for (const raw of custom) {
      if (!isRecord(raw)) continue;
      const name = typeof raw.name === 'string' ? raw.name : '';
      if (!name) continue;
      const app = upsert(map, name);
      markSource(app, 'custom');
      applyAdapterConfig(app, raw.config);
    }
  }

  const certified = isRecord(sources.certified) ? sources.certified.result : undefined;
  if (Array.isArray(certified)) {
    for (const raw of certified) {
      if (!isRecord(raw)) continue;
      const name = typeof raw.name === 'string' ? raw.name : '';
      if (!name) continue;
      const app = upsert(map, name);
      markSource(app, 'certified');
      applyAdapterConfig(app, raw.config);
    }
  }

  const rank = (app: AppEntry): number => {
    if (app.source.includes('connection')) return 0;
    if (app.source.includes('recipes')) return 1;
    if (app.source.includes('builtin')) return 2;
    if (app.source.includes('custom')) return 3;
    return 4;
  };
  return [...map.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Pages of connections to walk. 20 per page, so this covers 200 connections. */
const CONNECTION_PAGES = 10;

/**
 * Workato's own built-in connectors, by adapter name.
 *
 * These are the ones whose technical name cannot be derived from what a person
 * calls them, which is the case this list exists for. Verified live 2026-08-26:
 *
 *   rest                  -> "HTTP"
 *   workato_pub_sub       -> "Workato Event Streams"
 *   clock                 -> "Scheduler by Workato"
 *   py_eval               -> "Python snippets by Workato"
 *   csv_parser            -> "CSV tools by Workato"
 *   workato_workflow_task -> "Workflow apps by Workato"
 *   workato_app           -> "RecipeOps by Workato"
 *   workato_files         -> "Workato FileStorage"
 *
 * Only the NAMES are fixed here. Title, aliases, categories and
 * connection_required are read live from /integrations/meta on every call, so
 * the searchable text is never a stale copy. A connector Workato adds later is
 * simply absent until this list grows, which degrades to the behaviour that
 * existed before it: guess the name and confirm with workato_adapter_meta.
 */
const BUILTIN_ADAPTERS = [
  'clock',
  'csv_parser',
  'email',
  'ftps',
  'json_parser',
  'logger',
  'lookup_table',
  'py_eval',
  'rest',
  'sftp',
  'workato_api_platform',
  'workato_app',
  'workato_files',
  'workato_pub_sub',
  'workato_recipe_function',
  'workato_variable',
  'workato_workflow_task',
  'xml_parser',
];

class WorkatoAppsListTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.APPS_LIST;

  async execute(args: AppsListArgs): Promise<ToolResult> {
    try {
      if (args?.query != null && typeof args.query !== 'string') {
        return createErrorResponse('Param [query] must be a string');
      }
      const query = args?.query?.trim() ?? '';
      // The certified catalogue is ~70 KB raw. Free to include once a query
      // narrows it; opt-in otherwise, so a bare call stays small.
      const includeCertified = args?.include_certified ?? query.length > 0;
      const limit = Math.min(Math.max(args?.limit ?? 200, 1), 1000);
      const timeoutMs = Math.min(Math.max(args?.timeout_ms ?? 30_000, 10_000), 110_000);

      const tab = await findWorkatoTab(args?.tabId);
      const raw = await runInWorkatoTab(
        tab.tabId,
        fetchAppSourcesInPage,
        [includeCertified, CONNECTION_PAGES, BUILTIN_ADAPTERS],
        { timeoutMs },
      );

      // Connections are the load-bearing source; the rest are enrichment.
      if (!raw.connections.ok) {
        return createErrorResponse(
          `workato_apps_list: could not read connections. ${raw.connections.message}`,
        );
      }

      const all = mergeAppSources({
        connections: raw.connections.body,
        usedAdapters: raw.usedAdapters.ok ? raw.usedAdapters.body : undefined,
        builtins: raw.builtins.ok ? raw.builtins.body : undefined,
        custom: raw.custom.ok ? raw.custom.body : undefined,
        certified: raw.certified.ok ? raw.certified.body : undefined,
      });

      const matched = query.length > 0 ? all.filter(buildAppMatcher(query)) : all;
      const apps = matched.slice(0, limit);

      const degraded = (
        [
          ['used_in_recipes', raw.usedAdapters],
          ['builtin_connectors', raw.builtins],
          ['custom_connectors', raw.custom],
          ['certified_catalogue', raw.certified],
        ] as const
      )
        .filter(([, res]) => !res.ok)
        .map(([label, res]) => `${label}: ${res.message}`);

      const payload: Record<string, unknown> = {
        count: apps.length,
        total_matched: matched.length,
        certified_included: includeCertified,
        apps,
        note:
          'Workato serves no catalogue of its standard connectors — the recipe editor ships that ' +
          'list in its own bundle. An app absent from this list is therefore NOT proof it does ' +
          'not exist. To check one, pass the guessed name(s) to workato_adapter_meta: it accepts ' +
          'an array, resolves any standard adapter whether or not this workspace has a ' +
          'connection, and reports the misses under not_found.',
      };
      if (matched.length > apps.length) payload.truncated = matched.length - apps.length;
      if (degraded.length > 0) payload.sources_unavailable = degraded;

      return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_apps_list failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoAppsListTool = new WorkatoAppsListTool();
