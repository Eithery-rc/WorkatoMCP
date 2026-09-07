/**
 * Pure helpers that reshape Workato's verbose job-trace responses into the
 * slim shape v1 returns by default. No I/O, no Chrome APIs — safe to unit-test
 * with fixtures.
 *
 * Endpoint shapes documented in SKILL.md "Pull job report" section.
 */

const SUMMARY_LIMIT = 500;

/**
 * Keys that carry schema metadata, not data. A single SOQL step's input can
 * embed hundreds of tokens of escaped output_schema that crowd out the
 * actually-useful payload before truncation. Same strip pull_recipe's compact
 * view applies.
 */
const SCHEMA_NOISE_KEYS = new Set([
  'output_schema',
  'input_schema',
  'extended_input_schema',
  'extended_output_schema',
  'dynamicPickListSelection',
  'visible_config_fields',
]);

/** Recursively drop schema-noise keys (depth-limited; never mutates input). */
export function stripSchemaNoise(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') {
    // Strings sometimes contain an escaped JSON object with the same noise
    // (Workato stringifies step input). Try to parse-strip-restringify.
    if (typeof value === 'string' && value.length > 200 && /output_schema/.test(value)) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          return JSON.stringify(stripSchemaNoise(parsed, depth + 1));
        }
      } catch {
        /* not JSON — leave as-is */
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => stripSchemaNoise(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SCHEMA_NOISE_KEYS.has(k)) {
      out[k] = '<stripped>';
      continue;
    }
    out[k] = stripSchemaNoise(v, depth + 1);
  }
  return out;
}

/**
 * How an `empty` policy treats a value. 'keep' returns the data untouched;
 * 'drop' removes undefined, null, '', {} and [] and NOTHING else: 0 and false
 * are data and always survive.
 */
export type EmptyPolicy = 'keep' | 'drop';

export interface TraceProjectionOptions {
  /** Nested paths to keep, e.g. ['body.items[].id', 'headers.status']. */
  paths?: readonly string[] | null;
  /** Default 'keep'. */
  empty?: EmptyPolicy;
  /** Arrays longer than this become a preview object carrying the total. 0 = off. */
  maxItems?: number | null;
}

type PathToken =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse a projection path into tokens.
 *
 * Grammar: dotted keys, [N] for one array index, [] for every element, and
 * ['quoted key'] for a key containing a dot.
 */
export function parsePath(path: string): PathToken[] {
  const tokens: PathToken[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer !== '') {
      tokens.push({ kind: 'key', key: buffer });
      buffer = '';
    }
  };
  for (let i = 0; i < path.length; i++) {
    const char = path[i];
    if (char === '.') {
      flush();
      continue;
    }
    if (char === '[') {
      flush();
      const close = path.indexOf(']', i);
      if (close < 0) {
        buffer += char;
        continue;
      }
      const inner = path.slice(i + 1, close).trim();
      i = close;
      if (inner === '') {
        tokens.push({ kind: 'wildcard' });
      } else if (/^\d+$/.test(inner)) {
        tokens.push({ kind: 'index', index: Number(inner) });
      } else {
        tokens.push({ kind: 'key', key: inner.replace(/^['"]|['"]$/g, '') });
      }
      continue;
    }
    buffer += char;
  }
  flush();
  return tokens;
}

function pickPath(
  source: unknown,
  tokens: readonly PathToken[],
  index: number,
): { found: boolean; value?: unknown } {
  if (index >= tokens.length) return { found: true, value: source };
  const token = tokens[index];
  if (token.kind === 'key') {
    if (!isRecord(source) || !(token.key in source)) return { found: false };
    const child = pickPath(source[token.key], tokens, index + 1);
    if (!child.found) return { found: false };
    return { found: true, value: { [token.key]: child.value } };
  }
  if (token.kind === 'index') {
    if (!Array.isArray(source) || token.index >= source.length) return { found: false };
    const child = pickPath(source[token.index], tokens, index + 1);
    if (!child.found) return { found: false };
    // Sparse on purpose: the surviving element keeps its original index.
    const out: unknown[] = [];
    out.length = token.index + 1;
    out[token.index] = child.value;
    return { found: true, value: out };
  }
  if (!Array.isArray(source)) return { found: false };
  const out: unknown[] = [];
  out.length = source.length;
  let any = false;
  for (let i = 0; i < source.length; i++) {
    const child = pickPath(source[i], tokens, index + 1);
    out[i] = child.found ? child.value : null;
    if (child.found) any = true;
  }
  return any ? { found: true, value: out } : { found: false };
}

function mergeProjections(a: unknown, b: unknown): unknown {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: unknown[] = [];
    out.length = Math.max(a.length, b.length);
    for (let i = 0; i < out.length; i++) {
      const left = a[i];
      const right = b[i];
      out[i] = left === undefined || left === null ? right : mergeProjections(left, right);
    }
    return out;
  }
  if (isRecord(a) && isRecord(b)) {
    const out: Record<string, unknown> = { ...a };
    for (const [key, value] of Object.entries(b)) {
      out[key] = key in out ? mergeProjections(out[key], value) : value;
    }
    return out;
  }
  return b;
}

export interface PathProjection {
  value: unknown;
  matched: string[];
  unmatched: string[];
}

/** Keep only the requested paths, preserving array indices along the way. */
export function projectPathsDetailed(value: unknown, paths: readonly string[]): PathProjection {
  const matched: string[] = [];
  const unmatched: string[] = [];
  let out: unknown = undefined;
  for (const path of paths) {
    const tokens = parsePath(path);
    if (tokens.length === 0) {
      unmatched.push(path);
      continue;
    }
    const picked = pickPath(value, tokens, 0);
    if (!picked.found) {
      unmatched.push(path);
      continue;
    }
    matched.push(path);
    out = out === undefined ? picked.value : mergeProjections(out, picked.value);
  }
  return { value: out === undefined ? {} : out, matched, unmatched };
}

export function projectPaths(value: unknown, paths: readonly string[]): unknown {
  return projectPathsDetailed(value, paths).value;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  // 0, false, NaN are data.
  return false;
}

/**
 * Drop empty values from objects. Arrays are mapped, NEVER filtered, so an
 * element that prunes to {} keeps its index and every later index still means
 * what it meant. 0 and false always survive.
 */
export function pruneEmpty(value: unknown, depth = 0): unknown {
  if (depth > 12) return value;
  if (Array.isArray(value)) return value.map((entry) => pruneEmpty(entry, depth + 1));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const pruned = pruneEmpty(entry, depth + 1);
    if (isEmptyValue(pruned)) continue;
    out[key] = pruned;
  }
  return out;
}

export interface ArrayPreview {
  _array_preview: true;
  total: number;
  shown: number;
  items: unknown[];
}

/** Replace a long array with its first `maxItems` entries plus the real total. */
export function previewArrays(value: unknown, maxItems: number, depth = 0): unknown {
  if (depth > 12 || !maxItems || maxItems <= 0) return value;
  if (Array.isArray(value)) {
    const mapped = value.map((entry) => previewArrays(entry, maxItems, depth + 1));
    if (mapped.length <= maxItems) return mapped;
    const preview: ArrayPreview = {
      _array_preview: true,
      total: mapped.length,
      shown: maxItems,
      items: mapped.slice(0, maxItems),
    };
    return preview;
  }
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = previewArrays(entry, maxItems, depth + 1);
  }
  return out;
}

/**
 * paths -> empty policy -> array previews, in that order, on an already
 * schema-stripped value. Deliberately a separate pass from stripSchemaNoise:
 * that function re-stringifies embedded JSON strings, and pruning inside that
 * path would rewrite a step's serialized input.
 */
export function applyTraceProjection(value: unknown, options?: TraceProjectionOptions): unknown {
  if (!options) return value;
  let out = value;
  if (options.paths && options.paths.length > 0) out = projectPaths(out, options.paths);
  if (options.empty === 'drop') out = pruneEmpty(out);
  if (options.maxItems && options.maxItems > 0) out = previewArrays(out, options.maxItems);
  return out;
}

/** Keys a `fields` projection may keep on a trace step. */
export const STEP_FIELDS: readonly string[] = [
  'recipe_line_number',
  'adapter_name',
  'adapter_operation',
  'input',
  'output',
  'input_summary',
  'output_summary',
];

/**
 * Keep only the requested keys on a step. recipe_line_number is always kept:
 * a step nobody can identify is not a saving.
 */
export function pickStepFields(
  step: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const keep = new Set<string>(fields);
  keep.add('recipe_line_number');
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(step)) {
    if (keep.has(key)) out[key] = step[key];
  }
  return out;
}

function summarizeValue(cleaned: unknown, limit: number = SUMMARY_LIMIT): string {
  let s: string;
  try {
    if (typeof cleaned === 'string') {
      s = cleaned;
    } else {
      const stringified = JSON.stringify(cleaned);
      s = stringified === undefined ? String(cleaned) : stringified;
    }
  } catch {
    s = String(cleaned);
  }
  if (s.length <= limit) return s;
  return s.slice(0, limit) + '...';
}

export interface RawMetaResponse {
  result?: {
    job?: {
      id?: string | number;
      status?: string;
      started_at?: string;
      completed_at?: string;
      error?: {
        message?: string;
        error_type?: string;
        line_number?: number;
        adapter?: string;
        action?: string;
      };
    };
    recipe?: {
      id?: number;
      name?: string;
      version_no?: number;
    };
  };
}

export interface RawLineDetailsResponse {
  line_details?: Array<{
    recipe_line_number?: number;
    adapter_name?: string;
    adapter_operation?: string;
    input?: unknown;
    output?: unknown;
  }>;
  lines_truncated?: boolean;
  kms_error?: boolean;
}

export interface SlimTrace {
  job_id: string | number;
  recipe: { id: number; name: string; version_no: number };
  status: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  error?: {
    message: string;
    error_type: string;
    line_number: number;
    adapter: string;
    action: string;
  };
  steps: Array<{
    recipe_line_number: number;
    adapter_name: string;
    adapter_operation: string;
    input_summary: string;
    output_summary: string;
  }>;
  lines_truncated: boolean;
  kms_error: boolean;
}

export function buildSlimTrace(
  jobId: string | number,
  meta: RawMetaResponse,
  lineDetails: RawLineDetailsResponse,
  projection?: TraceProjectionOptions,
): SlimTrace {
  const job = meta.result?.job ?? {};
  const recipe = meta.result?.recipe ?? {};

  const started = job.started_at ?? '';
  const finished = job.completed_at ?? '';
  const rawDuration =
    started && finished ? new Date(finished).getTime() - new Date(started).getTime() : 0;
  const duration_ms = Number.isFinite(rawDuration) ? rawDuration : 0;

  return {
    job_id: jobId,
    recipe: {
      id: Number(recipe.id ?? 0),
      name: String(recipe.name ?? ''),
      version_no: Number(recipe.version_no ?? 0),
    },
    status: String(job.status ?? 'unknown'),
    started_at: started,
    completed_at: finished,
    duration_ms,
    error: job.error
      ? {
          message: String(job.error.message ?? ''),
          error_type: String(job.error.error_type ?? ''),
          line_number: Number(job.error.line_number ?? -1),
          adapter: String(job.error.adapter ?? ''),
          action: String(job.error.action ?? ''),
        }
      : undefined,
    steps: (lineDetails.line_details ?? []).map((l) => ({
      recipe_line_number: Number(l.recipe_line_number ?? -1),
      adapter_name: String(l.adapter_name ?? ''),
      adapter_operation: String(l.adapter_operation ?? ''),
      // Project BEFORE summarising, so the 500-char budget is spent on the
      // data that was asked for rather than on the fields around it.
      input_summary: summarizeValue(applyTraceProjection(stripSchemaNoise(l.input), projection)),
      output_summary: summarizeValue(applyTraceProjection(stripSchemaNoise(l.output), projection)),
    })),
    lines_truncated: Boolean(lineDetails.lines_truncated),
    kms_error: Boolean(lineDetails.kms_error),
  };
}
