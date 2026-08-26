import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../base-browser';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { findWorkatoTab, runInWorkatoTab, WorkatoDispatchError } from './tab-dispatch';

/**
 * workato_adapter_meta — the "what is this field actually called?" lookup.
 *
 * The recipe editor resolves every connector's config surface through
 * `/integrations/meta?name=<adapter>`. That response is the authority on
 * trigger/action input keys, output keys, and the behaviour flags that say
 * where a step's schema comes from (`extends_input_schema`, `depends_on`).
 *
 * Without it the only way to learn a key name is guess → save → pull → check,
 * and Workato silently drops keys it does not recognise, so a wrong guess
 * looks exactly like a successful save. One call here replaces that loop.
 *
 * Payload discipline: a single adapter's meta runs from ~10 KB
 * (workato_recipe_function) to several hundred KB (salesforce, netsuite). A
 * bare call therefore returns only the operation INDEX (names + titles); field
 * lists arrive when the caller narrows with `operation` or `field_grep`. Use
 * `out_file` when the raw document is genuinely wanted — that is resolved in
 * the native-server, so the JSON never crosses the context.
 */

interface AdapterMetaArgs {
  /** Adapter name, or a list of them (`workato_recipe_function`, `salesforce`, …). */
  adapter: string | string[];
  /** Return full field lists for this trigger/action name only. */
  operation?: string;
  /** Case-insensitive substring (or /regex/) matched against field name and label. */
  field_grep?: string;
  /** Include each operation's help text. Default true. */
  include_help?: boolean;
  /** Return the raw meta document instead of the slim view (capped; prefer out_file). */
  raw?: boolean;
  /** In-page script timeout. Default 30000, clamped 10000–110000. */
  timeout_ms?: number;
  tabId?: number;
}

/** One config field as the editor sees it. */
interface SlimField {
  name: string;
  type?: string;
  control_type?: string;
  label?: string;
  optional?: boolean;
  /** True when picking this field re-derives the step's schema (schema-designer fields). */
  extends_schema?: boolean;
  hint?: string;
  pick_list?: string;
}

/** One trigger or action, slimmed to what an agent needs to write a step. */
interface SlimOperation {
  name: string;
  kind: 'trigger' | 'action';
  title?: string;
  help?: string;
  input?: SlimField[];
  output?: SlimField[];
  /** Field-count summary, present in index mode where the lists are omitted. */
  input_count?: number;
  output_count?: number;
  extends_input_schema?: boolean;
  extends_output_schema?: boolean;
  /** Machine-readable "my fields are declared on that other step". */
  depends_on?: unknown;
  deprecated?: boolean;
  batch?: boolean;
  realtime?: boolean;
}

interface InPageResult {
  ok: boolean;
  /** Raw parsed meta document, present when ok=true. */
  meta?: unknown;
  /** Byte length of the raw response — reported so a caller knows what it dodged. */
  bytes?: number;
  failure?: {
    stage: 'fetch' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

/**
 * Runs in the Workato tab's MAIN world. Self-contained, promise-chain based —
 * DO NOT add async/await (WXT/Vite rewrites it into a hoisted helper that does
 * not survive Function.prototype.toString; see pull-recipe.ts).
 */
function fetchAdapterMetaInPage(names: string[]): Promise<InPageResult> {
  const url = `/integrations/meta?name=${encodeURIComponent(names.join(','))}&cacheKey=x`;
  return fetch(url, {
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
            message:
              `GET ${url} returned HTTP ${r.status}` +
              (r.status === 404
                ? '. A 404 here usually means the adapter name is wrong, or this tab is in a ' +
                  'workspace/environment where that connector is not available — it does not ' +
                  'prove the adapter does not exist.'
                : ''),
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
      return { ok: true, meta: json, bytes: bodyText.length };
    }),
  );
}

// ---------------------------------------------------------------------------
// Pure shaping helpers. Exported for unit tests — no browser needed.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Locate one adapter's `{triggers, actions}` node in the meta document.
 *
 * The response has been observed keyed by adapter name at the top level, but
 * Workato wraps some `/web_api` reads in `result`, so both are accepted rather
 * than betting on one and returning "adapter not found" for a document that is
 * right there. Falls back to the top level itself when it already looks like a
 * single adapter's node.
 */
export function pickAdapterNode(meta: unknown, adapter: string): Record<string, unknown> | null {
  const looksLikeAdapter = (v: unknown): v is Record<string, unknown> =>
    isRecord(v) && (isRecord(v.triggers) || isRecord(v.actions));

  const roots: unknown[] = [meta];
  if (isRecord(meta)) {
    if (meta.result !== undefined) roots.push(meta.result);
    if (meta.data !== undefined) roots.push(meta.data);
    if (isRecord(meta.adapters)) roots.push(meta.adapters);
  }

  for (const root of roots) {
    if (!isRecord(root)) continue;
    const direct = root[adapter];
    if (looksLikeAdapter(direct)) return direct;
  }
  // Single-adapter document with no name wrapper.
  for (const root of roots) {
    if (looksLikeAdapter(root)) return root;
  }
  return null;
}

/** Trim and flatten Workato's HTML help blob into one readable line. */
function slimHelp(help: unknown): string | undefined {
  const body = isRecord(help) ? help.body : help;
  if (typeof body !== 'string') return undefined;
  const text = body
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) return undefined;
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

function slimField(raw: unknown): SlimField | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === 'string' ? raw.name : null;
  if (!name) return null;
  const out: SlimField = { name };
  if (typeof raw.type === 'string') out.type = raw.type;
  if (typeof raw.control_type === 'string') out.control_type = raw.control_type;
  if (typeof raw.label === 'string') out.label = raw.label;
  if (typeof raw.optional === 'boolean') out.optional = raw.optional;
  if (raw.extends_schema === true) out.extends_schema = true;
  if (typeof raw.hint === 'string') out.hint = slimHelp(raw.hint);
  if (typeof raw.pick_list === 'string') out.pick_list = raw.pick_list;
  return out;
}

function slimFieldList(raw: unknown): SlimField[] {
  if (!Array.isArray(raw)) return [];
  const out: SlimField[] = [];
  for (const entry of raw) {
    const field = slimField(entry);
    if (field) out.push(field);
  }
  return out;
}

/** Build a matcher from `/regex/flags` or a plain case-insensitive substring. */
export function buildFieldMatcher(pattern: string): (field: SlimField) => boolean {
  let test: (s: string) => boolean;
  const asRegex = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);
  if (asRegex) {
    const re = new RegExp(asRegex[1], asRegex[2].includes('i') ? asRegex[2] : `${asRegex[2]}i`);
    test = (s) => re.test(s);
  } else {
    const needle = pattern.toLowerCase();
    test = (s) => s.toLowerCase().includes(needle);
  }
  return (field) => test(field.name) || (field.label !== undefined && test(field.label));
}

/** Shape one trigger/action entry. `detail=false` omits the field lists. */
export function slimOperation(
  name: string,
  kind: 'trigger' | 'action',
  raw: unknown,
  opts: { detail: boolean; includeHelp: boolean; matcher?: (field: SlimField) => boolean },
): SlimOperation {
  const src = isRecord(raw) ? raw : {};
  const op: SlimOperation = { name, kind };
  if (typeof src.title === 'string') op.title = src.title;
  if (opts.includeHelp) {
    const help = slimHelp(src.help);
    if (help) op.help = help;
  }

  const input = slimFieldList(src.input);
  const output = slimFieldList(src.output);
  if (opts.detail) {
    op.input = opts.matcher ? input.filter(opts.matcher) : input;
    op.output = opts.matcher ? output.filter(opts.matcher) : output;
  } else {
    op.input_count = input.length;
    op.output_count = output.length;
  }

  // Behaviour flags. These answer "where do this step's fields come from?",
  // which is the question that costs the most time when it goes unanswered.
  if (src.extends_input_schema === true) op.extends_input_schema = true;
  if (src.extends_output_schema === true) op.extends_output_schema = true;
  if (src.depends_on !== undefined) op.depends_on = src.depends_on;
  if (src.deprecated === true) op.deprecated = true;
  if (src.batch === true) op.batch = true;
  if (src.realtime === true) op.realtime = true;
  return op;
}

export interface AdapterMetaView {
  adapter: string;
  found: boolean;
  mode: 'index' | 'detail' | 'grep';
  triggers?: SlimOperation[];
  actions?: SlimOperation[];
  /** Present in index mode: how to get the field lists. */
  hint?: string;
}

/**
 * Turn one adapter's raw meta node into the view the caller asked for.
 *
 * Three modes, chosen by how much the caller narrowed:
 *   index  — nothing specified. Operation names + titles only.
 *   detail — `operation` given. Full field lists for the matching operations.
 *   grep   — `field_grep` given. Every operation that has a matching field,
 *            carrying only the fields that matched.
 */
export function buildAdapterView(
  adapter: string,
  meta: unknown,
  opts: { operation?: string; fieldGrep?: string; includeHelp: boolean },
): AdapterMetaView {
  const node = pickAdapterNode(meta, adapter);
  if (!node) return { adapter, found: false, mode: 'index' };

  const mode: AdapterMetaView['mode'] = opts.operation
    ? 'detail'
    : opts.fieldGrep
      ? 'grep'
      : 'index';
  const matcher = opts.fieldGrep ? buildFieldMatcher(opts.fieldGrep) : undefined;
  const wanted = opts.operation?.toLowerCase();

  const collect = (kind: 'trigger' | 'action', bag: unknown): SlimOperation[] => {
    if (!isRecord(bag)) return [];
    const out: SlimOperation[] = [];
    for (const [name, raw] of Object.entries(bag)) {
      if (wanted !== undefined && name.toLowerCase() !== wanted) continue;
      const op = slimOperation(name, kind, raw, {
        detail: mode !== 'index',
        includeHelp: opts.includeHelp,
        matcher,
      });
      // In grep mode an operation with no matching field is noise.
      if (mode === 'grep' && (op.input?.length ?? 0) === 0 && (op.output?.length ?? 0) === 0) {
        continue;
      }
      out.push(op);
    }
    return out;
  };

  const view: AdapterMetaView = {
    adapter,
    found: true,
    mode,
    triggers: collect('trigger', node.triggers),
    actions: collect('action', node.actions),
  };
  if (mode === 'index') {
    view.hint =
      'Index only. Pass operation:"<name>" for that operation\'s full input/output field ' +
      'lists, or field_grep:"schema" to find fields by name/label across every operation.';
  }
  return view;
}

/** Raw-mode cap. Past this the caller is told to use out_file instead. */
const RAW_CHAR_CAP = 20_000;

class WorkatoAdapterMetaTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.WORKATO.ADAPTER_META;

  async execute(args: AdapterMetaArgs): Promise<ToolResult> {
    try {
      const names = Array.isArray(args?.adapter)
        ? args.adapter.filter((n): n is string => typeof n === 'string' && n.length > 0)
        : typeof args?.adapter === 'string' && args.adapter.length > 0
          ? args.adapter.split(',').map((n) => n.trim())
          : [];
      if (names.length === 0) {
        return createErrorResponse(
          'Param [adapter] must be a non-empty adapter name or array of names ' +
            '(e.g. "workato_recipe_function", ["salesforce","netsuite"]).',
        );
      }
      if (args.operation != null && typeof args.operation !== 'string') {
        return createErrorResponse('Param [operation] must be a string trigger/action name');
      }
      if (args.field_grep != null && typeof args.field_grep !== 'string') {
        return createErrorResponse('Param [field_grep] must be a string');
      }

      const timeoutMs = Math.min(Math.max(args.timeout_ms ?? 30_000, 10_000), 110_000);
      const tab = await findWorkatoTab(args.tabId);
      const result = await runInWorkatoTab(tab.tabId, fetchAdapterMetaInPage, [names], {
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

      // raw mode: hand back the document itself, capped. `out_file` (resolved
      // in the native-server) is the uncapped route.
      if (args.raw === true) {
        const rawText = JSON.stringify(result.meta);
        const capped = rawText.length > RAW_CHAR_CAP;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                adapters: names,
                bytes: result.bytes,
                truncated: capped,
                ...(capped
                  ? {
                      note:
                        `Raw document is ${rawText.length} chars — truncated to ${RAW_CHAR_CAP}. ` +
                        'Pass out_file:"<path>.json" to write the whole thing to disk, or narrow ' +
                        'with operation/field_grep.',
                    }
                  : {}),
                raw: capped ? rawText.slice(0, RAW_CHAR_CAP) : result.meta,
              }),
            },
          ],
          isError: false,
        };
      }

      const includeHelp = args.include_help !== false;
      const views = names.map((adapter) =>
        buildAdapterView(adapter, result.meta, {
          operation: args.operation,
          fieldGrep: args.field_grep,
          includeHelp,
        }),
      );

      const missing = views.filter((v) => !v.found).map((v) => v.adapter);
      if (missing.length === names.length) {
        const topKeys = isRecord(result.meta) ? Object.keys(result.meta).slice(0, 40) : [];
        return createErrorResponse(
          `workato_adapter_meta: no adapter node found for ${JSON.stringify(names)} in the ` +
            `meta response (${result.bytes} bytes). Top-level keys: ${JSON.stringify(topKeys)}. ` +
            'Check the adapter name — a custom connector uses its generated name ' +
            '(e.g. "netsuite_rest_connector_5105163_1745592003"), visible in a recipe step\'s ' +
            '`provider` field.',
        );
      }

      const payload: Record<string, unknown> = {
        adapters: views.length === 1 ? views[0] : views,
        bytes: result.bytes,
      };
      if (missing.length > 0) payload.not_found = missing;

      // An empty detail-mode result means the operation name was wrong; say so
      // rather than handing back an empty object that reads like "no fields".
      if (args.operation) {
        const hits = views.reduce(
          (n, v) => n + (v.triggers?.length ?? 0) + (v.actions?.length ?? 0),
          0,
        );
        if (hits === 0) {
          const index = views
            .filter((v) => v.found)
            .map((v) => v.adapter)
            .join(', ');
          return createErrorResponse(
            `workato_adapter_meta: no trigger or action named "${args.operation}" on ${index}. ` +
              'Call again without [operation] to list what this adapter actually exposes.',
          );
        }
      }

      return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false };
    } catch (err) {
      if (err instanceof WorkatoDispatchError) {
        return createErrorResponse(`${err.code}: ${err.message}`);
      }
      return createErrorResponse(
        `workato_adapter_meta failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const workatoAdapterMetaTool = new WorkatoAdapterMetaTool();
