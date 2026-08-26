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
 * There is no read endpoint in this codebase known to enumerate dependents by
 * id (Workato exposes only the *count*, and only as a stop-time error). So:
 *
 *   - `dependent_recipe_ids` given  -> that list is used verbatim.
 *   - otherwise                     -> the folder scan (`scan_folder_id`)
 *     reads each recipe's code and matches `call_recipe.flow_id`.
 *   - neither                       -> the tool refuses rather than saving as
 *     if there were no dependents. "I could not look" must never be reported
 *     as "there are none".
 *
 * Whatever the source, the count Workato itself reports at stop time is used
 * as a cross-check: if it says more dependents are active than we know about,
 * the save is abandoned and everything stopped is restored.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { parseToolJson } from './workato-recipe-mutators';
import { NEUTRAL_VERSION_COMMENT } from './workato-callable-schema';

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

/** Discover dependents by scanning a folder's recipes for a matching call step. */
async function scanFolderForDependents(
  ctx: Ctx,
  calleeId: number,
  folderId: number,
): Promise<number[]> {
  const listed = parseToolJson(
    await ctx.call('workato_search_recipes', routed(ctx.args, { folder_id: folderId, page: 1 })),
  );
  const items = Array.isArray(listed.items)
    ? listed.items
    : Array.isArray(listed.recipes)
      ? listed.recipes
      : [];

  const out: number[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'number' ? item.id : Number(item.id);
    if (!Number.isFinite(id) || id === calleeId) continue;
    const pulled = parseToolJson(
      await ctx.call('workato_pull_recipe', routed(ctx.args, { recipe_id: id, view: 'full' })),
    );
    if (treeCallsRecipe(pulled.code, calleeId)) out.push(id);
  }
  return out;
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
    if (Array.isArray(args.dependent_recipe_ids)) {
      dependentIds = args.dependent_recipe_ids
        .map((v) => (typeof v === 'number' ? v : Number(v)))
        .filter((v) => Number.isFinite(v));
      discovery = 'explicit';
    } else if (typeof args.scan_folder_id === 'number') {
      dependentIds = await scanFolderForDependents(ctx, recipeId, args.scan_folder_id);
      discovery = `folder_scan:${args.scan_folder_id}`;
    } else {
      return errorResult(
        `${SAVE_WITH_DEPENDENTS_TOOL}: no way to determine which recipes call ${recipeId}. ` +
          'Workato exposes only a COUNT of active dependents (in the stop error), never their ' +
          'ids, so this tool will not guess.\n' +
          'Pass one of:\n' +
          '  dependent_recipe_ids: [76887741, 76902321]   — the callers you already know\n' +
          '  scan_folder_id: 30573643                      — read every recipe in that folder ' +
          'and match call_recipe.flow_id\n' +
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
          await restoreAll();
          return errorResult(
            `${SAVE_WITH_DEPENDENTS_TOOL}: failed to stop dependent ${id} — ${stop.error}. ` +
              'Nothing was saved; dependents stopped before it have been restarted. ' +
              '(retriable: true)',
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
      const activeCount = parseActiveDependentCount(text);
      await restoreAll();
      const countNote =
        activeCount !== null && activeCount > 0
          ? `\nWorkato reports ${activeCount} dependent recipe(s) still ACTIVE, but only ` +
            `${dependentIds.length} were known to this call (${JSON.stringify(dependentIds)}). ` +
            'The dependent list is incomplete — find the missing caller(s) and pass ' +
            'dependent_recipe_ids explicitly.'
          : '';
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
    for (const key of ['save_status', 'was_running', 'restarted', 'datapills_normalized']) {
      if (saved[key] !== undefined) payload[`callee_${key}`] = saved[key];
    }

    const notices: string[] = [];
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
