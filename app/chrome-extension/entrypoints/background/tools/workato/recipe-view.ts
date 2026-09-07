/**
 * Pure transform layer for `workato_pull_recipe`.
 *
 * A raw Workato recipe code tree is dominated by UI-metadata sections
 * (`extended_input_schema` alone is ~78% of a real recipe). These functions
 * project that tree into AI-friendly shapes:
 *
 *  - `toCompactRecipe` — the whole recipe with UI metadata stripped and
 *    `_dp(...)` datapills shortened for readability; with `omitInput` it drops
 *    every step's `input` for an even lighter structural outline, keeping a
 *    one-line summary of the input keys.
 *  - `findStep` + `inspectStep` — drill into one step: its config distilled
 *    into a classified `mappings` list, the settable input fields, and the
 *    datapills produced by upstream steps that it can reference.
 *
 * Two properties every view keeps:
 *
 *  - Execution semantics survive. A foreach carries `source`, `repeat_mode`,
 *    `clear_scope` and `batch_size` at the NODE ROOT, not under `input`
 *    (skills/workato-recipes/code-tree.md), so an allowlist that copies only
 *    `input` silently drops what the loop actually iterates.
 *  - Nothing is lost without saying so. Long embedded values are replaced by a
 *    preview marker naming the exact path to read back, and every list carries
 *    its total plus a cursor. A filter narrows a list, it never removes its
 *    limit.
 *
 * Everything here is pure: it runs in the background script on the parsed
 * `code` object after `pullInPage` returns. The in-page fetch is untouched.
 */

import {
  DEFAULT_COMPACT_BUDGET_CHARS,
  DEFAULT_MAX_ITEMS,
  DEFAULT_STEP_BUDGET_CHARS,
  PREVIEW_CAP,
  decodeCursor,
  encodeCursor,
  normalizeMaxItems,
  packLists,
  previewLongValues,
  previewString,
  readPaths,
  type ListSpec,
  type PathRead,
} from './recipe-projection';

/** A node in the raw recipe code tree (trigger or any step). */
export interface RawNode {
  number?: number;
  keyword?: string;
  provider?: string;
  name?: string;
  as?: string;
  uuid?: string;
  title?: string | null;
  description?: string;
  input?: Record<string, unknown>;
  skip?: boolean;
  block?: RawNode[];
  extended_input_schema?: RawSchemaEntry[];
  extended_output_schema?: RawSchemaEntry[];
  [key: string]: unknown;
}

/** A single field descriptor inside an `extended_*_schema` array. */
export interface RawSchemaEntry {
  name?: string;
  label?: string;
  type?: string;
  optional?: boolean;
  control_type?: string;
  properties?: RawSchemaEntry[];
  [key: string]: unknown;
}

/** Version metadata as produced by `pullInPage`. */
export interface RecipeVersion {
  version_no: number;
  name: string;
  folder_id: number;
  description: string;
  [key: string]: unknown;
}

/** A pruned step node in the compact view. */
export interface CompactStep {
  n?: number;
  type?: string;
  app?: string;
  name?: string;
  as?: string;
  uuid?: string;
  title?: string | null;
  description?: string;
  skip?: true;
  /** foreach: the list being iterated. A node-root key, not part of `input`. */
  source?: unknown;
  /** foreach: "simple" or "batch". */
  repeat_mode?: unknown;
  /** foreach: whether the loop clears its scope between iterations. */
  clear_scope?: unknown;
  /** foreach: rows per batch when repeat_mode is "batch". */
  batch_size?: unknown;
  /** The author's note on the step. */
  comment?: unknown;
  input?: Record<string, unknown>;
  /** Outline view: the top-level input keys, in place of the input itself. */
  input_keys?: string[];
  /** Set on an ancestor rendered only to place its children in the tree. */
  partial?: true;
  /** Children dropped by the item limit or the budget, and not shown here. */
  block_omitted?: number;
  block?: CompactStep[];
}

/** The compact whole-recipe payload. */
export interface CompactRecipe {
  recipe_id: number;
  name: string;
  version_no: number;
  version: { version_no: number; folder_id: number; description: string };
  step_count: number;
  /** Steps actually rendered, which is `step_count` unless a limit applied. */
  steps_returned: number;
  trigger: CompactStep;
  steps: CompactStep[];
  truncated: boolean;
  next_cursor?: string;
  cache_hit?: boolean;
}

/** A flattened schema field in `step` mode. */
export interface FieldEntry {
  path: string;
  name: string;
  label: string;
  type: string;
  optional: boolean;
  control_type: string;
  io: 'in' | 'out';
}

/** How a step's input leaf is wired. */
export type MappingKind = 'datapill' | 'formula' | 'interpolated' | 'literal' | 'code';

/** One distilled input leaf — the wiring/logic of a step. */
export interface Mapping {
  path: string;
  kind: MappingKind;
  value: unknown;
  /** set when a long value was previewed instead of returned whole */
  truncated?: true;
  /** original length, present only alongside `truncated` */
  chars?: number;
}

/** A datapill an upstream step exposes for the inspected step to reference. */
export interface DatapillRef {
  ref: string;
  label: string;
  type: string;
}

/** Sections a step view can carry. `datapills` and `schemas` are opt-in. */
export type IncludeSection = 'mappings' | 'fields' | 'datapills' | 'schemas' | 'code';

/** What a step view returns when `include` is not given. */
export const DEFAULT_INCLUDE: IncludeSection[] = ['mappings', 'fields'];

/** The `step`-mode payload. */
export interface StepView {
  recipe_id: number;
  version_no: number;
  step: CompactStep;
  include: IncludeSection[];
  /** Exact `paths` reads. Lossless: never previewed, never cut by the budget. */
  paths?: PathRead[];
  mappings?: Mapping[];
  total_mappings?: number;
  mappings_truncated?: boolean;
  fields?: FieldEntry[];
  total_fields?: number;
  fields_truncated?: boolean;
  available_datapills?: DatapillRef[];
  total_datapills?: number;
  datapills_truncated?: boolean;
  schemas?: { input?: unknown[]; output?: unknown[] };
  total_schema_input?: number;
  total_schema_output?: number;
  truncated: boolean;
  next_cursor?: string;
}

/** Several steps read against one snapshot. */
export interface MultiStepView {
  recipe_id: number;
  version_no: number;
  steps: StepView[];
  requested: number;
  returned: number;
  not_found?: string[];
  truncated: boolean;
  next_cursor?: string;
  cache_hit?: boolean;
}

/** Default number of fields/datapills returned in `step` mode. */
export const FIELD_CAP = DEFAULT_MAX_ITEMS;

/** Plain-literal strings longer than this are classified as a code body. */
export const LITERAL_CAP = 256;

/** Shape of the JSON argument inside a `_dp('...')` datapill reference. */
interface RawPill {
  pill_type?: string;
  provider?: string;
  line?: string;
  path?: Array<string | { path_element_type?: string }>;
}

/**
 * Render a parsed datapill as a short dotted reference, e.g.
 * `py_eval.e4f443bd.output.Invoices[].lines[].amount` or
 * `job_context.parameters.flowCode`. Loop items collapse to `[]`, array
 * sizes to `.size`.
 */
export function pillToRef(pill: RawPill): string {
  const segments: string[] = [];
  if (typeof pill.pill_type === 'string' && pill.pill_type !== 'output') {
    segments.push(pill.pill_type);
  }
  if (typeof pill.provider === 'string') segments.push(pill.provider);
  if (typeof pill.line === 'string') segments.push(pill.line);

  for (const element of pill.path ?? []) {
    if (element && typeof element === 'object') {
      const kind = element.path_element_type;
      if (kind === 'current_item') {
        if (segments.length > 0) segments[segments.length - 1] += '[]';
        else segments.push('[]');
      } else if (kind === 'size') {
        segments.push('size');
      } else {
        segments.push('?');
      }
    } else {
      segments.push(String(element));
    }
  }
  return `datapill(${segments.join('.')})`;
}

/** Matches a `_dp('<single-quoted JSON>')` datapill reference. */
const DATAPILL_RE = /_dp\('([\s\S]*?)'\)/g;

/**
 * Recursively rewrite verbose `_dp('{...json...}')` datapill references inside
 * an `input` value into the short `datapill(...)` form. Datapills whose JSON
 * fails to parse are left untouched. This is lossy-but-readable — `view:'full'`
 * remains the source of the exact reference.
 */
export function shortenDatapills(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(DATAPILL_RE, (whole, json: string) => {
      try {
        const pill = JSON.parse(json) as RawPill;
        if (pill && typeof pill === 'object' && (pill.pill_type || pill.provider)) {
          return pillToRef(pill);
        }
      } catch {
        /* not parseable — leave the original reference in place */
      }
      return whole;
    });
  }
  if (Array.isArray(value)) return value.map(shortenDatapills);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = shortenDatapills(val);
    return out;
  }
  return value;
}

/** Strip HTML tags from a Workato description, collapsing whitespace. */
export function stripHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How much of a node's values a projection keeps whole. */
export interface CompactOptions {
  /** Replace long embedded values with a preview marker. Default true. */
  preview?: boolean;
  /** Characters kept from a previewed value. Default PREVIEW_CAP (240). */
  previewChars?: number;
  /** include:'code' returns `code`/`query` bodies whole. */
  keepCode?: boolean;
}

/**
 * Prune one raw node into a compact step. UI-metadata sections are dropped;
 * the execution semantics that live at the node root (`source`, `repeat_mode`,
 * `clear_scope`, `batch_size`, `comment`) are kept, because a compact view
 * that hides what a loop iterates is not a view of the recipe. `input` is kept
 * with its `_dp(...)` datapills shortened and long values previewed (or
 * replaced by `input_keys` when `omitInput` is set, for the outline view);
 * `block` is recursed so nested if/else/try/catch/foreach structure survives.
 */
export function compactNode(
  node: RawNode,
  omitInput = false,
  opts: CompactOptions = {},
): CompactStep {
  const preview = opts.preview !== false;
  const previewChars = opts.previewChars ?? PREVIEW_CAP;
  const stepRef = typeof node.as === 'string' ? node.as : undefined;
  const previewOpts = { previewChars, stepRef, keepCode: opts.keepCode };

  const out: CompactStep = {};
  if (typeof node.number === 'number') out.n = node.number;
  if (typeof node.keyword === 'string') out.type = node.keyword;
  if (typeof node.provider === 'string') out.app = node.provider;
  if (typeof node.name === 'string') out.name = node.name;
  if (typeof node.as === 'string') out.as = node.as;
  if (typeof node.uuid === 'string') out.uuid = node.uuid;
  if (node.title != null && node.title !== '') out.title = node.title;
  if (node.description) out.description = stripHtml(node.description);
  if (node.skip === true) out.skip = true;

  // Execution semantics. `source` is a formula referencing a list pill, so it
  // gets the same datapill shortening as an input value.
  if (node.source !== undefined) {
    const source = shortenDatapills(node.source);
    out.source = preview ? previewLongValues(source, previewOpts, 'source') : source;
  }
  if (node.repeat_mode !== undefined) out.repeat_mode = node.repeat_mode;
  if (node.clear_scope !== undefined) out.clear_scope = node.clear_scope;
  if (node.batch_size !== undefined) out.batch_size = node.batch_size;
  if (node.comment !== undefined && node.comment !== '') {
    out.comment = preview ? previewLongValues(node.comment, previewOpts, 'comment') : node.comment;
  }

  if (node.input && typeof node.input === 'object') {
    if (omitInput) {
      const keys = Object.keys(node.input);
      if (keys.length > 0) out.input_keys = keys;
    } else {
      const shortened = shortenDatapills(node.input);
      out.input = (
        preview ? previewLongValues(shortened, previewOpts, 'input') : shortened
      ) as Record<string, unknown>;
    }
  }

  if (Array.isArray(node.block)) {
    out.block = node.block.map((child) => compactNode(child, omitInput, opts));
  }
  return out;
}

/** Count every node in a compact step subtree (inclusive). */
function countSteps(steps: CompactStep[]): number {
  let total = 0;
  for (const step of steps) {
    total += 1;
    if (step.block) total += countSteps(step.block);
  }
  return total;
}

/** Per-node serialized cost, excluding its children. */
function nodeCost(step: CompactStep): number {
  const { block, ...shallow } = step;
  return (JSON.stringify(shallow) ?? '').length + 1;
}

export interface TreeWindow {
  steps: CompactStep[];
  total: number;
  returned: number;
  next_offset: number | null;
}

/**
 * Keep a window of the step tree: the nodes at pre-order positions
 * `[offset, offset + maxItems)` that also fit the character budget. Ancestors
 * of a kept node are rendered as `partial` headers so the structure still
 * reads correctly; a node whose children were all dropped says so with
 * `block_omitted`. The first node is always rendered, so a cursor advances
 * even when one step is larger than the whole budget.
 */
export function windowCompactSteps(
  steps: CompactStep[],
  options: { offset?: number; maxItems: number; budgetChars: number },
): TreeWindow {
  const offset = Math.max(0, options.offset ?? 0);
  const maxItems = Math.max(1, options.maxItems);
  const decisions = new Map<CompactStep, 'full' | 'skip'>();

  let index = 0;
  let taken = 0;
  let chars = 0;
  let stopped = false;
  let nextOffset: number | null = null;

  const decide = (node: CompactStep): void => {
    const position = index;
    index += 1;
    if (!stopped && position >= offset) {
      const cost = nodeCost(node);
      if (taken >= maxItems || (taken > 0 && chars + cost > options.budgetChars)) {
        stopped = true;
        nextOffset = position;
      } else {
        decisions.set(node, 'full');
        taken += 1;
        chars += cost;
      }
    }
    if (!decisions.has(node)) decisions.set(node, 'skip');
    if (node.block) node.block.forEach(decide);
  };
  steps.forEach(decide);

  const rebuild = (node: CompactStep): CompactStep | null => {
    const children = (node.block ?? []).map(rebuild).filter((c): c is CompactStep => c !== null);
    const decision = decisions.get(node);
    if (decision === 'full') {
      const kept: CompactStep = { ...node };
      if (node.block && node.block.length > 0) {
        if (children.length > 0) kept.block = children;
        else {
          delete kept.block;
          kept.block_omitted = countSteps(node.block);
        }
      }
      return kept;
    }
    if (children.length === 0) return null;
    const header: CompactStep = { partial: true, block: children };
    if (node.n !== undefined) header.n = node.n;
    if (node.type !== undefined) header.type = node.type;
    if (node.as !== undefined) header.as = node.as;
    return header;
  };

  const windowed = steps.map(rebuild).filter((s): s is CompactStep => s !== null);
  return { steps: windowed, total: index, returned: taken, next_offset: nextOffset };
}

export interface CompactRecipeOptions extends CompactOptions {
  /** Steps rendered per call. Default DEFAULT_MAX_ITEMS. */
  maxItems?: number;
  /** Character budget for the step tree. Default DEFAULT_COMPACT_BUDGET_CHARS. */
  budgetChars?: number;
  /** Pre-order position to resume from, out of a cursor. */
  offset?: number;
}

/**
 * Project a raw recipe code tree into the compact whole-recipe payload.
 * With `omitInput` set, every step's `input` collapses to `input_keys`: the
 * outline view.
 */
export function toCompactRecipe(
  code: RawNode,
  recipeId: number,
  version: RecipeVersion,
  omitInput = false,
  options: CompactRecipeOptions = {},
): CompactRecipe {
  const trigger = compactNode(code, omitInput, options);
  const allSteps = trigger.block ?? [];
  delete trigger.block;

  const windowed = windowCompactSteps(allSteps, {
    offset: options.offset,
    maxItems: normalizeMaxItems(options.maxItems),
    budgetChars: options.budgetChars ?? DEFAULT_COMPACT_BUDGET_CHARS,
  });

  const payload: CompactRecipe = {
    recipe_id: recipeId,
    name: version?.name ?? '',
    version_no: version?.version_no ?? 0,
    version: {
      version_no: version?.version_no ?? 0,
      folder_id: version?.folder_id ?? 0,
      description: version?.description ?? '',
    },
    // Counts action/control steps only; the trigger is reported separately.
    step_count: windowed.total,
    steps_returned: windowed.returned,
    trigger,
    steps: windowed.steps,
    truncated: windowed.next_offset !== null,
  };
  if (windowed.next_offset !== null) {
    payload.next_cursor = encodeCursor({ o: { steps: windowed.next_offset } });
  }
  return payload;
}

/**
 * Locate a single node by its `as` anchor or numeric step number.
 * The trigger (`code` itself) is included in the search. Returns null on miss.
 */
export function findStep(code: RawNode, ref: string): RawNode | null {
  const trimmed = ref.trim();
  const asNumber = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const matches = (node: RawNode): boolean =>
    node.as === trimmed || (asNumber !== null && node.number === asNumber);

  const walk = (node: RawNode): RawNode | null => {
    if (matches(node)) return node;
    if (Array.isArray(node.block)) {
      for (const child of node.block) {
        const hit = walk(child);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(code);
}

/** List every step's `{ n, as }` — used to build a helpful not-found error. */
export function listStepRefs(code: RawNode): Array<{ n?: number; as?: string }> {
  const refs: Array<{ n?: number; as?: string }> = [];
  const walk = (node: RawNode): void => {
    refs.push({ n: node.number, as: node.as });
    if (Array.isArray(node.block)) node.block.forEach(walk);
  };
  walk(code);
  return refs;
}

/**
 * Flatten a schema array into dotted-path field entries. Nested `properties`
 * recurse; array-typed entries prefix their children with `[]`.
 */
export function flattenSchema(
  entries: RawSchemaEntry[] | undefined,
  io: 'in' | 'out',
  parentPath = '',
): FieldEntry[] {
  if (!Array.isArray(entries)) return [];
  const fields: FieldEntry[] = [];
  for (const entry of entries) {
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (!name) continue;
    const path = parentPath ? `${parentPath}.${name}` : name;
    fields.push({
      path,
      name,
      label: typeof entry.label === 'string' ? entry.label : '',
      type: typeof entry.type === 'string' ? entry.type : '',
      optional: entry.optional === true,
      control_type: typeof entry.control_type === 'string' ? entry.control_type : '',
      io,
    });
    if (Array.isArray(entry.properties) && entry.properties.length > 0) {
      const childPrefix = entry.type === 'array' ? `${path}[]` : path;
      fields.push(...flattenSchema(entry.properties, io, childPrefix));
    }
  }
  return fields;
}

/** A whole value that is a single datapill reference (interpolated or formula). */
const PURE_DATAPILL_RE = /^#\{datapill\([^)]*\)\}$|^=datapill\([^)]*\)$/;

/** How `flattenInput` treats long values. */
export interface MappingOptions extends CompactOptions {
  /**
   * Prefix used in a preview marker's read-back hint, so the quoted path is
   * the one `paths:[...]` resolves against the step node ("input").
   */
  markerPrefix?: string;
  /** Step anchor quoted in the marker's read-back hint. */
  stepRef?: string;
}

const CODE_LEAF_KEYS: ReadonlySet<string> = new Set(['code', 'query']);

/**
 * Classify one input leaf by how it is wired: a bare datapill reference, a
 * formula (`=` prefix), an interpolated string with embedded datapills, a code
 * body (a long non-JSON string, Python or SQL), or a plain literal. Anything
 * longer than the preview cap is replaced by a marker that names the path to
 * read it back with; `include:'code'` returns `code`/`query` bodies whole.
 */
function classifyValue(
  raw: unknown,
  path: string,
  opts: MappingOptions = {},
): Omit<Mapping, 'path'> {
  if (typeof raw !== 'string') return { kind: 'literal', value: raw };

  const shortened = shortenDatapills(raw) as string;
  let kind: MappingKind = 'literal';
  if (PURE_DATAPILL_RE.test(shortened.trim())) kind = 'datapill';
  else if (shortened.startsWith('=')) kind = 'formula';
  else if (shortened.includes('#{')) kind = 'interpolated';
  else if (shortened.length > LITERAL_CAP) {
    let isJson = false;
    try {
      JSON.parse(raw);
      isJson = true;
    } catch {
      /* not JSON — treat as a code/text body */
    }
    kind = isJson ? 'literal' : 'code';
  }

  const previewChars = opts.previewChars ?? PREVIEW_CAP;
  const leaf =
    path
      .replace(/\[[^\]]*\]$/, '')
      .split('.')
      .pop() ?? path;
  const keepWhole = opts.keepCode === true && CODE_LEAF_KEYS.has(leaf);
  if (!keepWhole && opts.preview !== false && shortened.length > previewChars) {
    const markerPath = opts.markerPrefix ? `${opts.markerPrefix}.${path}` : path;
    return {
      kind,
      value: previewString(markerPath, shortened, previewChars, opts.stepRef),
      truncated: true,
      chars: shortened.length,
    };
  }
  return { kind, value: shortened };
}

/**
 * Flatten a step's `input` object into a flat list of classified leaf mappings.
 * Object keys join with `.`, array elements with `[index]`. Paths are relative
 * to `input`, which is what the recipe mutators expect.
 */
export function flattenInput(
  value: unknown,
  parentPath = '',
  opts: MappingOptions = {},
): Mapping[] {
  if (Array.isArray(value)) {
    const out: Mapping[] = [];
    value.forEach((element, index) => {
      out.push(...flattenInput(element, `${parentPath}[${index}]`, opts));
    });
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Mapping[] = [];
    for (const [key, val] of Object.entries(value)) {
      out.push(...flattenInput(val, parentPath ? `${parentPath}.${key}` : key, opts));
    }
    return out;
  }
  const path = parentPath || '(value)';
  return [{ path, ...classifyValue(value, path, opts) }];
}

/**
 * Collect every datapill an upstream step exposes: the references the
 * inspected step is allowed to wire in.
 *
 * Visibility is structural when `target` is given: everything before the
 * target in document order, which covers its ancestors and their earlier
 * siblings, and excludes later siblings, later branches and the target's own
 * descendants. Without a target it falls back to the step number.
 *
 * A `foreach` has no `provider`, so the old provider check dropped loop items
 * entirely. Its current item is referenced as `foreach.<as>`
 * (skills/workato-recipes/code-tree.md), which is what it contributes here.
 */
export function collectUpstreamDatapills(
  code: RawNode,
  beforeNumber: number,
  target?: RawNode,
): DatapillRef[] {
  const refs: DatapillRef[] = [];

  let targetIndex = -1;
  if (target) {
    let index = 0;
    const locate = (node: RawNode): void => {
      if (node === target) targetIndex = index;
      index += 1;
      if (Array.isArray(node.block)) node.block.forEach(locate);
    };
    locate(code);
  }

  let position = 0;
  const walk = (node: RawNode): void => {
    const index = position;
    position += 1;
    const upstream =
      targetIndex >= 0
        ? index < targetIndex
        : typeof node.number === 'number' && node.number < beforeNumber;

    if (upstream && typeof node.as === 'string') {
      const isForeach = node.keyword === 'foreach' && typeof node.provider !== 'string';
      const head = isForeach ? `foreach.${node.as}` : `${node.provider}.${node.as}`;
      if (isForeach) {
        const fields = flattenSchema(node.extended_output_schema, 'out');
        if (fields.length > 0) {
          for (const field of fields) {
            refs.push({
              ref: `datapill(${head}.${field.path})`,
              label: field.label,
              type: field.type,
            });
          }
        } else {
          // The loop item's fields come from the source list, which this node
          // does not declare. The pill root is still the reference to build on.
          refs.push({ ref: `datapill(${head})`, label: 'Current loop item', type: 'object' });
        }
      } else if (typeof node.provider === 'string' && Array.isArray(node.extended_output_schema)) {
        for (const field of flattenSchema(node.extended_output_schema, 'out')) {
          refs.push({
            ref: `datapill(${head}.${field.path})`,
            label: field.label,
            type: field.type,
          });
        }
      }
    }
    if (Array.isArray(node.block)) node.block.forEach(walk);
  };
  walk(code);
  return refs;
}

/** Options for one step view. */
export interface InspectStepOptions extends CompactOptions {
  /** Sections to return. Default `DEFAULT_INCLUDE`. */
  include?: IncludeSection[];
  /** Case-insensitive filter over mapping paths, field names/labels, pill refs. */
  fieldQuery?: string;
  /** Exact input paths, returned losslessly. */
  paths?: string[];
  /** Items per list. Default DEFAULT_MAX_ITEMS, hard max 500. */
  maxItems?: number;
  /** Character budget for the whole view. Default DEFAULT_STEP_BUDGET_CHARS. */
  budgetChars?: number;
  /** Per-list offsets out of a cursor. */
  offsets?: Record<string, number>;
  versionNo?: number;
  /** Emit the continuation cursor. Multi-step reads build their own. */
  emitCursor?: boolean;
}

function matchesNeedle(needle: string | null, ...values: string[]): boolean {
  if (needle === null) return true;
  return values.some((value) => value.toLowerCase().includes(needle));
}

/**
 * Build the `step`-mode payload: the step header (execution semantics
 * included), its `input` distilled into a classified `mappings` list, the
 * settable input `fields`, and optionally the `available_datapills` from
 * upstream steps and the raw schemas. Every list is limited by `maxItems` and
 * the character budget; `fieldQuery` narrows a list, it never lifts its limit.
 */
export function inspectStep(
  code: RawNode,
  node: RawNode,
  recipeId: number,
  opts: InspectStepOptions = {},
): StepView {
  const include = opts.include && opts.include.length > 0 ? opts.include : DEFAULT_INCLUDE;
  const sections = new Set<IncludeSection>(include);
  const keepCode = sections.has('code');
  const previewChars = opts.previewChars ?? PREVIEW_CAP;
  const maxItems = normalizeMaxItems(opts.maxItems);
  const budgetChars = opts.budgetChars ?? DEFAULT_STEP_BUDGET_CHARS;
  const offsets = opts.offsets ?? {};
  const stepRef = typeof node.as === 'string' ? node.as : undefined;

  const step = compactNode(node, true, { preview: opts.preview, previewChars, keepCode });
  delete step.block;

  const needle =
    opts.fieldQuery && opts.fieldQuery.trim() !== '' ? opts.fieldQuery.trim().toLowerCase() : null;

  const mappingOpts: MappingOptions = {
    preview: opts.preview,
    previewChars,
    keepCode,
    markerPrefix: 'input',
    stepRef,
  };
  const allMappings = sections.has('mappings')
    ? flattenInput(node.input ?? {}, '', mappingOpts).filter((m) => matchesNeedle(needle, m.path))
    : [];
  const allFields = sections.has('fields')
    ? flattenSchema(node.extended_input_schema, 'in').filter((f) =>
        matchesNeedle(needle, f.name, f.label),
      )
    : [];
  const targetNumber = typeof node.number === 'number' ? node.number : Number.POSITIVE_INFINITY;
  const allDatapills = sections.has('datapills')
    ? collectUpstreamDatapills(code, targetNumber, node).filter((d) =>
        matchesNeedle(needle, d.ref, d.label),
      )
    : [];

  const schemaPreview = (entries: unknown, path: string): unknown[] =>
    Array.isArray(entries)
      ? entries.map(
          (entry, index) =>
            previewLongValues(entry, { previewChars, stepRef }, `${path}[${index}]`) as unknown,
        )
      : [];
  const allSchemaIn = sections.has('schemas')
    ? schemaPreview(node.extended_input_schema, 'extended_input_schema')
    : [];
  const allSchemaOut = sections.has('schemas')
    ? schemaPreview(node.extended_output_schema, 'extended_output_schema')
    : [];

  const pathReads = opts.paths && opts.paths.length > 0 ? readPaths(node, opts.paths) : null;

  const specs: ListSpec[] = [];
  if (pathReads)
    specs.push({ key: 'paths', items: pathReads, offset: offsets.paths, exempt: true });
  specs.push({ key: 'mappings', items: allMappings, offset: offsets.mappings });
  specs.push({ key: 'fields', items: allFields, offset: offsets.fields });
  specs.push({
    key: 'available_datapills',
    items: allDatapills,
    offset: offsets.available_datapills,
  });
  specs.push({ key: 'schema_input', items: allSchemaIn, offset: offsets.schema_input });
  specs.push({ key: 'schema_output', items: allSchemaOut, offset: offsets.schema_output });

  const baseChars = (JSON.stringify({ recipe_id: recipeId, step, include }) ?? '').length;
  const packed = packLists(specs, { maxItems, budgetChars, baseChars });

  const view: StepView = {
    recipe_id: recipeId,
    version_no: opts.versionNo ?? 0,
    step,
    include: [...include],
    truncated: packed.truncated,
  };

  if (pathReads) view.paths = packed.lists.paths.items as PathRead[];
  if (sections.has('mappings')) {
    view.mappings = packed.lists.mappings.items as Mapping[];
    view.total_mappings = packed.lists.mappings.total;
    view.mappings_truncated = packed.lists.mappings.next_offset !== null;
  }
  if (sections.has('fields')) {
    view.fields = packed.lists.fields.items as FieldEntry[];
    view.total_fields = packed.lists.fields.total;
    view.fields_truncated = packed.lists.fields.next_offset !== null;
  }
  if (sections.has('datapills')) {
    view.available_datapills = packed.lists.available_datapills.items as DatapillRef[];
    view.total_datapills = packed.lists.available_datapills.total;
    view.datapills_truncated = packed.lists.available_datapills.next_offset !== null;
  }
  if (sections.has('schemas')) {
    view.schemas = {
      input: packed.lists.schema_input.items,
      output: packed.lists.schema_output.items,
    };
    view.total_schema_input = packed.lists.schema_input.total;
    view.total_schema_output = packed.lists.schema_output.total;
  }
  if (packed.truncated && packed.next_offsets && opts.emitCursor !== false) {
    view.next_cursor = encodeCursor({ o: packed.next_offsets });
  }
  return view;
}

/**
 * Inspect several steps against ONE snapshot. The budget is spent in order;
 * when it runs out the cursor names the step to resume at, so a wide read
 * continues without refetching the recipe.
 */
export function inspectSteps(
  code: RawNode,
  nodes: Array<{ ref: string; node: RawNode }>,
  recipeId: number,
  opts: InspectStepOptions & { stepOffset?: number; notFound?: string[] } = {},
): MultiStepView {
  const budgetChars = opts.budgetChars ?? DEFAULT_STEP_BUDGET_CHARS;
  const start = Math.max(0, Math.min(opts.stepOffset ?? 0, nodes.length));
  const views: StepView[] = [];
  let remaining = budgetChars;
  let truncated = false;
  let nextCursor: string | undefined;

  for (let index = start; index < nodes.length; index += 1) {
    if (remaining <= 0 && views.length > 0) {
      truncated = true;
      nextCursor = encodeCursor({ s: index, o: {} });
      break;
    }
    const offsets = index === start ? opts.offsets : undefined;
    const view = inspectStep(code, nodes[index].node, recipeId, {
      ...opts,
      offsets,
      budgetChars: Math.max(remaining, 1),
    });
    views.push(view);
    remaining -= (JSON.stringify(view) ?? '').length;
    if (view.truncated) {
      truncated = true;
      const state = view.next_cursor ? decodeCursor(view.next_cursor) : null;
      // The per-step cursor cannot say which step to resume at; the multi-step
      // one carries both and supersedes it.
      delete view.next_cursor;
      nextCursor = encodeCursor({ s: index, o: state?.o ?? {} });
      break;
    }
  }

  const payload: MultiStepView = {
    recipe_id: recipeId,
    version_no: opts.versionNo ?? 0,
    steps: views,
    requested: nodes.length,
    returned: views.length,
    truncated,
  };
  if (opts.notFound && opts.notFound.length > 0) payload.not_found = opts.notFound;
  if (nextCursor) payload.next_cursor = nextCursor;
  return payload;
}
