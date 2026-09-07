/**
 * Pure helpers behind workato_list_jobs: job shaping, report-column labelling,
 * field projection, date-bound normalization and coverage reporting.
 *
 * No I/O, no Chrome APIs, nothing that runs in the page. Every function here is
 * unit-tested with fixtures taken from a live jobs.json capture (2026-09-07).
 *
 * Shapes this module relies on, all live-verified:
 *   - a job carries id, status, started_at, completed_at, title, report,
 *     erased, zero_retention, is_test and, for a called job,
 *     calling_recipe_id / calling_job_id / root_recipe_id / root_job_id.
 *   - `report` is keyed custom_column_0 .. custom_column_9. An ERASED job has
 *     report null, title "" and NO error key even when it failed, so "no data"
 *     and "empty data" must be told apart in the response.
 *   - the column LABELS are not in the job at all: they live on the recipe
 *     code tree's trigger node as job_report_schema [{name, label}].
 */

export type ReportValue = string | number | boolean | null;

export interface ReportColumn {
  /** custom_column_0 .. custom_column_9 */
  name: string;
  /** Label configured on the recipe trigger, or null when the column is unlabelled. */
  label: string | null;
}

export interface SlimJob {
  id: string;
  status: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  error_summary?: string;
  error_line_number?: number;
  /** null when the job was erased: the title is unavailable, not empty. */
  title: string | null;
  /** null when the job was erased. Otherwise every custom_column_*, keyed by label when known. */
  report: Record<string, ReportValue> | null;
  erased: boolean;
  zero_retention: boolean;
  is_test: boolean;
  calling_recipe_id?: number;
  calling_job_id?: string;
}

export type MatchMode = 'exact' | 'substring' | 'regex';

export interface MatchSpec {
  mode: MatchMode;
  fields: string[];
  value: string;
}

/** Fields a local scan can look at. `report.<label>` and `report.<custom_column_N>` are also accepted. */
export const MATCH_FIELDS: readonly string[] = ['id', 'title', 'error', 'report'];

export const DEFAULT_MATCH_FIELDS: readonly string[] = ['id', 'title', 'error', 'report'];

/** Top-level keys a `fields` projection may ask for, besides report.<column>. */
export const PROJECTABLE_JOB_FIELDS: readonly string[] = [
  'id',
  'status',
  'started_at',
  'completed_at',
  'duration_ms',
  'error_summary',
  'error_line_number',
  'title',
  'report',
  'erased',
  'zero_retention',
  'is_test',
  'calling_recipe_id',
  'calling_job_id',
];

const CUSTOM_COLUMN = /^custom_column_(\d+)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function keepPrimitive(value: unknown): ReportValue {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  // 0 and false are real report values and must survive.
  if (t === 'string' || t === 'number' || t === 'boolean') return value as ReportValue;
  return String(value);
}

/**
 * Read job_report_schema off a recipe code tree (parsed object or the
 * stringified form code.json returns). The schema lives on the root/trigger
 * node; anything else shape-wise yields an empty column list rather than an
 * error, because a recipe without a configured job report is normal.
 */
export function parseReportColumns(code: unknown): ReportColumn[] {
  let tree: unknown = code;
  if (typeof code === 'string') {
    try {
      tree = JSON.parse(code);
    } catch {
      return [];
    }
  }
  if (!isRecord(tree)) return [];
  const schema = tree.job_report_schema;
  if (!Array.isArray(schema)) return [];
  const out: ReportColumn[] = [];
  for (const entry of schema) {
    if (!isRecord(entry)) continue;
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (!CUSTOM_COLUMN.test(name)) continue;
    const label = typeof entry.label === 'string' && entry.label !== '' ? entry.label : null;
    out.push({ name, label });
  }
  return out;
}

/** custom_column_N -> label, for the columns that have one. */
export function reportLabelMap(columns: readonly ReportColumn[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const column of columns) {
    if (column.label) map[column.name] = column.label;
  }
  return map;
}

/**
 * The slim job shape. Every custom_column_* present on the job is kept (the
 * old shape stopped at col_2 and dropped the rest), keyed by its configured
 * label when one is known and by custom_column_N when it is not.
 */
export function shapeSlimJob(raw: Record<string, unknown>, columns: readonly ReportColumn[] = []) {
  const started = raw.started_at != null ? String(raw.started_at) : '';
  const completed = raw.completed_at != null ? String(raw.completed_at) : '';
  const rawDuration =
    started && completed ? new Date(completed).getTime() - new Date(started).getTime() : 0;
  const duration_ms = Number.isFinite(rawDuration) ? rawDuration : 0;
  const err = isRecord(raw.error) ? raw.error : undefined;
  const erased = raw.erased === true;
  const labels = reportLabelMap(columns);

  let report: Record<string, ReportValue> | null = null;
  if (!erased && isRecord(raw.report)) {
    report = {};
    for (const [key, value] of Object.entries(raw.report)) {
      if (!CUSTOM_COLUMN.test(key)) continue;
      report[labels[key] ?? key] = keepPrimitive(value);
    }
  }

  const slim: SlimJob = {
    id: String(raw.id ?? ''),
    status: String(raw.status ?? 'unknown'),
    started_at: started,
    completed_at: completed,
    duration_ms,
    error_summary: err?.message != null ? String(err.message) : undefined,
    error_line_number: typeof err?.line_number === 'number' ? err.line_number : undefined,
    // An erased job has no title and no report to give. Reporting '' here is
    // what made "unavailable" indistinguishable from "empty".
    title: erased ? null : String(raw.title ?? ''),
    report: erased ? null : report,
    erased,
    zero_retention: raw.zero_retention === true,
    is_test: raw.is_test === true,
  };
  if (raw.calling_recipe_id != null) slim.calling_recipe_id = Number(raw.calling_recipe_id);
  if (raw.calling_job_id != null) slim.calling_job_id = String(raw.calling_job_id);
  return slim;
}

export interface FieldValidation {
  ok: boolean;
  fields?: string[];
  error?: string;
}

/** Validate a `fields` projection list against the slim shape. */
export function validateJobFields(fields: unknown): FieldValidation {
  if (fields === undefined || fields === null) return { ok: true, fields: undefined };
  if (!Array.isArray(fields) || fields.length === 0) {
    return { ok: false, error: 'Param [fields] must be a non-empty array of field names.' };
  }
  const cleaned: string[] = [];
  for (const field of fields) {
    if (typeof field !== 'string' || field.trim() === '') {
      return { ok: false, error: 'Param [fields] entries must be non-empty strings.' };
    }
    const name = field.trim();
    if (name.startsWith('report.') && name.length > 'report.'.length) {
      cleaned.push(name);
      continue;
    }
    if (!PROJECTABLE_JOB_FIELDS.includes(name)) {
      return {
        ok: false,
        error:
          `Unknown field "${name}". Allowed: ${PROJECTABLE_JOB_FIELDS.join(', ')}, ` +
          'or report.<column label> / report.<custom_column_N>.',
      };
    }
    cleaned.push(name);
  }
  return { ok: true, fields: cleaned };
}

/**
 * Project a slim job down to the requested fields.
 *
 * Unavailable data is reported as null, never as an empty string or a missing
 * key, and an erased job always carries erased:true so the caller can tell why
 * the value is null.
 */
export function projectJobFields(
  slim: SlimJob,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const report: Record<string, ReportValue> = {};
  let wantsReportSubset = false;

  for (const field of fields) {
    if (field === 'report') {
      out.report = slim.report;
      continue;
    }
    if (field.startsWith('report.')) {
      wantsReportSubset = true;
      const column = field.slice('report.'.length);
      report[column] = slim.report ? (slim.report[column] ?? null) : null;
      continue;
    }
    const value = (slim as unknown as Record<string, unknown>)[field];
    out[field] = value === undefined ? null : value;
  }

  if (wantsReportSubset) {
    out.report = slim.report === null ? null : { ...(out.report as object | null), ...report };
  }
  if (slim.erased) out.erased = true;
  return out;
}

export interface MatchValidation {
  ok: boolean;
  match?: MatchSpec | null;
  error?: string;
}

/** Validate and normalize the local-scan `match` argument. */
export function normalizeMatchSpec(raw: unknown): MatchValidation {
  if (raw === undefined || raw === null) return { ok: true, match: null };
  if (!isRecord(raw)) {
    return { ok: false, error: 'Param [match] must be an object {mode, fields, value}.' };
  }
  const value = raw.value;
  if (typeof value !== 'string' || value === '') {
    return { ok: false, error: 'Param [match.value] must be a non-empty string.' };
  }
  const mode = raw.mode === undefined ? 'substring' : raw.mode;
  if (mode !== 'exact' && mode !== 'substring' && mode !== 'regex') {
    return { ok: false, error: "Param [match.mode] must be 'exact', 'substring' or 'regex'." };
  }
  let fields: string[] = [...DEFAULT_MATCH_FIELDS];
  if (raw.fields !== undefined) {
    if (!Array.isArray(raw.fields) || raw.fields.length === 0) {
      return { ok: false, error: 'Param [match.fields] must be a non-empty array of field names.' };
    }
    fields = [];
    for (const field of raw.fields) {
      if (typeof field !== 'string' || field.trim() === '') {
        return { ok: false, error: 'Param [match.fields] entries must be non-empty strings.' };
      }
      const name = field.trim();
      if (name.startsWith('report.') && name.length > 'report.'.length) {
        fields.push(name);
        continue;
      }
      if (!MATCH_FIELDS.includes(name)) {
        return {
          ok: false,
          error:
            `Unknown match field "${name}". Allowed: ${MATCH_FIELDS.join(', ')}, ` +
            'or report.<column label> / report.<custom_column_N>.',
        };
      }
      fields.push(name);
    }
  }
  if (mode === 'regex') {
    try {
      new RegExp(value, 'i');
    } catch (e) {
      return {
        ok: false,
        error: `Param [match.value] is not a valid regular expression: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }
  return { ok: true, match: { mode, fields, value } };
}

export interface BoundNormalization {
  ok: boolean;
  value?: string;
  error?: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(Z|z|[+-]\d{2}:?\d{2})$/;
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;

/**
 * Resolve a timezone argument to a fixed ±HH:MM offset.
 *
 * Accepts 'UTC'/'Z', a literal offset ('-07:00', '+0530') and an IANA zone
 * name, whose offset is resolved for the given instant so a summer date gets
 * the DST offset. Within the hour of a DST transition the resolved offset can
 * be the neighbouring one; pass a literal offset when that matters.
 */
export function resolveTimezoneOffset(timezone: string | undefined, atIso: string): string | null {
  const tz = (timezone ?? 'UTC').trim();
  if (tz === '' || tz.toUpperCase() === 'UTC' || tz.toUpperCase() === 'Z') return '+00:00';
  const literal = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (literal) return `${literal[1]}${literal[2]}:${literal[3]}`;
  const probe = new Date(`${atIso}Z`);
  if (Number.isNaN(probe.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    }).formatToParts(probe);
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    if (name === 'GMT') return '+00:00';
    const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
    if (!match) return null;
    return `${match[1]}${match[2]}:${match[3] ?? '00'}`;
  } catch {
    return null;
  }
}

/**
 * Normalize a started_from / started_to bound to an ISO-8601 timestamp with an
 * explicit offset, which is the shape the jobs endpoint filters on.
 *
 * A date-only bound is widened to the whole day: 'from' takes 00:00:00 and
 * 'to' takes 23:59:59, so started_from=2026-07-18 and started_to=2026-07-18
 * select that day. A value that already carries an offset is passed through
 * untouched, and the timezone argument is then irrelevant.
 */
export function normalizeStartedBound(
  raw: unknown,
  timezone: string | undefined,
  edge: 'from' | 'to',
): BoundNormalization {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined };
  if (typeof raw !== 'string') {
    return { ok: false, error: `Param [started_${edge}] must be a string.` };
  }
  const value = raw.trim();
  if (HAS_OFFSET.test(value)) {
    if (Number.isNaN(new Date(value).getTime())) {
      return { ok: false, error: `Param [started_${edge}] is not a valid timestamp: "${raw}".` };
    }
    return { ok: true, value };
  }
  let local: string;
  if (DATE_ONLY.test(value)) {
    local = edge === 'from' ? `${value}T00:00:00` : `${value}T23:59:59`;
  } else if (LOCAL_DATETIME.test(value)) {
    local = value.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) local = `${local}:00`;
  } else {
    return {
      ok: false,
      error:
        `Param [started_${edge}] must be YYYY-MM-DD, YYYY-MM-DDTHH:MM(:SS) or a full ISO-8601 ` +
        `timestamp with an offset. Got "${raw}".`,
    };
  }
  const offset = resolveTimezoneOffset(timezone, local);
  if (offset === null) {
    return {
      ok: false,
      error: `Param [timezone] is not a usable zone or offset: "${timezone}". Use 'UTC', an offset like '-07:00', or an IANA name like 'America/Los_Angeles'.`,
    };
  }
  return { ok: true, value: `${local}${offset}` };
}

export interface JobScanCoverage {
  search_mode: 'backend' | 'local' | 'both';
  scanned: number;
  matched: number;
  erased_seen: number;
  from_started_at?: string;
  through_started_at?: string;
  complete: boolean;
  next_cursor?: string;
  retention_boundary_reached: boolean;
  stopped_reason: string;
  scan_budget: number;
  limit: number;
}

/**
 * One sentence the model can quote. Absence of matches is only ever reported
 * as absence when the scan actually finished.
 */
export function buildCoverageSummary(coverage: JobScanCoverage): string {
  const window =
    coverage.from_started_at && coverage.through_started_at
      ? ` (${coverage.from_started_at} back through ${coverage.through_started_at})`
      : '';
  const parts = [
    `Scanned ${coverage.scanned} job(s)${window}, ${coverage.matched} matched, ` +
      `${coverage.erased_seen} erased.`,
  ];
  if (coverage.retention_boundary_reached) {
    parts.push(
      'Stopped at the retention boundary: 3 consecutive erased jobs, and everything older in ' +
        'this workspace is erased too, so no older job can be searched.',
    );
  } else if (coverage.complete) {
    parts.push('Scan complete: the end of the job list was reached.');
  } else {
    const reason =
      coverage.stopped_reason === 'limit'
        ? `the limit of ${coverage.limit} match(es) was filled`
        : coverage.stopped_reason === 'scan_budget'
          ? `the scan budget of ${coverage.scan_budget} job(s) ran out`
          : coverage.stopped_reason === 'time_budget'
            ? 'the time budget ran out'
            : `the walk stopped (${coverage.stopped_reason})`;
    parts.push(
      `Scan INCOMPLETE: ${reason}, so older jobs were never looked at` +
        (coverage.next_cursor ? `; resume with cursor "${coverage.next_cursor}".` : '.'),
    );
    if (coverage.matched === 0) {
      parts.push('Zero matches here is NOT proof that none exist.');
    }
  }
  return parts.join(' ');
}
