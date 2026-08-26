/**
 * workato_datapill — emit a datapill reference string, exactly.
 *
 * `_dp` is one mechanism with three payload dialects, chosen by which key the
 * payload carries:
 *
 *   recipe step output   {"pill_type":"output","provider":"salesforce","line":"9ad56b78","path":[...]}
 *   Workflow App widget  {"source":"widget","id":"df1984ea","path":["value"]}
 *   Workflow App page var{"source":"page-variable","id":"135a4f74","path":["value"]}
 *
 * The two page dialects differ only in `source`; both address an 8-hex id that
 * belongs to the page, never to a recipe step.
 *
 * and two modes:
 *
 *   interpolated  "#{_dp('<json>')}"   inside a normal string field
 *   formula       "_dp('<json>')"      inside a leading-`=` expression, bare
 *
 * Hand-assembling these in a script means nested quote escaping around JSON
 * that must stay byte-exact: Workato matches the literal, so one inserted space
 * turns a working pill into one that saves fine and silently resolves to
 * nothing. This tool is pure string assembly with the escaping handled once.
 *
 * The recipe dialect reuses the shorthand parser the mutator tools already
 * accept, so `salesforce.9ad56b78.records[].Id` means the same thing here as it
 * does in `workato_recipe_map_datapill`.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { parseDatapillPath, parseDatapillShorthand } from './workato-recipe-mutators';

export const DATAPILL_TOOL = 'workato_datapill';

type JsonObject = Record<string, unknown>;

export function isWorkatoDatapillTool(name: string): boolean {
  return name === DATAPILL_TOOL;
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export type DatapillMode = 'interpolated' | 'formula';

/**
 * Wrap a payload object in the `_dp(...)` literal.
 *
 * Compact serialization is not cosmetic: `json.dumps` spacing is the documented
 * way to produce a pill that saves and then resolves empty. Single quotes in
 * the payload are escaped because the literal is single-quoted.
 */
export function renderDatapill(payload: JsonObject, mode: DatapillMode = 'interpolated'): string {
  const json = JSON.stringify(payload).replace(/'/g, "\\'");
  const bare = `_dp('${json}')`;
  return mode === 'formula' ? bare : `#{${bare}}`;
}

/** Path input: a shorthand string (`records[].Id`), or an explicit array. */
export function normalizePathInput(path: unknown, label: string): unknown[] {
  if (typeof path === 'string') {
    return parseDatapillPath(path.split('.'));
  }
  if (Array.isArray(path)) {
    // An explicit array may already carry `{path_element_type: ...}` nodes;
    // pass those through untouched and expand shorthand only on strings.
    const out: unknown[] = [];
    for (const seg of path) {
      if (typeof seg === 'string') out.push(...parseDatapillPath([seg]));
      else if (seg !== null && typeof seg === 'object') out.push(seg);
      else if (typeof seg === 'number') out.push(seg);
      else throw new Error(`${label} entries must be strings, numbers, or objects`);
    }
    return out;
  }
  throw new Error(`${label} must be a dotted string or an array`);
}

export interface BuildDatapillArgs {
  kind?: unknown;
  mode?: unknown;
  /** recipe dialect */
  provider?: unknown;
  line?: unknown;
  pill_type?: unknown;
  shorthand?: unknown;
  /** page dialects */
  widget_id?: unknown;
  variable_id?: unknown;
  path?: unknown;
}

/** `source` value for each of the two page-side dialects. */
const PAGE_SOURCES: Record<string, string> = {
  widget: 'widget',
  variable: 'page-variable',
};

/** Assemble the payload object for any of the three dialects. */
export function buildDatapillPayload(args: BuildDatapillArgs): JsonObject {
  const kind =
    typeof args.kind === 'string' && args.kind.length > 0
      ? args.kind
      : args.widget_id !== undefined
        ? 'widget'
        : args.variable_id !== undefined
          ? 'variable'
          : 'recipe';

  const pageSource = PAGE_SOURCES[kind];
  if (pageSource) {
    const id = kind === 'widget' ? args.widget_id : args.variable_id;
    const argName = kind === 'widget' ? 'widget_id' : 'variable_id';
    if (typeof id !== 'string' || !/^[0-9a-f]{8}$/i.test(id)) {
      throw new Error(
        `${argName} must be the ${kind}'s 8-hex-character id (e.g. "df1984ea"). It is the ` +
          'address the page uses — never invent one, read it from the page content.',
      );
    }
    const path = args.path === undefined ? ['value'] : normalizePathInput(args.path, 'path');
    if (path.length === 0) throw new Error('path must contain at least one segment');
    return { source: pageSource, id: id.toLowerCase(), path };
  }

  if (kind !== 'recipe') {
    throw new Error(
      `kind must be "recipe", "widget" or "variable", got ${JSON.stringify(args.kind)}`,
    );
  }

  // Shorthand carries provider, line and path in one token.
  if (typeof args.shorthand === 'string' && args.shorthand.length > 0) {
    const pill = parseDatapillShorthand(args.shorthand);
    if (typeof args.pill_type === 'string') pill.pill_type = args.pill_type;
    if (!Array.isArray(pill.path) || pill.path.length === 0) {
      throw new Error('shorthand must include a path, e.g. "salesforce.9ad56b78.records[].Id"');
    }
    return pill;
  }

  const pillType = typeof args.pill_type === 'string' ? args.pill_type : 'output';
  const payload: JsonObject = { pill_type: pillType };

  // `job_context` pills address the job itself, so they carry no step address.
  if (pillType !== 'job_context') {
    if (typeof args.provider !== 'string' || args.provider.length === 0) {
      throw new Error('provider is required for a recipe datapill (e.g. "salesforce", "py_eval")');
    }
    if (typeof args.line !== 'string' || args.line.length === 0) {
      throw new Error(
        "line is required for a recipe datapill — it is the target step's `as` id " +
          '(8 hex chars), not its step number.',
      );
    }
    payload.provider = args.provider;
    payload.line = args.line;
  }

  const path = normalizePathInput(args.path, 'path');
  if (path.length === 0) throw new Error('path must contain at least one segment');
  payload.path = path;
  return payload;
}

export function handleWorkatoDatapillCall(name: string, args: JsonObject): CallToolResult {
  try {
    if (!isWorkatoDatapillTool(name)) return errorResult(`unsupported tool: ${name}`);

    const mode =
      args.mode === undefined || args.mode === 'interpolated'
        ? 'interpolated'
        : args.mode === 'formula'
          ? 'formula'
          : null;
    if (mode === null) {
      return errorResult(
        `mode must be "interpolated" or "formula", got ${JSON.stringify(args.mode)}`,
      );
    }

    const payload = buildDatapillPayload(args as BuildDatapillArgs);
    const rendered = renderDatapill(payload, mode);

    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            datapill: rendered,
            mode,
            payload,
            hint:
              mode === 'formula'
                ? 'Bare _dp(...) — valid only inside a formula-mode value (one whose first ' +
                  'character is "="). In a plain string field use mode:"interpolated".'
                : 'Interpolated #{_dp(...)} — for a normal string field. Inside a formula-mode ' +
                  'value (leading "=") use mode:"formula" instead.',
          }),
        },
      ],
    };
  } catch (error) {
    return errorResult(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
