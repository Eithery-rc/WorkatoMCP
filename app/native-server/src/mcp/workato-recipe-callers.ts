/**
 * Caller discovery for the bridge-side orchestrators.
 *
 * `workato_recipe_callers` does the work (dependency graph plus a paged code
 * scan, with a version-aware index). This module is the thin adapter that lets
 * an orchestrator consume that answer without asking the model to enumerate
 * callers by hand, and (the part that matters) carries the tool's honesty
 * forward: when the scan came back partial, everything downstream is told so.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { parseToolJson } from './workato-recipe-mutators';

export const RECIPE_CALLERS_TOOL = 'workato_recipe_callers';

type JsonObject = Record<string, unknown>;
type ExtensionCaller = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

/** One discovered caller, reduced to what an orchestrator needs. */
export interface CallerDetail extends JsonObject {
  recipe_id: number;
  name?: string;
  running: boolean | null;
  folder_id?: number;
  sources: string[];
}

export interface CallerDiscovery {
  dependent_ids: number[];
  details: CallerDetail[];
  completeness: 'complete' | 'partial';
  /** Human-readable provenance, used as the orchestrator's `discovery` field. */
  discovery_text: string;
  reasons: string[];
  /** Callers observed as running at discovery time. Cross-checked against Workato's count. */
  running_count: number;
}

export interface DiscoverCallersOptions {
  recipe_id: number;
  tabId?: number;
  windowId?: number;
  folder_ids?: number[];
  project_id?: string | number;
  scope?: 'folders' | 'project' | 'workspace';
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toRunning(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

/** Parse the tool's caller rows, ignoring anything that is not a usable recipe id. */
export function parseCallerPayload(payload: JsonObject): {
  details: CallerDetail[];
  completeness: 'complete' | 'partial';
  reasons: string[];
  scope: JsonObject;
} {
  const rows = Array.isArray(payload.callers) ? payload.callers : [];
  const details: CallerDetail[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = typeof row.recipe_id === 'number' ? row.recipe_id : Number(row.recipe_id);
    if (!Number.isFinite(id)) continue;
    const detail: CallerDetail = {
      recipe_id: id,
      running: toRunning(row.running),
      sources: Array.isArray(row.sources) ? row.sources.map((s) => String(s)) : [],
    };
    if (typeof row.name === 'string') detail.name = row.name;
    if (typeof row.folder_id === 'number') detail.folder_id = row.folder_id;
    details.push(detail);
  }
  const completeness = payload.completeness === 'complete' ? 'complete' : 'partial';
  const reasons = Array.isArray(payload.completeness_reasons)
    ? payload.completeness_reasons.map((r) => String(r))
    : [];
  return {
    details,
    completeness,
    reasons,
    scope: isRecord(payload.scope) ? payload.scope : {},
  };
}

/**
 * Run caller discovery and reduce it to the ids an orchestrator acts on.
 *
 * Throws when the tool itself fails (parseToolJson throws on isError), because
 * "I could not look" must never reach the caller as "there are none".
 */
export async function discoverCallers(
  callExtension: ExtensionCaller,
  options: DiscoverCallersOptions,
): Promise<CallerDiscovery> {
  const args: JsonObject = {
    recipe_id: options.recipe_id,
    // Static evidence only: job history proves a caller ran, never that the
    // list is complete, and a stop/save sequence must act on the static set.
    sources: ['graph', 'code'],
    include_callees: false,
  };
  if (options.folder_ids && options.folder_ids.length > 0) args.folder_ids = options.folder_ids;
  if (
    options.project_id !== undefined &&
    options.project_id !== null &&
    options.project_id !== ''
  ) {
    args.project_id = options.project_id;
  }
  if (options.scope !== undefined) args.scope = options.scope;
  if (typeof options.tabId === 'number') args.tabId = options.tabId;
  if (typeof options.windowId === 'number') args.windowId = options.windowId;

  const payload = parseToolJson(await callExtension(RECIPE_CALLERS_TOOL, args));
  const parsed = parseCallerPayload(payload);

  const scopeMode = typeof parsed.scope.mode === 'string' ? parsed.scope.mode : 'unknown';
  const folderIds = Array.isArray(parsed.scope.folder_ids) ? parsed.scope.folder_ids : [];
  const scopeLabel =
    scopeMode === 'workspace'
      ? 'workspace'
      : folderIds.length > 0
        ? `${scopeMode}(${folderIds.join(',')})`
        : scopeMode;
  const discoveryText =
    `recipe_callers:${scopeLabel}:${parsed.completeness}` +
    (parsed.completeness === 'partial' && parsed.reasons.length > 0
      ? ` (${parsed.reasons.join('; ')})`
      : '');

  return {
    dependent_ids: parsed.details.map((d) => d.recipe_id),
    details: parsed.details,
    completeness: parsed.completeness,
    discovery_text: discoveryText,
    reasons: parsed.reasons,
    running_count: parsed.details.filter((d) => d.running === true).length,
  };
}
