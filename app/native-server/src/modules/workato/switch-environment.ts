/**
 * `workato_switch_environment` on the bridge side: the one Workato tool whose
 * job is to CHANGE the workspace/environment a session is in.
 *
 * Everything else here guards against that change. A pinned session injects
 * expected_context into every workato_* call and refuses to route when the
 * pinned tab's workspace moved; both would block the switch or the very next
 * call after it. So the switch skips those guards, and once the extension
 * reports the verified new context, a session pinned to the same Chrome
 * profile adopts it (the session cookie belongs to the profile, so every tab
 * in it moved).
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from 'workatomcp-shared';

export const SWITCH_ENVIRONMENT_TOOL = TOOL_NAMES.WORKATO.SWITCH_ENVIRONMENT;

/** Tools that exist to move the session, so the pinned-context guards must not apply. */
export function isContextChangingTool(name: string): boolean {
  return name === SWITCH_ENVIRONMENT_TOOL;
}

export interface SwitchedContext {
  workspace_id?: number;
  workspace_name?: string;
  environment?: string;
}

/**
 * The verified `after` context from a successful switch result: the first text
 * block is a summary line followed by the JSON payload. Null when the result
 * is an error or does not carry one.
 */
export function parseSwitchResult(result: CallToolResult | undefined): SwitchedContext | null {
  if (!result || result.isError || !Array.isArray(result.content)) return null;
  const block = result.content.find((item: any) => item?.type === 'text') as
    | { text?: string }
    | undefined;
  const text = typeof block?.text === 'string' ? block.text : '';
  const start = text.indexOf('\n{');
  if (start < 0) return null;
  try {
    const payload = JSON.parse(text.slice(start + 1)) as { after?: Record<string, unknown> };
    const after = payload?.after;
    if (!after || typeof after !== 'object') return null;
    const out: SwitchedContext = {};
    if (typeof after.workspace_id === 'number') out.workspace_id = after.workspace_id;
    if (typeof after.workspace_name === 'string') out.workspace_name = after.workspace_name;
    if (typeof after.environment === 'string') out.environment = after.environment;
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

interface PinnedContext {
  workspace_id?: number;
  workspace_name?: string;
  environment?: string;
  generation: number;
}

/**
 * The pinned session after a switch: same profile and tab, new workspace and
 * environment, and the current registry generation so the next call does not
 * re-probe and report the switch as a ContextChanged drift.
 */
export function followSwitch<T extends PinnedContext>(
  session: T,
  switched: SwitchedContext,
  generation: number,
): T {
  const next: T = { ...session, generation };
  if (switched.workspace_id !== undefined) next.workspace_id = switched.workspace_id;
  if (switched.workspace_name !== undefined) next.workspace_name = switched.workspace_name;
  if (switched.environment !== undefined) next.environment = switched.environment;
  return next;
}
