/**
 * workato_recipe_save_with_dependents — save a callable without hand-running
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
 * caller that was deliberately stopped before the save stays stopped — turning
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
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { parseToolJson } from './workato-recipe-mutators';
import { NEUTRAL_VERSION_COMMENT } from './workato-callable-schema';
import { discoverCallers, type CallerDiscovery } from './workato-recipe-callers';

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

interface Ctx {
  args: JsonObject;
  call: ExtensionCaller;
}

/** Tab/window routing pass-through, same convention as the mutator tools. */
function routed(args: JsonObject, target: JsonObject): JsonObject {
  if (typeof args.tabId === 'number') target.tabId = args.tabId;
  if (typeof args.windowId === 'number') target.windowId = args.windowId;
  return target;
}

async function recipeStatus(
  ctx: Ctx,
  recipeId: number,
): Promise<{ running: boolean; name?: string; version_no?: number }> {
  const res = parseToolJson(
    await ctx.call('workato_recipe_status', routed(ctx.args, { recipe_id: recipeId })),
  );
  return {
    running: res.running === true,
    name: typeof res.name === 'string' ? res.name : undefined,
    version_no: typeof res.version_no === 'number' ? res.version_no : undefined,
  };
}

async function lifecycle(
  ctx: Ctx,
  recipeId: number,
  action: 'start' | 'stop',
): Promise<{ ok: boolean; error?: string }> {
  const tool = action === 'start' ? 'workato_start_recipe' : 'workato_stop_recipe';
  const result = await ctx.call(
    tool,
    // wait:true — a stop that is merely enqueued does not unblock the save.
    routed(ctx.args, { recipe_id: recipeId, wait: true }),
  );
  if (result.isError) {
    const text =
      result.content?.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text ??
      `${tool} failed`;
    return { ok: false, error: text };
  }
  return { ok: true };
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

export async function handleWorkatoSaveWithDependentsCall(
  name: string,
  args: JsonObject,
  callExtension: ExtensionCaller,
): Promise<CallToolResult> {
  const ctx: Ctx = { args, call: callExtension };
  const restored: DependentReport[] = [];

  /** Put back everything this call stopped. Used on the error paths too. */
  const restoreAll = async (): Promise<void> => {
    for (const dep of restored) {
      if (!dep.stopped || !dep.was_running) continue;
      const res = await lifecycle(ctx, dep.id, 'start');
      dep.restarted = res.ok;
      if (!res.ok) dep.error = res.error;
    }
  };

  try {
    if (name !== SAVE_WITH_DEPENDENTS_TOOL) {
      return errorResult(`unsupported tool: ${name}`);
    }
    const recipeId = args.recipe_id;
    if (typeof recipeId !== 'number' || !Number.isFinite(recipeId)) {
      return errorResult('recipe_id must be a finite number');
    }
    if (args.code === undefined && args.code_path === undefined) {
      return errorResult(
        'pass code (object) or code_path (file) — this tool saves a recipe, it does not ' +
          'edit one in place.',
      );
    }

    // --- 1. Determine the dependent set ------------------------------------
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
      discovered = await discoverDependents(ctx, recipeId, scanScope);
      dependentIds = discovered.dependent_ids;
      discovery = discovered.discovery_text;
    } else {
      return errorResult(
        `${SAVE_WITH_DEPENDENTS_TOOL}: no way to determine which recipes call ${recipeId}. ` +
          'This tool will not guess.\n' +
          'Pass one of:\n' +
          '  dependent_recipe_ids: [76887741, 76902321]   — the callers you already know\n' +
          '  scan_folder_id: 30573643                      : discover the callers in that folder\n' +
          '  scan_folder_ids: [30573643, 30945905]         : several folders\n' +
          '  scan_project_id: "15842038"                   : every folder of that project\n' +
          '  scan_scope: "workspace"                       : the whole workspace (slowest)\n' +
          'Discovery runs workato_recipe_callers (dependency graph plus a paged code scan); ' +
          'call that tool directly first if you want to see the callers before touching them.\n' +
          'If the callee genuinely has no callers, workato_ui_save_recipe_code is the right ' +
          'tool and this one adds nothing.',
      );
    }

    // --- 2. Record prior state, stop the running ones -----------------------
    for (const id of dependentIds) {
      let status: { running: boolean; name?: string };
      try {
        status = await recipeStatus(ctx, id);
      } catch (e) {
        await restoreAll();
        return errorResult(
          `${SAVE_WITH_DEPENDENTS_TOOL}: could not read status of dependent ${id} ` +
            `(${e instanceof Error ? e.message : String(e)}). Nothing was saved` +
            (restored.some((d) => d.stopped)
              ? '; recipes stopped so far have been restarted.'
              : '.'),
        );
      }
      const report: DependentReport = {
        id,
        name: status.name,
        was_running: status.running,
        stopped: false,
        restarted: null,
      };
      restored.push(report);

      if (status.running) {
        const stop = await lifecycle(ctx, id, 'stop');
        if (!stop.ok) {
          report.error = stop.error;
          const stoppedRunning = restored.filter((d) => d.stopped).length;
          const mismatch = describeDependentCountMismatch(
            stop.error ?? '',
            dependentIds,
            stoppedRunning,
            discovery,
          );
          await restoreAll();
          return errorResult(
            `${SAVE_WITH_DEPENDENTS_TOOL}: failed to stop dependent ${id} — ${stop.error}. ` +
              'Nothing was saved; dependents stopped before it have been restarted. ' +
              `(retriable: true)${mismatch}`,
          );
        }
        report.stopped = true;
      }
    }

    // --- 3. Save the callee -------------------------------------------------
    const saveArgs: JsonObject = routed(args, { recipe_id: recipeId });
    if (args.code !== undefined) saveArgs.code = args.code;
    if (args.code_path !== undefined) saveArgs.code_path = args.code_path;
    if (args.config !== undefined) saveArgs.config = args.config;
    if (typeof args.expected_base_version_no === 'number') {
      saveArgs.expected_base_version_no = args.expected_base_version_no;
    }
    if (args.verify_readback === false) saveArgs.verify_readback = false;
    // The callee's own stop/restart is handled by the save tool; it does not
    // touch dependents, which is exactly the gap this tool fills.
    saveArgs.restart_if_running = args.restart_if_running !== false;
    if (args.ensure_running === true) saveArgs.ensure_running = true;
    // Client-visible in the recipe version history — keep it boring.
    saveArgs.comment = typeof args.comment === 'string' ? args.comment : NEUTRAL_VERSION_COMMENT;

    const saveResult = await callExtension('workato_ui_save_recipe_code', saveArgs);
    if (saveResult.isError) {
      const text =
        saveResult.content?.find((c): c is { type: 'text'; text: string } => c.type === 'text')
          ?.text ?? 'save failed';
      const countNote = describeDependentCountMismatch(
        text,
        dependentIds,
        restored.filter((d) => d.stopped).length,
        discovery,
      );
      await restoreAll();
      return errorResult(
        `${SAVE_WITH_DEPENDENTS_TOOL}: the save failed, nothing was changed. Dependents this ` +
          `call stopped have been restarted.${countNote}\n--- save error ---\n${text}`,
      );
    }

    const saved = parseToolJson(saveResult);

    // --- 4. Restore dependents to their prior state -------------------------
    await restoreAll();

    const failedRestarts = restored.filter((d) => d.was_running && d.restarted !== true);
    const payload: JsonObject = {
      recipe_id: saved.recipe_id ?? recipeId,
      version_no: saved.version_no,
      code_errors: saved.code_errors ?? [],
      discovery,
      dependents: restored,
    };
    if (discovered !== null) {
      payload.discovery_completeness = discovered.completeness;
      if (discovered.reasons.length > 0) payload.discovery_reasons = discovered.reasons;
    }
    for (const key of ['save_status', 'was_running', 'restarted', 'datapills_normalized']) {
      if (saved[key] !== undefined) payload[`callee_${key}`] = saved[key];
    }

    const notices: string[] = [];
    if (discovered !== null && discovered.completeness === 'partial') {
      notices.push(
        'caller discovery was PARTIAL, so the dependent list may be incomplete: ' +
          discovered.reasons.join('; '),
      );
    }
    if (failedRestarts.length > 0) {
      notices.push(
        `${failedRestarts.length} dependent(s) FAILED to restart and are stopped: ` +
          failedRestarts.map((d) => d.id).join(', '),
      );
    }
    const leftStopped = restored.filter((d) => !d.was_running);
    if (leftStopped.length > 0) {
      notices.push(
        `${leftStopped.length} dependent(s) were already stopped and were left stopped: ` +
          leftStopped.map((d) => d.id).join(', '),
      );
    }

    const versionLabel =
      typeof saved.version_no === 'number' ? `version ${saved.version_no}` : 'version unknown';
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text:
            `saved recipe ${recipeId} (${versionLabel}), ` +
            `${restored.filter((d) => d.stopped).length} dependent(s) stopped and restored` +
            notices.map((n) => `, ${n}`).join('') +
            `\n${JSON.stringify(payload)}`,
        },
      ],
    };
  } catch (error) {
    // Any unexpected throw must still put the dependents back.
    try {
      await restoreAll();
    } catch {
      /* restoration failure is reported through the dependent reports */
    }
    return errorResult(
      `${name} failed: ${error instanceof Error ? error.message : String(error)}. ` +
        `Dependent state: ${JSON.stringify(restored)}`,
    );
  }
}
