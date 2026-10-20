/**
 * Bounded-read primitives shared by the Workato recipe read path.
 *
 * Three problems this solves, all of them measured on real recipes:
 *
 *  1. A compact recipe view reached 94k characters because embedded schema
 *     strings and Python bodies were copied whole. `previewLongValues`
 *     replaces them with a marker that names the exact path to read back, so
 *     nothing is silently lost: `paths:["input.code"]` or `view:"full"`
 *     returns the value verbatim.
 *  2. Nothing on the read path had a limit that a query could not remove.
 *     `packLists` applies `max_items` and a character budget to EVERY list,
 *     cutting at item boundaries and reporting the totals it cut against.
 *  3. A cut list was a dead end. `encodeCursor` / `decodeCursor` carry the
 *     per-list offsets so the next call continues where this one stopped,
 *     without repeating items.
 *
 * Everything here is pure and runs in the service worker.
 */

/** Strings longer than this are previewed, not returned whole. */
export const PREVIEW_CAP = 240;

/** Default number of items returned per list. */
export const DEFAULT_MAX_ITEMS = 60;

/** Hard ceiling on `max_items`, whatever the caller asks for. */
export const MAX_MAX_ITEMS = 500;

/** Default response budget for a step view. */
export const DEFAULT_STEP_BUDGET_CHARS = 12_000;

/** Default response budget for a whole-recipe (compact/outline) view. */
export const DEFAULT_COMPACT_BUDGET_CHARS = 60_000;

/** Smallest and largest budget a caller may ask for. */
export const MIN_BUDGET_CHARS = 500;
export const MAX_BUDGET_CHARS = 400_000;

/**
 * Keys whose value is an embedded document (a stringified schema, a sample
 * payload, a source body). They are previewed even when the value is an object
 * rather than a string, because the serialized form is what costs the tokens.
 */
const EMBEDDED_KEYS: ReadonlySet<string> = new Set([
  'list_item_schema_json',
  'output_schema',
  'code_output_schema_json',
  'sample_document',
  'code_input',
  'schema',
]);

/** `extended_input_schema`, `extended_output_schema`, `extended_schema`, ... */
const EXTENDED_SCHEMA_RE = /^extended_[a-z_]*schema$/;

/** Source bodies: previewed by default, returned whole with include:'code'. */
const CODE_KEYS: ReadonlySet<string> = new Set(['code', 'query']);

/** The key a path ends in, ignoring any trailing array indices. */
function lastSegment(path: string): string {
  let stripped = path;
  while (/\[[^\]]*\]$/.test(stripped)) stripped = stripped.replace(/\[[^\]]*\]$/, '');
  const dot = stripped.lastIndexOf('.');
  return dot === -1 ? stripped : stripped.slice(dot + 1);
}

/**
 * The replacement for a value that was too long to return. It states how much
 * was kept, the exact path, and the call that returns the value in full.
 * The preview itself follows the marker on the next line.
 */
export function previewMarker(
  path: string,
  chars: number,
  shown: number,
  stepRef?: string,
): string {
  const read = stepRef
    ? `read with step:${JSON.stringify(stepRef)}, paths:${JSON.stringify([path])}`
    : `read with paths:${JSON.stringify([path])}`;
  return `<<preview ${shown} of ${chars} chars; path=${path}; ${read}>>`;
}

/** True when a string carries a preview marker rather than the whole value. */
export function isPreviewed(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('<<preview ');
}

/** Marker plus the first `previewChars` characters of the value. */
export function previewString(
  path: string,
  raw: string,
  previewChars: number,
  stepRef?: string,
): string {
  const shown = Math.min(previewChars, raw.length);
  return `${previewMarker(path, raw.length, shown, stepRef)}\n${raw.slice(0, shown)}`;
}

export interface PreviewOptions {
  /** Characters kept from each previewed value. Default PREVIEW_CAP. */
  previewChars?: number;
  /** Step anchor quoted in the marker's read-back hint. */
  stepRef?: string;
  /** include:'code' returns `code`/`query` bodies whole instead of previewing. */
  keepCode?: boolean;
}

/**
 * Walk a value and replace every long embedded value with a preview marker.
 * Scalars other than strings pass through untouched: `0`, `false` and `null`
 * keep their meaning, and no key is dropped.
 */
export function previewLongValues(value: unknown, opts: PreviewOptions = {}, path = ''): unknown {
  const previewChars = opts.previewChars ?? PREVIEW_CAP;
  const segment = lastSegment(path);

  if (typeof value === 'string') {
    if (opts.keepCode && CODE_KEYS.has(segment)) return value;
    if (value.length > previewChars) {
      return previewString(path, value, previewChars, opts.stepRef);
    }
    return value;
  }

  if (value && typeof value === 'object') {
    const embedded = EMBEDDED_KEYS.has(segment) || EXTENDED_SCHEMA_RE.test(segment);
    if (embedded) {
      const serialized = JSON.stringify(value) ?? '';
      if (serialized.length > previewChars) {
        return previewString(path, serialized, previewChars, opts.stepRef);
      }
    }
    if (Array.isArray(value)) {
      return value.map((entry, index) => previewLongValues(entry, opts, `${path}[${index}]`));
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = previewLongValues(child, opts, path ? `${path}.${key}` : key);
    }
    return out;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Exact path reads: the lossless escape hatch out of any preview.
// ---------------------------------------------------------------------------

export interface PathRead {
  path: string;
  found: boolean;
  value?: unknown;
  /** Serialized length of the value, so the caller can see what it received. */
  chars?: number;
}

/**
 * Split a dotted/bracketed path into tokens. `input.parameters.DryRun`,
 * `input.conditions[0].lhs` and `input["odd.key"]` are all accepted.
 * Returns null when the path is malformed.
 */
export function parsePathTokens(path: string): Array<string | number> | null {
  const tokens: Array<string | number> = [];
  let index = 0;
  let current = '';
  const pushCurrent = (): void => {
    if (current !== '') {
      tokens.push(current);
      current = '';
    }
  };

  while (index < path.length) {
    const char = path[index];
    if (char === '.') {
      pushCurrent();
      index += 1;
      continue;
    }
    if (char === '[') {
      pushCurrent();
      const close = path.indexOf(']', index);
      if (close === -1) return null;
      const inner = path.slice(index + 1, close).trim();
      if (inner.length === 0) return null;
      if (
        (inner.startsWith('"') && inner.endsWith('"')) ||
        (inner.startsWith("'") && inner.endsWith("'"))
      ) {
        tokens.push(inner.slice(1, -1));
      } else if (/^\d+$/.test(inner)) {
        tokens.push(Number(inner));
      } else {
        tokens.push(inner);
      }
      index = close + 1;
      continue;
    }
    current += char;
    index += 1;
  }
  pushCurrent();
  return tokens.length > 0 ? tokens : null;
}

/** Read one exact path out of a node. Missing paths report `found:false`. */
export function readPath(root: unknown, path: string): PathRead {
  const tokens = parsePathTokens(path);
  if (!tokens) return { path, found: false };

  let cursor: unknown = root;
  for (const token of tokens) {
    if (cursor === null || cursor === undefined) return { path, found: false };
    if (typeof token === 'number') {
      if (!Array.isArray(cursor) || token >= cursor.length) return { path, found: false };
      cursor = cursor[token];
      continue;
    }
    if (typeof cursor !== 'object') return { path, found: false };
    const record = cursor as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, token)) return { path, found: false };
    cursor = record[token];
  }

  const serialized = JSON.stringify(cursor);
  return {
    path,
    found: true,
    value: cursor,
    chars: serialized === undefined ? 0 : serialized.length,
  };
}

/** Read several exact paths. Values are returned verbatim, never previewed. */
export function readPaths(root: unknown, paths: string[]): PathRead[] {
  return paths.map((path) => readPath(root, path));
}

// ---------------------------------------------------------------------------
// Limits, budget and continuation.
// ---------------------------------------------------------------------------

export interface ListSpec {
  /** Response key this list is returned under. */
  key: string;
  items: unknown[];
  /** Where this call starts, from the cursor. */
  offset?: number;
  /** Rendered whole, never cut by the budget (exact path reads). */
  exempt?: boolean;
}

export interface PackedList {
  key: string;
  items: unknown[];
  /** Items in the list before any limit was applied. */
  total: number;
  offset: number;
  /** Offset the next call must resume from, or null when the list is done. */
  next_offset: number | null;
}

export interface PackResult {
  lists: Record<string, PackedList>;
  truncated: boolean;
  /** Offsets for every list, present only when something was cut. */
  next_offsets: Record<string, number> | null;
  used_chars: number;
}

function itemCost(item: unknown): number {
  const serialized = JSON.stringify(item);
  return (serialized === undefined ? 4 : serialized.length) + 1;
}

/**
 * Apply `max_items` and a character budget to a set of lists, in the order
 * given. Lists are cut at item boundaries; the first list always yields at
 * least one item so a cursor can never stall on an item larger than the whole
 * budget.
 */
export function packLists(
  specs: ListSpec[],
  options: { maxItems: number; budgetChars: number; baseChars?: number },
): PackResult {
  const maxItems = Math.max(1, Math.min(options.maxItems, MAX_MAX_ITEMS));
  let remaining = Math.max(0, options.budgetChars - (options.baseChars ?? 0));
  let used = 0;
  let anyRendered = false;

  const lists: Record<string, PackedList> = {};
  let truncated = false;

  for (const spec of specs) {
    const offset = Math.max(0, Math.min(spec.offset ?? 0, spec.items.length));
    const items: unknown[] = [];
    let index = offset;

    while (index < spec.items.length && items.length < maxItems) {
      const item = spec.items[index];
      const cost = itemCost(item);
      const mustTake = spec.exempt === true || (!anyRendered && items.length === 0);
      if (!mustTake && cost > remaining) break;
      items.push(item);
      remaining = Math.max(0, remaining - cost);
      used += cost;
      anyRendered = true;
      index += 1;
    }

    const done = index >= spec.items.length;
    lists[spec.key] = {
      key: spec.key,
      items,
      total: spec.items.length,
      offset,
      next_offset: done ? null : index,
    };
    if (!done) truncated = true;
  }

  const next_offsets = truncated
    ? Object.fromEntries(
        Object.values(lists).map((list) => [
          list.key,
          list.next_offset === null ? list.total : list.next_offset,
        ]),
      )
    : null;

  return { lists, truncated, next_offsets, used_chars: used };
}

// ---------------------------------------------------------------------------
// Cursors.
// ---------------------------------------------------------------------------

export interface CursorState {
  v: 1;
  /** Index of the first step not fully rendered, for multi-step reads. */
  s?: number;
  /** Per-list offsets, keyed by response key. */
  o: Record<string, number>;
}

function toBase64(text: string): string {
  const bytes = encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  return btoa(bytes);
}

function fromBase64(text: string): string {
  const bytes = atob(text);
  let percent = '';
  for (let i = 0; i < bytes.length; i += 1) {
    percent += `%${`00${bytes.charCodeAt(i).toString(16)}`.slice(-2)}`;
  }
  return decodeURIComponent(percent);
}

/** Encode list offsets into the opaque `cursor` string. */
export function encodeCursor(state: Omit<CursorState, 'v'>): string {
  return toBase64(JSON.stringify({ v: 1, ...state }));
}

/** Decode a `cursor`. Returns null for anything this build did not produce. */
export function decodeCursor(raw: string): CursorState | null {
  try {
    const parsed = JSON.parse(fromBase64(raw)) as CursorState;
    if (!parsed || parsed.v !== 1 || typeof parsed.o !== 'object' || parsed.o === null) return null;
    const offsets: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed.o)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        offsets[key] = Math.floor(value);
      }
    }
    const state: CursorState = { v: 1, o: offsets };
    if (typeof parsed.s === 'number' && Number.isFinite(parsed.s) && parsed.s >= 0) {
      state.s = Math.floor(parsed.s);
    }
    return state;
  } catch {
    return null;
  }
}

/** Clamp `max_items` to the documented range. */
export function normalizeMaxItems(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_ITEMS;
  return Math.max(1, Math.min(Math.floor(value), MAX_MAX_ITEMS));
}

/** Clamp `budget_chars` to the documented range. */
export function normalizeBudgetChars(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(MIN_BUDGET_CHARS, Math.min(Math.floor(value), MAX_BUDGET_CHARS));
}
