/**
 * Durable journal for multi-recipe Workato operations.
 *
 * ## Why a file, not a closure
 *
 * `workato_recipe_save_with_dependents` stops several recipes, saves one, and
 * puts the others back. Every one of those steps is a nested bridge call with
 * a 120 s ceiling, and a stop or a save can legitimately spend most of that.
 * When one of them times out, the closure holding "which recipes did I stop"
 * dies with the request, and the next client call has no way to learn that
 * three production callers are sitting stopped.
 *
 * So the state lives on disk, one JSON file per operation, in the same state
 * directory the bridge already uses for its update flag. The phase is written
 * BEFORE each nested call, never after: a journal that records what we were
 * about to do survives the call that never came back, while one that records
 * what we finished does not.
 *
 * ## What is not stored
 *
 * Recipe code bodies. A tree can be hundreds of kilobytes and it is already on
 * disk when the caller passed `code_path`; the journal keeps the path, or a
 * sha256 of an inline tree so a resume can at least say whether the code it is
 * being handed is the same one. Never credentials.
 *
 * ## Retention
 *
 * 200 files or 7 days, whichever bites first, pruned once per process on the
 * first journal write. An operation journal is a recovery aid, not an audit
 * log; keeping it unbounded in a user's state directory would be rude.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';

import { updateStateDir } from '../update-checker';

type JsonObject = Record<string, unknown>;

export const OPERATION_RETENTION_FILES = 200;
export const OPERATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Ordered lifecycle of a save_with_dependents operation. */
export const OPERATION_PHASES = [
  'discovery',
  'preflight',
  'stops',
  'save',
  'restore',
  'done',
] as const;
export type OperationPhaseName = (typeof OPERATION_PHASES)[number];

export type PhaseStatus = 'running' | 'ok' | 'failed' | 'interrupted' | 'skipped';
export type OperationStatus = 'running' | 'done' | 'failed' | 'interrupted';

export interface OperationPhaseRecord extends JsonObject {
  name: OperationPhaseName;
  status: PhaseStatus;
  started_at: string;
  ended_at?: string;
  /** Recipe ids this phase was acting on when it was entered. */
  affected_ids?: number[];
  result?: JsonObject;
  error?: string;
}

export interface OperationRecipeState extends JsonObject {
  running: boolean | null;
  state?: string | null;
  version_no?: number | null;
}

export interface OperationRecipe extends JsonObject {
  recipe_id: number;
  name?: string;
  role: 'callee' | 'caller';
  initial: OperationRecipeState;
  /** Set once the orchestrator or a resume acted on this recipe. */
  stopped?: boolean;
  restarted?: boolean | null;
  restart_outcome?: string;
  connections_healthy?: boolean | null;
  connections_reason?: string;
  error?: string;
  discovered_late?: boolean;
}

export interface OperationContext extends JsonObject {
  profile: string | null;
  tab_id: number | null;
  host: string | null;
  workspace_id: number | null;
  environment: string | null;
}

export interface OperationRecord extends JsonObject {
  operation_id: string;
  kind: 'save_with_dependents';
  created_at: string;
  updated_at: string;
  status: OperationStatus;
  phase: OperationPhaseName;
  context: OperationContext;
  /** Caller arguments with every code body removed. */
  args: JsonObject;
  recipes: OperationRecipe[];
  phases: OperationPhaseRecord[];
  /** The optimistic lock a resume must reuse so a retry cannot duplicate a version. */
  expected_base_version_no?: number | null;
  save?: JsonObject;
  result?: JsonObject;
  error?: string;
  interrupted?: JsonObject;
  async?: boolean;
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

let cachedDir: string | null = null;
let prunedThisProcess = false;

/**
 * Where journals live.
 *
 * The bridge's own state directory when it is writable (so an operation and
 * the update flag sit together and survive a reboot), otherwise a temp
 * directory, because losing recovery on a locked-down machine is better than
 * failing the save that needed recovering.
 */
export function operationsDir(): string {
  if (cachedDir) return cachedDir;
  const override = process.env.WORKATOMCP_OPERATIONS_DIR;
  const candidates = override
    ? [override]
    : [path.join(updateStateDir(), 'operations'), path.join(os.tmpdir(), 'workatomcp-operations')];
  let lastError: unknown;
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      cachedDir = dir;
      return dir;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `could not create an operations journal directory (${candidates.join(', ')}): ` +
      `${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/** Test seam: forget the resolved directory so a new env override takes effect. */
export function resetOperationsDirCache(): void {
  cachedDir = null;
  prunedThisProcess = false;
}

function operationPath(operationId: string): string {
  return path.join(operationsDir(), `${operationId}.json`);
}

/** Operation ids come from randomUUID; refuse anything that could escape the dir. */
function assertOperationId(operationId: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(operationId)) {
    throw new Error(`operation_id "${operationId}" is not a valid operation id`);
  }
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/** tmp + rename, so a reader never sees a half-written journal. */
function writeRecord(record: OperationRecord): void {
  const target = operationPath(record.operation_id);
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* the tmp file is already gone */
    }
    throw err;
  }
}

/** Drop journals past the retention bound. Best effort: never throws. */
export function pruneOperations(now: number = Date.now()): number {
  let removed = 0;
  try {
    const dir = operationsDir();
    const entries = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const full = path.join(dir, f);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          /* raced with another prune */
        }
        return { full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (let i = 0; i < entries.length; i++) {
      const tooOld = now - entries[i].mtime > OPERATION_RETENTION_MS;
      const tooMany = i >= OPERATION_RETENTION_FILES;
      if (!tooOld && !tooMany) continue;
      try {
        fs.unlinkSync(entries[i].full);
        removed++;
      } catch {
        /* another process got there first */
      }
    }
  } catch {
    /* an unreadable journal directory must not fail the operation itself */
  }
  return removed;
}

export function readOperation(operationId: string): OperationRecord | null {
  assertOperationId(operationId);
  try {
    const raw = fs.readFileSync(operationPath(operationId), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as OperationRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export interface OperationSummary extends JsonObject {
  operation_id: string;
  kind: string;
  status: OperationStatus;
  phase: OperationPhaseName;
  created_at: string;
  updated_at: string;
  recipe_id: number | null;
  recipes: number;
  error?: string;
}

export function summarizeOperation(record: OperationRecord): OperationSummary {
  const callee = record.recipes.find((r) => r.role === 'callee');
  const summary: OperationSummary = {
    operation_id: record.operation_id,
    kind: record.kind,
    status: record.status,
    phase: record.phase,
    created_at: record.created_at,
    updated_at: record.updated_at,
    recipe_id: callee ? callee.recipe_id : null,
    recipes: record.recipes.length,
  };
  if (typeof record.error === 'string') summary.error = record.error;
  return summary;
}

/** Newest first. `limit` is clamped 1..50 by the caller's schema, and again here. */
export function listOperations(limit = 10): OperationSummary[] {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 10, 1), 50);
  let files: string[];
  try {
    files = fs.readdirSync(operationsDir()).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const rows = files
    .map((f) => {
      const full = path.join(operationsDir(), f);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        /* skip */
      }
      return { id: f.slice(0, -'.json'.length), mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, bounded);

  const out: OperationSummary[] = [];
  for (const row of rows) {
    const record = readOperation(row.id);
    if (record) out.push(summarizeOperation(record));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Code bodies never enter the journal; a hash is enough to compare on resume. */
export function hashCode(code: unknown): string | undefined {
  if (code === undefined) return undefined;
  try {
    return `sha256:${createHash('sha256')
      .update(JSON.stringify(code) ?? '')
      .digest('hex')
      .slice(0, 16)}`;
  } catch {
    return undefined;
  }
}

const CODE_ARG_KEYS = new Set(['code', 'expected_context']);

/** Caller arguments minus the tree, so the journal stays small and readable. */
export function journalArgs(args: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(args)) {
    if (CODE_ARG_KEYS.has(key)) continue;
    out[key] = value;
  }
  const hash = hashCode(args.code);
  if (hash) out.code_sha256 = hash;
  return out;
}

export interface StartOperationInput {
  kind?: 'save_with_dependents';
  context: Partial<OperationContext>;
  args: JsonObject;
  async?: boolean;
}

/** In-flight operations, so a process exit can mark them interrupted. */
const inFlight = new Map<string, OperationRecord>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const record of inFlight.values()) {
      if (record.status !== 'running') continue;
      record.status = 'interrupted';
      record.updated_at = new Date().toISOString();
      record.error = 'the bridge process exited while this operation was running';
      const phase = record.phases[record.phases.length - 1];
      if (phase && phase.status === 'running') {
        phase.status = 'interrupted';
        phase.ended_at = record.updated_at;
        phase.error = 'the bridge process exited during this phase';
      }
      record.interrupted = {
        phase: record.phase,
        reason: 'process_exit',
        affected_ids: record.recipes.map((r) => r.recipe_id),
      };
      try {
        // Synchronous on purpose: an exit handler cannot await.
        writeRecord(record);
      } catch {
        /* nothing left to do at exit */
      }
    }
  });
}

export function startOperation(input: StartOperationInput): OperationRecord {
  if (!prunedThisProcess) {
    prunedThisProcess = true;
    pruneOperations();
  }
  const now = new Date().toISOString();
  const record: OperationRecord = {
    operation_id: randomUUID(),
    kind: input.kind ?? 'save_with_dependents',
    created_at: now,
    updated_at: now,
    status: 'running',
    phase: 'discovery',
    context: {
      profile: input.context.profile ?? null,
      tab_id: input.context.tab_id ?? null,
      host: input.context.host ?? null,
      workspace_id: input.context.workspace_id ?? null,
      environment: input.context.environment ?? null,
    },
    args: journalArgs(input.args),
    recipes: [],
    phases: [],
  };
  if (input.async === true) record.async = true;
  installExitHook();
  inFlight.set(record.operation_id, record);
  updateOperation(record);
  return record;
}

/** Persist the record as it stands. Every mutation goes through here. */
export function updateOperation(record: OperationRecord, patch?: Partial<OperationRecord>): void {
  if (patch) Object.assign(record, patch);
  record.updated_at = new Date().toISOString();
  writeRecord(record);
}

/** Merge live context learned from a tool response, without erasing what we had. */
export function recordContext(record: OperationRecord, context: Partial<OperationContext>): void {
  let changed = false;
  for (const key of ['profile', 'tab_id', 'host', 'workspace_id', 'environment'] as const) {
    const value = context[key];
    if (value === undefined || value === null) continue;
    if (record.context[key] === value) continue;
    (record.context as JsonObject)[key] = value;
    changed = true;
  }
  if (changed) updateOperation(record);
}

/**
 * Open a phase. Written BEFORE the nested call it describes, so a call that
 * never returns still leaves the phase and the ids it was acting on.
 */
export function beginPhase(
  record: OperationRecord,
  name: OperationPhaseName,
  affectedIds?: number[],
): OperationPhaseRecord {
  const phase: OperationPhaseRecord = {
    name,
    status: 'running',
    started_at: new Date().toISOString(),
  };
  if (affectedIds && affectedIds.length > 0) phase.affected_ids = [...affectedIds];
  record.phases.push(phase);
  record.phase = name;
  updateOperation(record);
  return phase;
}

/**
 * Close a phase. `detail.error` becomes the phase error; every other key is
 * kept as the phase result, so a call site can record whatever it learned
 * without a bespoke type per phase.
 */
export function endPhase(
  record: OperationRecord,
  phase: OperationPhaseRecord,
  status: PhaseStatus,
  detail?: JsonObject,
): void {
  phase.status = status;
  phase.ended_at = new Date().toISOString();
  if (detail) {
    const { error, ...rest } = detail;
    if (typeof error === 'string') phase.error = error;
    if (Object.keys(rest).length > 0) phase.result = rest;
  }
  updateOperation(record);
}

/** Mark the operation interrupted at its current phase, naming what it touched. */
export function markInterrupted(
  record: OperationRecord,
  detail: { error: string; affected_ids: number[]; seen?: JsonObject; reason?: string },
): void {
  const phase = record.phases[record.phases.length - 1];
  if (phase && phase.status === 'running') {
    phase.status = 'interrupted';
    phase.ended_at = new Date().toISOString();
    phase.error = detail.error;
    if (detail.affected_ids.length > 0) phase.affected_ids = [...detail.affected_ids];
  }
  record.status = 'interrupted';
  record.error = detail.error;
  record.interrupted = {
    phase: record.phase,
    reason: detail.reason ?? 'nested_call_did_not_return',
    affected_ids: [...detail.affected_ids],
    seen: detail.seen ?? {},
    at: new Date().toISOString(),
  };
  inFlight.delete(record.operation_id);
  updateOperation(record);
}

export function finishOperation(
  record: OperationRecord,
  detail: { status: OperationStatus; result?: JsonObject; error?: string },
): void {
  record.status = detail.status;
  if (detail.status === 'done') record.phase = 'done';
  if (detail.result !== undefined) record.result = detail.result;
  if (detail.error !== undefined) record.error = detail.error;
  inFlight.delete(record.operation_id);
  updateOperation(record);
}

/** Find or create the journal entry for one recipe. */
export function upsertRecipe(record: OperationRecord, recipe: OperationRecipe): OperationRecipe {
  const existing = record.recipes.find((r) => r.recipe_id === recipe.recipe_id);
  if (existing) {
    Object.assign(existing, recipe);
    return existing;
  }
  record.recipes.push(recipe);
  return recipe;
}

// ---------------------------------------------------------------------------
// Resume planning (pure)
// ---------------------------------------------------------------------------

export interface ResumeLiveState {
  recipe_id: number;
  running: boolean | null;
  state?: string | null;
  version_no?: number | null;
  error?: string;
}

export type ResumeAction = 'restart' | 'leave_stopped' | 'already_running' | 'blocked' | 'unknown';

export interface ResumeDecision extends JsonObject {
  recipe_id: number;
  role: 'callee' | 'caller';
  action: ResumeAction;
  reason: string;
}

export interface ResumePlanInput {
  record: OperationRecord;
  live: ResumeLiveState[];
  /** Whether the callee's saved version is usable: persisted AND valid. */
  save_usable: boolean;
  save_reason: string;
  /** Connection health per recipe id; undefined means "not checked". */
  connections?: Record<number, { healthy: boolean; reason?: string }>;
}

/**
 * Decide what a resume may do, without doing any of it.
 *
 * The three rules the plan is explicit about:
 *   - a recipe that was stopped before the operation stays stopped;
 *   - a caller is restarted only when the callee's saved version is usable;
 *   - anything that cannot be finished safely is named, with its reason.
 */
export function planResume(input: ResumePlanInput): ResumeDecision[] {
  const liveById = new Map<number, ResumeLiveState>();
  for (const item of input.live) liveById.set(item.recipe_id, item);
  const decisions: ResumeDecision[] = [];

  for (const recipe of input.record.recipes) {
    const live = liveById.get(recipe.recipe_id);
    const health = input.connections?.[recipe.recipe_id];

    if (live?.error) {
      decisions.push({
        recipe_id: recipe.recipe_id,
        role: recipe.role,
        action: 'unknown',
        reason: `its live state could not be read (${live.error}); nothing was changed for it`,
      });
      continue;
    }
    if (recipe.initial.running !== true) {
      decisions.push({
        recipe_id: recipe.recipe_id,
        role: recipe.role,
        action: 'leave_stopped',
        reason: 'it was already stopped before the operation started',
      });
      continue;
    }
    if (live?.running === true) {
      decisions.push({
        recipe_id: recipe.recipe_id,
        role: recipe.role,
        action: 'already_running',
        reason: 'it is running again already',
      });
      continue;
    }
    if (!input.save_usable) {
      decisions.push({
        recipe_id: recipe.recipe_id,
        role: recipe.role,
        action: 'blocked',
        reason: `the callee's saved version is not usable: ${input.save_reason}`,
      });
      continue;
    }
    if (health && !health.healthy) {
      decisions.push({
        recipe_id: recipe.recipe_id,
        role: recipe.role,
        action: 'blocked',
        reason: health.reason ?? 'its connections are not healthy',
      });
      continue;
    }
    decisions.push({
      recipe_id: recipe.recipe_id,
      role: recipe.role,
      action: 'restart',
      reason: 'it was running before the operation and the saved version is usable',
    });
  }

  return decisions;
}
