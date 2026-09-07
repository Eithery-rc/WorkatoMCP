/**
 * workato_recipe_save_with_dependents: save a callable without hand-running
 * the stop/save/start ceremony.
 *
 * ## The ceremony this replaces
 *
 * Workato refuses to stop a recipe function while any recipe that calls it is
 * running (`active_dependent_recipes_count: [2]`), and refuses a code save on
 * a running recipe. So every edit to a shared callable is:
 *
 *     stop <caller A> -> stop <caller B> -> save <callee> -> start A -> start B
 *
 * Six calls, in an order that is not optional, repeated on every iteration.
 *
 * ## Restoring, not starting
 *
 * Dependents are put back to the state they were in, never blindly started. A
 * caller that was deliberately stopped before the save stays stopped, because turning
 * one of those back on is a production change nobody asked for.
 *
 * ## Discovery honesty
 *
 *   - `dependent_recipe_ids` given  -> that list is used verbatim.
 *   - a scan scope given (`scan_folder_id`, `scan_folder_ids`,
 *     `scan_project_id`, `scan_scope`) -> `workato_recipe_callers` does the
 *     discovery: Workato's own dependency graph plus a paged code scan that
 *     matches `call_recipe.flow_id`.
 *   - neither                       -> the tool refuses rather than saving as
 *     if there were no dependents. "I could not look" must never be reported
 *     as "there are none".
 *
 * A discovery that comes back `partial` is not silently upgraded: the scan's
 * own reasons are carried into the response as a warning.
 *
 * Whatever the source, the count Workato itself reports at stop time is used
 * as a cross-check: if it says more dependents are active than we found
 * running, the save is abandoned and everything stopped is restored.
 *
 * ## Durability (this is the part that is not obvious)
 *
 * Every step is a nested bridge call with a 120 s ceiling, and a stop, a save
 * or a start can spend most of that on its own. When one of them fails to come
 * back, the closure holding "which three production recipes did I stop" dies
 * with the request. So the whole sequence is journalled to disk
 * (workato-operations.ts): the phase is written BEFORE each nested call, the
 * response always carries an `operation_id`, and `workato_operation_status`
 * can read the real state back and finish the restore.
 *
 * Four things the older version got wrong and this one does not:
 *
 *   - a start that Workato merely ACCEPTED is not a restart. `outcome` is read
 *     off the lifecycle payload and anything short of `state_reached` gets one
 *     status re-check before it is called FAILED.
 *   - a save that persisted an INVALID or INCOMPLETE tree is not "nothing
 *     changed". Callers are not restarted against it, and the version number
 *     plus the validation errors or dropped paths are reported.
 *   - connections are checked BEFORE anything is stopped. A callee whose
 *     connection is disconnected is still saved (editing has to stay possible)
 *     but is not restarted, and neither are its callers.
 *   - the save carries an optimistic lock taken from the callee's own version
 *     before the stops, so a retry after a timeout cannot create a second
 *     version and cannot roll back over another editor's save.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { parseToolJson } from './workato-recipe-mutators';
import { NEUTRAL_VERSION_COMMENT } from './workato-callable-schema';
import { discoverCallers, type CallerDiscovery } from './workato-recipe-callers';
import {
  beginPhase,
  endPhase,
  finishOperation,
  markInterrupted,
  planResume,
  recordContext,
  startOperation,
  updateOperation,
  upsertRecipe,
  type OperationContext,
  type OperationRecord,
  type ResumeDecision,
  type ResumeLiveState,
} from './workato-operations';

export const SAVE_WITH_DEPENDENTS_TOOL = 'workato_recipe_save_with_dependents';

type JsonObject = Record<string, unknown>;
type ExtensionCaller = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

export function isWorkatoSaveWithDependentsTool(name: string): boolean {
  return name === SAVE_WITH_DEPENDENTS_TOOL;
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** One dependent's journey through the save. */
export interface DependentReport extends JsonObject {
  id: number;
  name?: string;
  was_running: boolean;
  stopped: boolean;
  restarted: boolean | null;
  /** Lifecycle outcome of the restart attempt, when one was made. */
  restart_outcome?: string;
  /** Why this dependent was deliberately not restarted. */
  blocked_reason?: string;
  /** Connection health seen at preflight. Null when the check could not run. */
  connections_healthy?: boolean | null;
  /** Found by the post-stop revalidation, not by the first discovery. */
  discovered_late?: boolean;
  error?: string;
}

/**
 * Find recipes whose `call_recipe` step targets `calleeId`.
 *
 * Pure so it can be tested against a fixture tree. `flow_id` is a string in
 * saved recipes, so both forms are accepted.
 */
export function treeCallsRecipe(code: unknown, calleeId: number): boolean {
  const wanted = String(calleeId);
  let found = false;
  const seen = new Set<unknown>();

  const walk = (node: unknown): void => {
    if (found) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!isRecord(node) || seen.has(node)) return;
    seen.add(node);
    if (
      node.provider === 'workato_recipe_function' &&
      (node.name === 'call_recipe' || node.name === 'call_recipe_async') &&
      isRecord(node.input) &&
      String(node.input.flow_id ?? '') === wanted
    ) {
      found = true;
      return;
    }
    if (Array.isArray(node.block)) walk(node.block);
  };

  walk(code);
  return found;
}

/**
 * Pull `active_dependent_recipes_count` out of a stop failure.
 *
 * Workato reports it as an array (`[2]`) inside the error details, which is
 * why this looks for a number anywhere under that key rather than a fixed
 * shape.
 */
export function parseActiveDependentCount(text: string): number | null {
  const match = /active_dependent_recipes_count["\s:[]*(\d+)/i.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compare Workato's own active-dependent count against what discovery found.
 *
 * Workato only ever reports this count when it refuses something, and it
 * counts RUNNING callers. By the time the callee is saved, every running
 * caller this call knew about has been stopped, so any count left over names
 * callers discovery missed. Reported as a warning: it is a cross-check, never
 * a substitute for discovery.
 */
export function describeDependentCountMismatch(
  errorText: string,
  dependentIds: number[],
  stoppedRunning: number,
  discoveryText: string,
): string {
  const activeCount = parseActiveDependentCount(errorText);
  if (activeCount === null || activeCount <= 0) return '';
  return (
    `\nWARNING: Workato reports ${activeCount} dependent recipe(s) still ACTIVE. This call ` +
    `discovered ${dependentIds.length} caller(s) (${JSON.stringify(dependentIds)}) and stopped ` +
    `the ${stoppedRunning} that were running, so at least ${activeCount} caller(s) are missing ` +
    `from that list. Discovery was: ${discoveryText}. Widen it (scan_scope:"workspace") or pass ` +
    'dependent_recipe_ids explicitly.'
  );
}

// ---------------------------------------------------------------------------
// Response reading
// ---------------------------------------------------------------------------

/**
 * The FIRST text block of a tool result.
 *
 * The extension appends a trailing `{"context":...}` block to every successful
 * workato_* response; every parser in the bridge reads the first block and so
 * does this one.
 */
function firstText(result: CallToolResult | undefined): string {
  const block = Array.isArray(result?.content)
    ? result!.content.find((item: any) => item?.type === 'text')
    : undefined;
  return typeof (block as any)?.text === 'string' ? (block as any).text : '';
}

/** The last JSON object line of a `summary\nJSON` text, error texts included. */
export function trailingJson(text: string): JsonObject | null {
  const lines = text.split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) return parsed;
    } catch {
      /* try the next line */
    }
  }
  return null;
}

/**
 * The actual-context block the extension appends LAST. Deliberately the only
 * place in this file that looks at a block other than the first one.
 */
function readContextBlock(result: CallToolResult | undefined): Partial<OperationContext> {
  if (!result || !Array.isArray(result.content) || result.content.length === 0) return {};
  const last: any = result.content[result.content.length - 1];
  if (last?.type !== 'text' || typeof last.text !== 'string') return {};
  if (!last.text.startsWith('{"context":')) return {};
  try {
    const parsed = JSON.parse(last.text);
    const context = parsed?.context;
    if (!isRecord(context)) return {};
    const out: Partial<OperationContext> = {};
    if (typeof context.profile === 'string') out.profile = context.profile;
    if (typeof context.tab_id === 'number') out.tab_id = context.tab_id;
    if (typeof context.host === 'string') out.host = context.host;
    if (typeof context.workspace_id === 'number') out.workspace_id = context.workspace_id;
    if (context.environment !== undefined && context.environment !== null) {
      out.environment = String(context.environment);
    }
    return out;
  } catch {
    return {};
  }
}

export type LifecycleOutcome = 'state_reached' | 'accepted' | 'failed' | 'unknown';

export interface LifecycleReading {
  outcome: LifecycleOutcome;
  state?: string;
  running?: boolean;
  /** Workato's activation error, when the start tool diagnosed one. */
  start_error?: JsonObject;
  error?: string;
}

/**
 * Read a start/stop result truthfully.
 *
 * `outcome` is authoritative when the extension supplies it. An older
 * extension only has `state_flipped`; a response with neither is `unknown`,
 * which the caller resolves with one status re-check rather than assuming.
 */
export function readLifecycleResult(result: CallToolResult): LifecycleReading {
  const text = firstText(result);
  const payload = trailingJson(text);
  if (result.isError) {
    return {
      outcome: 'failed',
      error: text || 'lifecycle call failed',
      start_error: isRecord(payload?.start_error)
        ? (payload!.start_error as JsonObject)
        : undefined,
    };
  }
  const outcome =
    payload?.outcome === 'state_reached' ||
    payload?.outcome === 'accepted' ||
    payload?.outcome === 'failed'
      ? (payload.outcome as LifecycleOutcome)
      : payload?.state_flipped === true
        ? 'state_reached'
        : payload?.state_flipped === false
          ? 'accepted'
          : 'unknown';
  const reading: LifecycleReading = { outcome };
  if (typeof payload?.state === 'string') reading.state = payload.state;
  if (typeof payload?.running === 'boolean') reading.running = payload.running;
  if (isRecord(payload?.start_error)) reading.start_error = payload!.start_error as JsonObject;
  return reading;
}

export type SaveClassification =
  | 'ok'
  | 'already_applied'
  | 'persisted_invalid'
  | 'persisted_incomplete'
  | 'failed';

export interface SaveAssessment {
  classification: SaveClassification;
  /** A new version exists in Workato. */
  persisted: boolean;
  /** Workato reported no code_errors and the readback matched. */
  valid: boolean;
  /** Safe to put callers back against this callee. */
  restart_callers: boolean;
  version_no?: number;
  code_errors: unknown[];
  dropped?: unknown[];
  save_status?: string;
  text: string;
  payload: JsonObject | null;
  /** One sentence for the response headline. */
  summary: string;
}

/**
 * Classify what the save tool actually did.
 *
 * Three outcomes the old code collapsed into "the save failed, nothing was
 * changed": `persisted_invalid` (isError:false, a new version exists but
 * Workato reports validation errors), `persisted_incomplete` (isError:true, a
 * new version exists but Workato dropped input keys), and a genuine failure.
 * The first two must never be described as "nothing changed" and must never be
 * followed by restarting callers against the callee.
 */
export function classifySaveResult(result: CallToolResult): SaveAssessment {
  const text = firstText(result) || (result.isError ? 'save failed' : '');
  const payload = trailingJson(text);
  const versionNo = typeof payload?.version_no === 'number' ? payload.version_no : undefined;
  const codeErrors = Array.isArray(payload?.code_errors) ? (payload!.code_errors as unknown[]) : [];
  const saveStatus = typeof payload?.save_status === 'string' ? payload.save_status : undefined;

  if (result.isError) {
    if (saveStatus === 'persisted_incomplete') {
      const dropped = Array.isArray(payload?.dropped) ? (payload!.dropped as unknown[]) : [];
      return {
        classification: 'persisted_incomplete',
        persisted: true,
        valid: false,
        restart_callers: false,
        version_no: versionNo,
        code_errors: codeErrors,
        dropped,
        save_status: saveStatus,
        text,
        payload,
        summary:
          `the save PERSISTED as version ${versionNo ?? 'unknown'} but Workato dropped ` +
          `${dropped.length} input path(s); the stored recipe is NOT what was sent`,
      };
    }
    return {
      classification: 'failed',
      persisted: false,
      valid: false,
      restart_callers: true,
      code_errors: codeErrors,
      save_status: saveStatus,
      text,
      payload,
      summary: 'the save failed and no new version was created',
    };
  }

  const valid = payload?.valid === false ? false : codeErrors.length === 0;
  if (saveStatus === 'persisted_invalid' || !valid) {
    return {
      classification: 'persisted_invalid',
      persisted: true,
      valid: false,
      restart_callers: false,
      version_no: versionNo,
      code_errors: codeErrors,
      save_status: saveStatus ?? 'persisted_invalid',
      text,
      payload,
      summary:
        `the save PERSISTED as version ${versionNo ?? 'unknown'} but Workato reports ` +
        `${codeErrors.length} validation error(s); the version exists and is NOT runnable`,
    };
  }

  const classification: SaveClassification =
    saveStatus === 'already_applied' ? 'already_applied' : 'ok';
  return {
    classification,
    persisted: true,
    valid: true,
    restart_callers: true,
    version_no: versionNo,
    code_errors: codeErrors,
    save_status: saveStatus,
    text,
    payload,
    summary:
      classification === 'already_applied'
        ? `the recipe already held this exact tree at version ${versionNo ?? 'unknown'}; no ` +
          'duplicate version was created'
        : `saved as version ${versionNo ?? 'unknown'}`,
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface Ctx {
  args: JsonObject;
  call: ExtensionCaller;
  op: OperationRecord;
}

/** Tab/window routing pass-through, same convention as the mutator tools. */
function routed(args: JsonObject, target: JsonObject): JsonObject {
  if (typeof args.tabId === 'number') target.tabId = args.tabId;
  if (typeof args.windowId === 'number') target.windowId = args.windowId;
  return target;
}

/**
 * A nested call that did not come back.
 *
 * Carries the ids the call was acting on so the journal can name exactly which
 * recipes are in an unknown state, instead of the generic "failed" the old
 * outer catch produced.
 */
class NestedCallInterrupted extends Error {
  constructor(
    message: string,
    readonly affected_ids: number[],
    readonly seen: JsonObject,
  ) {
    super(message);
    this.name = 'NestedCallInterrupted';
  }
}

/** Wrap a nested call so a thrown bridge timeout becomes an interruption. */
async function guarded<T>(ids: number[], seen: JsonObject, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new NestedCallInterrupted(err instanceof Error ? err.message : String(err), ids, seen);
  }
}

type StatusReading =
  | { ok: true; running: boolean; name?: string; version_no?: number; state?: string }
  | { ok: false; error: string };

async function recipeStatus(ctx: Ctx, recipeId: number): Promise<StatusReading> {
  const result = await ctx.call('workato_recipe_status', routed(ctx.args, { recipe_id: recipeId }));
  recordContext(ctx.op, readContextBlock(result));
  if (result.isError) return { ok: false, error: firstText(result) || 'recipe_status failed' };
  const payload = trailingJson(firstText(result));
  if (!payload) return { ok: false, error: 'recipe_status returned no JSON payload' };
  return {
    ok: true,
    running: payload.running === true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    version_no: typeof payload.version_no === 'number' ? payload.version_no : undefined,
    state: typeof payload.state === 'string' ? payload.state : undefined,
  };
}

interface ConnectionReading {
  /** null when the health could not be established at all. */
  healthy: boolean | null;
  reason?: string;
  blocking: unknown[];
}

/**
 * Connection health for one recipe.
 *
 * A read that fails leaves `healthy: null`. That is a diagnostic gap, not
 * evidence of a break, so it does not block a restart; it is reported instead.
 */
async function recipeConnections(ctx: Ctx, recipeId: number): Promise<ConnectionReading> {
  const result = await ctx.call(
    'workato_recipe_connections',
    routed(ctx.args, { recipe_id: recipeId }),
  );
  if (result.isError) {
    return {
      healthy: null,
      reason: firstText(result) || 'connection health read failed',
      blocking: [],
    };
  }
  const payload = trailingJson(firstText(result));
  if (!payload || typeof payload.healthy !== 'boolean') {
    return {
      healthy: null,
      reason: 'the connection health response carried no `healthy` verdict',
      blocking: [],
    };
  }
  const blocking = Array.isArray(payload.blocking) ? (payload.blocking as unknown[]) : [];
  const reason = payload.healthy
    ? undefined
    : blocking.length > 0
      ? blocking
          .map((b) =>
            isRecord(b)
              ? `${String(b.provider ?? 'unknown provider')} (${String(b.status ?? 'unknown')}): ${String(b.reason ?? '')}`.trim()
              : String(b),
          )
          .join('; ')
      : 'Workato reports the recipe connections as not usable';
  return { healthy: payload.healthy, reason, blocking };
}

interface LifecycleResult {
  ok: boolean;
  outcome: LifecycleOutcome | 'state_reached_after_recheck';
  error?: string;
}

/**
 * Start or stop one recipe and say honestly whether the state was reached.
 *
 * `accepted` means Workato took the request and the state did not flip inside
 * the wait window. That is not a restart, but Workato's activation is
 * asynchronous, so it gets exactly one status re-check before it is called
 * FAILED. No polling loop, no optimism.
 */
async function lifecycle(
  ctx: Ctx,
  recipeId: number,
  action: 'start' | 'stop',
): Promise<LifecycleResult> {
  const tool = action === 'start' ? 'workato_start_recipe' : 'workato_stop_recipe';
  // wait:true, because a stop that is merely enqueued does not unblock the save.
  const result = await ctx.call(tool, routed(ctx.args, { recipe_id: recipeId, wait: true }));
  recordContext(ctx.op, readContextBlock(result));
  const reading = readLifecycleResult(result);
  if (reading.outcome === 'state_reached') return { ok: true, outcome: 'state_reached' };

  const wanted = action === 'start';
  const recheck = await recipeStatus(ctx, recipeId);
  if (recheck.ok && recheck.running === wanted) {
    return { ok: true, outcome: 'state_reached_after_recheck' };
  }

  const detail =
    reading.outcome === 'failed'
      ? (reading.error ?? 'Workato refused the request')
      : `Workato ACCEPTED the ${action} but the state did not reach ` +
        `${wanted ? 'running' : 'stopped'}` +
        (reading.state ? ` (state=${reading.state})` : '') +
        (recheck.ok
          ? `; a re-check still shows running=${recheck.running}`
          : `; the re-check failed too (${recheck.error})`);
  return {
    ok: false,
    outcome: reading.outcome,
    error:
      detail +
      (reading.start_error
        ? `\nWorkato activation error: ${JSON.stringify(reading.start_error)}`
        : ''),
  };
}

/**
 * The scan scope the caller asked for, or null when they asked for none.
 *
 * `scan_folder_id` is the original single-folder argument and still works; it
 * is simply the one-element form of `scan_folder_ids`.
 */
export function readScanScope(args: JsonObject): {
  folder_ids: number[];
  project_id?: string | number;
  scope?: 'folders' | 'project' | 'workspace';
} | null {
  const folderIds: number[] = [];
  if (typeof args.scan_folder_id === 'number' && Number.isFinite(args.scan_folder_id)) {
    folderIds.push(args.scan_folder_id);
  }
  if (Array.isArray(args.scan_folder_ids)) {
    for (const raw of args.scan_folder_ids) {
      const id = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(id) && folderIds.indexOf(id) < 0) folderIds.push(id);
    }
  }
  const projectId =
    args.scan_project_id === undefined ||
    args.scan_project_id === null ||
    args.scan_project_id === ''
      ? undefined
      : (args.scan_project_id as string | number);
  const scope =
    args.scan_scope === 'folders' ||
    args.scan_scope === 'project' ||
    args.scan_scope === 'workspace'
      ? args.scan_scope
      : undefined;
  if (folderIds.length === 0 && projectId === undefined && scope === undefined) return null;
  return { folder_ids: folderIds, project_id: projectId, scope };
}

/** Discover dependents through workato_recipe_callers. */
async function discoverDependents(
  ctx: Ctx,
  calleeId: number,
  requested: NonNullable<ReturnType<typeof readScanScope>>,
): Promise<CallerDiscovery> {
  const discovery = await discoverCallers(ctx.call, {
    recipe_id: calleeId,
    folder_ids: requested.folder_ids,
    project_id: requested.project_id,
    scope: requested.scope,
    tabId: typeof ctx.args.tabId === 'number' ? ctx.args.tabId : undefined,
    windowId: typeof ctx.args.windowId === 'number' ? ctx.args.windowId : undefined,
  });
  // The callee is never its own dependent, whatever the graph says.
  discovery.dependent_ids = discovery.dependent_ids.filter((id) => id !== calleeId);
  discovery.details = discovery.details.filter((d) => d.recipe_id !== calleeId);
  return discovery;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handleWorkatoSaveWithDependentsCall(
  name: string,
  args: JsonObject,
  callExtension: ExtensionCaller,
): Promise<CallToolResult> {
  if (name !== SAVE_WITH_DEPENDENTS_TOOL) {
    return errorResult(`unsupported tool: ${name}`);
  }
  const recipeId = args.recipe_id;
  if (typeof recipeId !== 'number' || !Number.isFinite(recipeId)) {
    return errorResult('recipe_id must be a finite number');
  }
  if (args.code === undefined && args.code_path === undefined) {
    return errorResult(
      'pass code (object) or code_path (file). This tool saves a recipe, it does not ' +
        'edit one in place.',
    );
  }

  const expected = isRecord(args.expected_context) ? args.expected_context : {};
  const op = startOperation({
    context: {
      tab_id: typeof args.tabId === 'number' ? args.tabId : null,
      host: typeof expected.host === 'string' ? expected.host : null,
      workspace_id: typeof expected.workspace_id === 'number' ? expected.workspace_id : null,
      environment: expected.environment === undefined ? null : String(expected.environment),
    },
    args,
    async: args.async === true,
  });

  const ctx: Ctx = { args, call: callExtension, op };

  if (args.async === true) {
    // Fire and forget: the journal is the client's handle on it from here.
    void runOperation(ctx, recipeId).catch(() => {
      /* runOperation already journalled whatever went wrong */
    });
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text:
            `started operation ${op.operation_id} for recipe ${recipeId} in the background. ` +
            'Poll it with workato_operation_status(operation_id) and finish an interrupted ' +
            'restore with workato_operation_status(operation_id, resume:true).\n' +
            JSON.stringify({
              operation_id: op.operation_id,
              kind: op.kind,
              phase: op.phase,
              status: op.status,
              async: true,
            }),
        },
      ],
    };
  }

  return runOperation(ctx, recipeId);
}

async function runOperation(ctx: Ctx, recipeId: number): Promise<CallToolResult> {
  const { args, op } = ctx;
  const reports: DependentReport[] = [];

  const reportFor = (id: number): DependentReport | undefined => reports.find((d) => d.id === id);

  /** Mirror one dependent report into the journal. */
  const journalDependent = (report: DependentReport, initialVersion?: number): void => {
    upsertRecipe(op, {
      recipe_id: report.id,
      name: report.name,
      role: 'caller',
      initial: {
        running: report.was_running,
        version_no: initialVersion ?? null,
      },
      stopped: report.stopped,
      restarted: report.restarted,
      restart_outcome: report.restart_outcome,
      connections_healthy: report.connections_healthy ?? null,
      connections_reason: report.blocked_reason,
      discovered_late: report.discovered_late,
    });
  };

  /** Put back everything this call stopped. Used on the error paths too. */
  const restoreAll = async (allowed: (d: DependentReport) => string | null): Promise<void> => {
    for (const dep of reports) {
      if (!dep.stopped || !dep.was_running) continue;
      const block = allowed(dep);
      if (block !== null) {
        dep.restarted = false;
        dep.blocked_reason = block;
        journalDependent(dep);
        continue;
      }
      const res = await guarded(
        [dep.id],
        { stopped: reports.filter((d) => d.stopped).map((d) => d.id) },
        () => lifecycle(ctx, dep.id, 'start'),
      );
      dep.restarted = res.ok;
      dep.restart_outcome = res.outcome;
      if (!res.ok) dep.error = res.error;
      journalDependent(dep);
    }
  };

  const stoppedIds = (): number[] => reports.filter((d) => d.stopped).map((d) => d.id);

  const interruptedResult = (err: NestedCallInterrupted): CallToolResult => {
    markInterrupted(op, {
      error: err.message,
      affected_ids: err.affected_ids,
      seen: { ...err.seen, dependents: reports },
    });
    return errorResult(
      `${SAVE_WITH_DEPENDENTS_TOOL}: operation ${op.operation_id} was INTERRUPTED during the ` +
        `${op.phase} phase: a nested call did not come back (${err.message}). The recipes it ` +
        `was acting on are ${JSON.stringify(err.affected_ids)} and their state is UNKNOWN. ` +
        'Nothing has been rolled back automatically. Read the real state with ' +
        `workato_operation_status(operation_id:"${op.operation_id}", refresh:true) and finish ` +
        `the restore with workato_operation_status(operation_id:"${op.operation_id}", ` +
        'resume:true), which reuses the journalled version lock so a retried save cannot ' +
        'create a second version. (retriable: true)\n' +
        JSON.stringify({
          operation_id: op.operation_id,
          phase: op.phase,
          status: 'interrupted',
          interrupted_recipe_ids: err.affected_ids,
          dependents: reports,
        }),
    );
  };

  try {
    // --- 1. Determine the dependent set ------------------------------------
    const discoveryPhase = beginPhase(op, 'discovery', [recipeId]);
    let dependentIds: number[];
    let discovery: string;
    let discovered: CallerDiscovery | null = null;
    const scanScope = readScanScope(args);
    if (Array.isArray(args.dependent_recipe_ids)) {
      dependentIds = args.dependent_recipe_ids
        .map((v) => (typeof v === 'number' ? v : Number(v)))
        .filter((v) => Number.isFinite(v));
      discovery = 'explicit';
    } else if (scanScope !== null) {
      discovered = await guarded([recipeId], {}, () =>
        discoverDependents(ctx, recipeId, scanScope),
      );
      dependentIds = discovered.dependent_ids;
      discovery = discovered.discovery_text;
    } else {
      const message =
        `${SAVE_WITH_DEPENDENTS_TOOL}: no way to determine which recipes call ${recipeId}. ` +
        'This tool will not guess.\n' +
        'Pass one of:\n' +
        '  dependent_recipe_ids: [76887741, 76902321]   : the callers you already know\n' +
        '  scan_folder_id: 30573643                      : discover the callers in that folder\n' +
        '  scan_folder_ids: [30573643, 30945905]         : several folders\n' +
        '  scan_project_id: "15842038"                   : every folder of that project\n' +
        '  scan_scope: "workspace"                       : the whole workspace (slowest)\n' +
        'Discovery runs workato_recipe_callers (dependency graph plus a paged code scan); ' +
        'call that tool directly first if you want to see the callers before touching them.\n' +
        'If the callee genuinely has no callers, workato_ui_save_recipe_code is the right ' +
        'tool and this one adds nothing.\n' +
        JSON.stringify({ operation_id: op.operation_id, phase: 'discovery', status: 'failed' });
      endPhase(op, discoveryPhase, 'failed', { error: 'no discovery scope was given' });
      finishOperation(op, { status: 'failed', error: 'no discovery scope was given' });
      return errorResult(message);
    }
    endPhase(op, discoveryPhase, 'ok', {
      source: discovery,
      dependent_ids: dependentIds,
      completeness: discovered?.completeness ?? 'explicit',
    });

    // --- 2. Preflight: prior state and connection health --------------------
    const preflightPhase = beginPhase(op, 'preflight', [recipeId, ...dependentIds]);
    const calleeStatus = await guarded([recipeId], {}, () => recipeStatus(ctx, recipeId));
    if (!calleeStatus.ok) {
      endPhase(op, preflightPhase, 'failed', { error: calleeStatus.error });
      finishOperation(op, { status: 'failed', error: calleeStatus.error });
      return errorResult(
        `${SAVE_WITH_DEPENDENTS_TOOL}: could not read the status of the callee ${recipeId} ` +
          `(${calleeStatus.error}). Nothing was stopped and nothing was saved.\n` +
          JSON.stringify({ operation_id: op.operation_id, phase: 'preflight', status: 'failed' }),
      );
    }
    upsertRecipe(op, {
      recipe_id: recipeId,
      name: calleeStatus.name,
      role: 'callee',
      initial: {
        running: calleeStatus.running,
        state: calleeStatus.state ?? null,
        version_no: calleeStatus.version_no ?? null,
      },
    });

    // The lock is taken BEFORE anything is stopped, and journalled, so a retry
    // after a timeout re-sends the same base version and Workato answers
    // already_applied instead of creating a duplicate.
    const expectedBaseVersion =
      typeof args.expected_base_version_no === 'number'
        ? args.expected_base_version_no
        : (calleeStatus.version_no ?? null);
    updateOperation(op, { expected_base_version_no: expectedBaseVersion });

    for (const id of dependentIds) {
      const status = await guarded([id], { stopped: stoppedIds() }, () => recipeStatus(ctx, id));
      if (!status.ok) {
        endPhase(op, preflightPhase, 'failed', { error: `dependent ${id}: ${status.error}` });
        finishOperation(op, { status: 'failed', error: `dependent ${id}: ${status.error}` });
        return errorResult(
          `${SAVE_WITH_DEPENDENTS_TOOL}: could not read status of dependent ${id} ` +
            `(${status.error}). Nothing was saved.\n` +
            JSON.stringify({
              operation_id: op.operation_id,
              phase: 'preflight',
              status: 'failed',
              dependents: reports,
            }),
        );
      }
      const report: DependentReport = {
        id,
        name: status.name,
        was_running: status.running,
        stopped: false,
        restarted: null,
      };
      reports.push(report);
      journalDependent(report, status.version_no);
    }

    // Connection health, before anything is stopped. A disconnected callee is
    // still saved (editing must stay possible) but is not restarted, and its
    // callers are not restarted against it.
    const checkConnections = args.preflight_connections !== false;
    let calleeHealth: ConnectionReading = { healthy: null, blocking: [] };
    if (checkConnections) {
      calleeHealth = await guarded([recipeId], { stopped: stoppedIds() }, () =>
        recipeConnections(ctx, recipeId),
      );
      upsertRecipe(op, {
        recipe_id: recipeId,
        role: 'callee',
        initial: {
          running: calleeStatus.running,
          state: calleeStatus.state ?? null,
          version_no: calleeStatus.version_no ?? null,
        },
        name: calleeStatus.name,
        connections_healthy: calleeHealth.healthy,
        connections_reason: calleeHealth.reason,
      });
      for (const report of reports) {
        if (!report.was_running) continue;
        const health = await guarded([report.id], { stopped: stoppedIds() }, () =>
          recipeConnections(ctx, report.id),
        );
        report.connections_healthy = health.healthy;
        if (health.healthy === false) report.blocked_reason = health.reason;
        journalDependent(report);
      }
    }
    const calleeBlocked = calleeHealth.healthy === false;
    endPhase(op, preflightPhase, 'ok', {
      callee_connections_healthy: calleeHealth.healthy,
      callee_connections_reason: calleeHealth.reason,
      checked: checkConnections,
    });

    // --- 3. Stop the running dependents -------------------------------------
    const runningIds = reports.filter((d) => d.was_running).map((d) => d.id);
    const stopsPhase = beginPhase(op, 'stops', runningIds);
    for (const report of reports) {
      if (!report.was_running) continue;
      const stop = await guarded([report.id], { stopped: stoppedIds() }, () =>
        lifecycle(ctx, report.id, 'stop'),
      );
      if (!stop.ok) {
        report.error = stop.error;
        journalDependent(report);
        const mismatch = describeDependentCountMismatch(
          stop.error ?? '',
          dependentIds,
          stoppedIds().length,
          discovery,
        );
        endPhase(op, stopsPhase, 'failed', { error: `dependent ${report.id}: ${stop.error}` });
        const restorePhase = beginPhase(op, 'restore', stoppedIds());
        await restoreAll(() => null);
        endPhase(op, restorePhase, 'ok', { dependents: reports as unknown as JsonObject[] });
        finishOperation(op, { status: 'failed', error: `failed to stop dependent ${report.id}` });
        return errorResult(
          `${SAVE_WITH_DEPENDENTS_TOOL}: failed to stop dependent ${report.id}: ${stop.error}. ` +
            'Nothing was saved; dependents stopped before it have been restarted. ' +
            `(retriable: true)${mismatch}\n` +
            JSON.stringify({
              operation_id: op.operation_id,
              phase: 'stops',
              status: 'failed',
              dependents: reports,
            }),
        );
      }
      report.stopped = true;
      journalDependent(report);
    }

    // --- 3b. Revalidate: the world may have moved while we were stopping ----
    // Only worth a second discovery when stopping actually took time. With
    // nothing stopped there is no window to have drifted through, and the
    // save's own stop of the callee would fail loudly anyway.
    const lateIds: number[] = [];
    if (discovered !== null && scanScope !== null && stoppedIds().length > 0) {
      const again = await guarded([recipeId], { stopped: stoppedIds() }, () =>
        discoverDependents(ctx, recipeId, scanScope),
      );
      for (const id of again.dependent_ids) {
        if (dependentIds.indexOf(id) >= 0) continue;
        dependentIds.push(id);
        lateIds.push(id);
        const status = await guarded([id], { stopped: stoppedIds() }, () => recipeStatus(ctx, id));
        const report: DependentReport = {
          id,
          name: status.ok ? status.name : undefined,
          was_running: status.ok ? status.running : false,
          stopped: false,
          restarted: null,
          discovered_late: true,
        };
        if (!status.ok) report.error = status.error;
        reports.push(report);
        journalDependent(report, status.ok ? status.version_no : undefined);
        if (report.was_running) {
          const stop = await guarded([id], { stopped: stoppedIds() }, () =>
            lifecycle(ctx, id, 'stop'),
          );
          report.stopped = stop.ok;
          if (!stop.ok) report.error = stop.error;
          journalDependent(report);
        }
      }
    }
    endPhase(op, stopsPhase, 'ok', {
      stopped: stoppedIds(),
      late_discovered: lateIds,
    });

    // --- 4. Save the callee -------------------------------------------------
    const savePhase = beginPhase(op, 'save', [recipeId]);
    const saveArgs: JsonObject = routed(args, { recipe_id: recipeId });
    if (args.code !== undefined) saveArgs.code = args.code;
    if (args.code_path !== undefined) saveArgs.code_path = args.code_path;
    if (args.config !== undefined) saveArgs.config = args.config;
    if (typeof expectedBaseVersion === 'number') {
      saveArgs.expected_base_version_no = expectedBaseVersion;
    }
    if (args.verify_readback === false) saveArgs.verify_readback = false;
    // The callee's own stop/restart is handled by the save tool; it does not
    // touch dependents, which is exactly the gap this tool fills. A callee
    // whose connections are broken is saved but never started.
    saveArgs.restart_if_running = calleeBlocked ? false : args.restart_if_running !== false;
    if (args.ensure_running === true && !calleeBlocked) saveArgs.ensure_running = true;
    // Client-visible in the recipe version history, so keep it boring.
    saveArgs.comment = typeof args.comment === 'string' ? args.comment : NEUTRAL_VERSION_COMMENT;

    const saveResult = await guarded([recipeId], { stopped: stoppedIds() }, () =>
      ctx.call('workato_ui_save_recipe_code', saveArgs),
    );
    recordContext(op, readContextBlock(saveResult));
    const assessment = classifySaveResult(saveResult);
    updateOperation(op, {
      save: {
        classification: assessment.classification,
        persisted: assessment.persisted,
        valid: assessment.valid,
        version_no: assessment.version_no ?? null,
        save_status: assessment.save_status ?? null,
        code_errors: assessment.code_errors.length,
        dropped: assessment.dropped ? assessment.dropped.length : 0,
      },
    });
    endPhase(op, savePhase, assessment.persisted ? 'ok' : 'failed', {
      classification: assessment.classification,
      version_no: assessment.version_no ?? null,
    });

    if (assessment.classification === 'failed') {
      const countNote = describeDependentCountMismatch(
        assessment.text,
        dependentIds,
        stoppedIds().length,
        discovery,
      );
      const restorePhase = beginPhase(op, 'restore', stoppedIds());
      await restoreAll(() => null);
      endPhase(op, restorePhase, 'ok', { dependents: reports as unknown as JsonObject[] });
      finishOperation(op, { status: 'failed', error: 'the save failed' });
      return errorResult(
        `${SAVE_WITH_DEPENDENTS_TOOL}: the save failed, nothing was changed. Dependents this ` +
          `call stopped have been restarted.${countNote}\n--- save error ---\n${assessment.text}\n` +
          JSON.stringify({
            operation_id: op.operation_id,
            phase: 'save',
            status: 'failed',
            dependents: reports,
          }),
      );
    }

    // --- 5. Restore dependents to their prior state -------------------------
    const restorePhase = beginPhase(
      op,
      'restore',
      reports.filter((d) => d.stopped).map((d) => d.id),
    );
    const blockedReason: string | null = !assessment.restart_callers
      ? `the callee's new version ${assessment.version_no ?? '(unknown)'} is ` +
        `${assessment.classification}; starting a caller against it would run a broken callable`
      : calleeBlocked
        ? `the callee's connections are not usable (${calleeHealth.reason ?? 'unknown reason'})`
        : null;
    await restoreAll((dep) => {
      if (blockedReason !== null) return blockedReason;
      if (dep.connections_healthy === false) {
        return dep.blocked_reason ?? 'its own connections are not usable';
      }
      return null;
    });
    endPhase(op, restorePhase, 'ok', { dependents: reports as unknown as JsonObject[] });

    // --- 6. Report ----------------------------------------------------------
    const failedRestarts = reports.filter(
      (d) => d.was_running && d.restarted !== true && d.blocked_reason === undefined,
    );
    const blockedRestarts = reports.filter((d) => d.was_running && d.blocked_reason !== undefined);
    const payload: JsonObject = {
      operation_id: op.operation_id,
      recipe_id: assessment.payload?.recipe_id ?? recipeId,
      version_no: assessment.version_no,
      save_classification: assessment.classification,
      code_errors: assessment.code_errors,
      discovery,
      dependents: reports,
    };
    if (typeof expectedBaseVersion === 'number') {
      payload.expected_base_version_no = expectedBaseVersion;
    }
    if (assessment.dropped) payload.dropped = assessment.dropped;
    if (checkConnections) {
      payload.callee_connections_healthy = calleeHealth.healthy;
      if (calleeHealth.reason) payload.callee_connections_reason = calleeHealth.reason;
    }
    if (lateIds.length > 0) payload.late_discovered_caller_ids = lateIds;
    if (discovered !== null) {
      payload.discovery_completeness = discovered.completeness;
      if (discovered.reasons.length > 0) payload.discovery_reasons = discovered.reasons;
    }
    for (const key of ['save_status', 'was_running', 'restarted', 'datapills_normalized']) {
      if (assessment.payload && assessment.payload[key] !== undefined) {
        payload[`callee_${key}`] = assessment.payload[key];
      }
    }

    const notices: string[] = [];
    if (discovered !== null && discovered.completeness === 'partial') {
      notices.push(
        'caller discovery was PARTIAL, so the dependent list may be incomplete: ' +
          discovered.reasons.join('; '),
      );
    }
    if (lateIds.length > 0) {
      notices.push(
        `${lateIds.length} caller(s) appeared only in the post-stop revalidation: ` +
          lateIds.join(', '),
      );
    }
    if (blockedRestarts.length > 0) {
      notices.push(
        `${blockedRestarts.length} dependent(s) were deliberately NOT restarted and are stopped: ` +
          blockedRestarts.map((d) => `${d.id} (${d.blocked_reason})`).join('; '),
      );
    }
    if (failedRestarts.length > 0) {
      notices.push(
        `${failedRestarts.length} dependent(s) FAILED to restart and are stopped: ` +
          failedRestarts.map((d) => d.id).join(', '),
      );
    }
    const leftStopped = reports.filter((d) => !d.was_running);
    if (leftStopped.length > 0) {
      notices.push(
        `${leftStopped.length} dependent(s) were already stopped and were left stopped: ` +
          leftStopped.map((d) => d.id).join(', '),
      );
    }
    if (calleeHealth.healthy === null && checkConnections) {
      notices.push(
        `the callee's connection health could not be established (${calleeHealth.reason}), so it ` +
          'was not treated as blocking',
      );
    }

    // The operation ran to completion either way; whether the SAVE is usable
    // and whether every caller came back is in the result, not in the status.
    finishOperation(op, { status: 'done', result: payload });

    const isError = assessment.classification === 'persisted_incomplete';
    const headline =
      assessment.classification === 'ok' || assessment.classification === 'already_applied'
        ? `saved recipe ${recipeId} (${assessment.summary}), ` +
          `${reports.filter((d) => d.stopped).length} dependent(s) stopped and restored`
        : `recipe ${recipeId}: ${assessment.summary}. Callers were NOT restarted against it`;

    return {
      isError,
      content: [
        {
          type: 'text',
          text:
            headline +
            notices.map((n) => `, ${n}`).join('') +
            (isError
              ? `\n--- save detail ---\n${assessment.text}`
              : assessment.classification === 'persisted_invalid'
                ? `\n--- save detail ---\n${assessment.text}`
                : '') +
            `\n${JSON.stringify(payload)}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof NestedCallInterrupted) return interruptedResult(error);
    // Any unexpected throw must still put the dependents back.
    try {
      const restorePhase = beginPhase(op, 'restore', stoppedIds());
      await restoreAll(() => null);
      endPhase(op, restorePhase, 'ok', { dependents: reports as unknown as JsonObject[] });
    } catch {
      /* restoration failure is reported through the dependent reports */
    }
    const message = error instanceof Error ? error.message : String(error);
    finishOperation(op, { status: 'failed', error: message });
    return errorResult(
      `${SAVE_WITH_DEPENDENTS_TOOL} failed: ${message}. ` +
        `Dependent state: ${JSON.stringify(reports)}\n` +
        JSON.stringify({ operation_id: op.operation_id, phase: op.phase, status: 'failed' }),
    );
  }
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

export interface ResumeOutcome {
  operation_id: string;
  decisions: ResumeDecision[];
  save?: JsonObject;
  restarted: number[];
  failed: Array<{ recipe_id: number; reason: string }>;
  unfinished: Array<{ recipe_id: number; reason: string }>;
  notes: string[];
}

/**
 * Finish an interrupted operation.
 *
 * Reads the live state of every affected recipe, decides what may safely be
 * done (planResume), and does only that. A recipe that was stopped before the
 * operation stays stopped. A caller is restarted only when the callee's saved
 * version is usable and the connections are healthy. Anything that cannot be
 * finished is named with a reason instead of being retried blindly.
 *
 * The save is re-issued only when its outcome is genuinely unknown AND the
 * code still lives in a file the journal recorded; it carries the journalled
 * `expected_base_version_no`, so Workato either answers `already_applied` (no
 * duplicate version) or refuses because someone else saved in between, which
 * is exactly the roll-back this must never perform.
 */
export async function resumeSaveOperation(
  record: OperationRecord,
  callExtension: ExtensionCaller,
): Promise<ResumeOutcome> {
  const args: JsonObject = {};
  if (typeof record.context.tab_id === 'number') args.tabId = record.context.tab_id;
  const ctx: Ctx = { args, call: callExtension, op: record };
  const notes: string[] = [];

  const callee = record.recipes.find((r) => r.role === 'callee');
  const calleeId = callee ? callee.recipe_id : null;

  // 1. What is actually true right now.
  const live: ResumeLiveState[] = [];
  for (const recipe of record.recipes) {
    try {
      const status = await recipeStatus(ctx, recipe.recipe_id);
      live.push(
        status.ok
          ? {
              recipe_id: recipe.recipe_id,
              running: status.running,
              state: status.state ?? null,
              version_no: status.version_no ?? null,
            }
          : { recipe_id: recipe.recipe_id, running: null, error: status.error },
      );
    } catch (err) {
      live.push({
        recipe_id: recipe.recipe_id,
        running: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const liveById = new Map(live.map((l) => [l.recipe_id, l]));

  // 2. Establish the save outcome without creating a duplicate version.
  let saveUsable = false;
  let saveReason = 'the save was never reached';
  let saveDetail: JsonObject | undefined;
  const journalledSave = isRecord(record.save) ? record.save : null;
  const savePhase = record.phases.filter((p) => p.name === 'save').pop();

  if (journalledSave && savePhase && savePhase.status === 'ok') {
    saveUsable = journalledSave.persisted === true && journalledSave.valid === true;
    saveReason = saveUsable
      ? `the journalled save is ${String(journalledSave.classification)}`
      : `the journalled save is ${String(journalledSave.classification)}`;
    saveDetail = journalledSave;
  } else if (savePhase && calleeId !== null) {
    const codePath = record.args.code_path;
    const baseVersion = record.expected_base_version_no;
    const liveCallee = liveById.get(calleeId);
    if (typeof codePath === 'string' && codePath.length > 0) {
      const saveArgs: JsonObject = {
        recipe_id: calleeId,
        code_path: codePath,
        // The journalled lock is the whole point: a save that already landed
        // comes back as already_applied instead of a second version.
        ...(typeof baseVersion === 'number' ? { expected_base_version_no: baseVersion } : {}),
        restart_if_running: false,
        comment:
          typeof record.args.comment === 'string' ? record.args.comment : NEUTRAL_VERSION_COMMENT,
        ...(typeof record.context.tab_id === 'number' ? { tabId: record.context.tab_id } : {}),
      };
      if (record.args.config !== undefined) saveArgs.config = record.args.config;
      try {
        const assessment = classifySaveResult(
          await callExtension('workato_ui_save_recipe_code', saveArgs),
        );
        saveUsable = assessment.restart_callers && assessment.persisted;
        saveReason = assessment.summary;
        saveDetail = {
          classification: assessment.classification,
          persisted: assessment.persisted,
          valid: assessment.valid,
          version_no: assessment.version_no ?? null,
        };
        updateOperation(record, { save: saveDetail });
        notes.push(
          `the save was re-issued with the journalled expected_base_version_no ` +
            `${baseVersion ?? '(none)'}: ${assessment.summary}`,
        );
      } catch (err) {
        saveUsable = false;
        saveReason = `re-issuing the save failed (${err instanceof Error ? err.message : String(err)})`;
      }
    } else {
      saveUsable = false;
      saveReason =
        'the save outcome is unknown and the code was passed inline, so it cannot be ' +
        're-issued from the journal' +
        (liveCallee && typeof liveCallee.version_no === 'number'
          ? `; the callee is at version ${liveCallee.version_no} and the lock was ${baseVersion ?? '(none)'}`
          : '');
      notes.push(
        'pass code_path instead of code if you want an interrupted save to be resumable: the ' +
          'journal never stores a recipe tree.',
      );
    }
  }

  // 3. Connection health for the callee and for every caller we might restart.
  const connections: Record<number, { healthy: boolean; reason?: string }> = {};
  const wantRestart = record.recipes.filter(
    (r) => r.initial.running === true && liveById.get(r.recipe_id)?.running !== true,
  );
  const healthTargets = new Set<number>(wantRestart.map((r) => r.recipe_id));
  if (calleeId !== null && wantRestart.length > 0) healthTargets.add(calleeId);
  for (const id of healthTargets) {
    try {
      const health = await recipeConnections(ctx, id);
      if (health.healthy === false) {
        connections[id] = { healthy: false, reason: health.reason };
      }
    } catch (err) {
      notes.push(
        `the connection health of recipe ${id} could not be read (${err instanceof Error ? err.message : String(err)}); ` +
          'it was not treated as blocking',
      );
    }
  }
  if (calleeId !== null && connections[calleeId] && connections[calleeId].healthy === false) {
    saveUsable = false;
    saveReason = `the callee's connections are not usable (${connections[calleeId].reason ?? 'unknown reason'})`;
  }

  // 4. Decide, then do only what was decided.
  const decisions = planResume({
    record,
    live,
    save_usable: saveUsable,
    save_reason: saveReason,
    connections,
  });

  const restarted: number[] = [];
  const failed: Array<{ recipe_id: number; reason: string }> = [];
  const unfinished: Array<{ recipe_id: number; reason: string }> = [];

  const resumePhase = beginPhase(
    record,
    'restore',
    decisions.filter((d) => d.action === 'restart').map((d) => d.recipe_id),
  );
  for (const decision of decisions) {
    const recipe = record.recipes.find((r) => r.recipe_id === decision.recipe_id);
    if (decision.action === 'blocked' || decision.action === 'unknown') {
      unfinished.push({ recipe_id: decision.recipe_id, reason: decision.reason });
      if (recipe) {
        recipe.restarted = false;
        recipe.connections_reason = decision.reason;
      }
      continue;
    }
    if (decision.action !== 'restart') continue;
    try {
      const res = await lifecycle(ctx, decision.recipe_id, 'start');
      if (res.ok) {
        restarted.push(decision.recipe_id);
        if (recipe) {
          recipe.restarted = true;
          recipe.restart_outcome = res.outcome;
        }
      } else {
        failed.push({ recipe_id: decision.recipe_id, reason: res.error ?? 'the start failed' });
        if (recipe) {
          recipe.restarted = false;
          recipe.restart_outcome = res.outcome;
          recipe.error = res.error;
        }
      }
    } catch (err) {
      failed.push({
        recipe_id: decision.recipe_id,
        reason: err instanceof Error ? err.message : String(err),
      });
      if (recipe) recipe.restarted = false;
    }
  }
  endPhase(record, resumePhase, 'ok', {
    restarted,
    failed: failed as unknown as JsonObject[],
    unfinished: unfinished as unknown as JsonObject[],
  });

  const outcome: ResumeOutcome = {
    operation_id: record.operation_id,
    decisions,
    save: saveDetail,
    restarted,
    failed,
    unfinished,
    notes,
  };
  finishOperation(record, {
    status: failed.length === 0 && unfinished.length === 0 ? 'done' : 'failed',
    result: outcome as unknown as JsonObject,
    error:
      failed.length === 0 && unfinished.length === 0
        ? undefined
        : `${failed.length + unfinished.length} recipe(s) could not be safely finished`,
  });
  return outcome;
}
