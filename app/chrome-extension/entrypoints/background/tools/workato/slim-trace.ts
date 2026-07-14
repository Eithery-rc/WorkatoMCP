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

function summarize(value: unknown, limit: number = SUMMARY_LIMIT): string {
  const cleaned = stripSchemaNoise(value);
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
      input_summary: summarize(l.input),
      output_summary: summarize(l.output),
    })),
    lines_truncated: Boolean(lineDetails.lines_truncated),
    kms_error: Boolean(lineDetails.kms_error),
  };
}
