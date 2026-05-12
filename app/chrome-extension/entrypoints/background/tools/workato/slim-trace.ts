/**
 * Pure helpers that reshape Workato's verbose job-trace responses into the
 * slim shape v1 returns by default. No I/O, no Chrome APIs — safe to unit-test
 * with fixtures.
 *
 * Endpoint shapes documented in SKILL.md "Pull job report" section.
 */

const SUMMARY_LIMIT = 500;

function summarize(value: unknown): string {
  let s: string;
  try {
    if (typeof value === 'string') {
      s = value;
    } else {
      const stringified = JSON.stringify(value);
      s = stringified === undefined ? String(value) : stringified;
    }
  } catch {
    s = String(value);
  }
  if (s.length <= SUMMARY_LIMIT) return s;
  return s.slice(0, SUMMARY_LIMIT) + '...';
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
