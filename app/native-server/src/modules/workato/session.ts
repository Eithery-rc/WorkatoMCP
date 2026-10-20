/**
 * The Workato part of the session pin.
 *
 * Workato resolves the workspace and environment from the browser tab's own
 * session, so the same recipe id is a different recipe in another workspace,
 * and a wrong-workspace id answers 404 rather than an error anyone can act on.
 * Core pins profile + tab; this module adds what the pinned tab IS: host,
 * workspace and environment, read with workato_session_context. Every Workato
 * call then carries them as expected_context, and a write in another workspace
 * is refused by the extension instead of landing there.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { WORKATO_TOOL_NAMES } from '@mokuhub/mokutab-shared';
import type {
  ExtensionRequest,
  JsonObject,
  ModulePinProbe,
  ModuleRecheck,
  ModuleSessionHooks,
} from '../../mcp/module-api';
import { firstText, parseLastJsonObject } from '../../mcp/tool-result';
import { isContextChangingTool, parseSwitchResult } from './switch-environment';

export const SESSION_CONTEXT_TOOL = WORKATO_TOOL_NAMES.WORKATO_SESSION.SESSION_CONTEXT;

/** What the module pins on top of profile + tab. */
export interface WorkatoPin {
  host?: string;
  workspace_id?: number;
  workspace_name?: string;
  environment?: string;
}

interface ProbedContext {
  tab_id?: number;
  host?: string;
  workspace_id?: number;
  workspace_name?: string;
  environment?: string;
}

/**
 * Read one tab's workspace/environment through the extension. Cheap by design:
 * workato_session_context is cached per tab in the service worker.
 */
async function probeSessionContext(
  profile: string,
  tabId: number,
  request: ExtensionRequest,
): Promise<{ context?: ProbedContext; error?: string }> {
  try {
    const response = await request(SESSION_CONTEXT_TOOL, { tabId }, profile, 30000);
    if (!response || response.status !== 'success') {
      return { error: response?.error || 'no response from the extension' };
    }
    const data = response.data as CallToolResult;
    const text = firstText(data);
    if (data?.isError) return { error: text || 'workato_session_context failed' };
    const parsed = parseLastJsonObject(text);
    if (!parsed) return { error: 'could not read the workato_session_context response' };
    return { context: parsed as ProbedContext };
  } catch (err: any) {
    return { error: err?.message || String(err) };
  }
}

function pinFromContext(context: ProbedContext): WorkatoPin {
  const pin: WorkatoPin = {};
  if (typeof context.host === 'string') pin.host = context.host;
  if (typeof context.workspace_id === 'number') pin.workspace_id = context.workspace_id;
  if (typeof context.workspace_name === 'string') pin.workspace_name = context.workspace_name;
  if (context.environment !== undefined && context.environment !== null) {
    pin.environment = String(context.environment);
  }
  return pin;
}

/** The subset a write handler compares the target tab against. */
function expectedContext(pin: WorkatoPin): JsonObject | null {
  const expected: JsonObject = {};
  if (pin.host) expected.host = pin.host;
  if (pin.workspace_id !== undefined) expected.workspace_id = pin.workspace_id;
  if (pin.environment !== undefined) expected.environment = pin.environment;
  return Object.keys(expected).length > 0 ? expected : null;
}

export function createWorkatoSessionHooks(owns: (name: string) => boolean): ModuleSessionHooks {
  return {
    tabLabel: 'Workato tab ID',

    // Pin what the tab actually is, not what it was assumed to be: one cheap
    // workato_session_context call is the whole difference between "pinned to
    // a tab" and "pinned to a workspace".
    async probe(profile, tabId, request): Promise<ModulePinProbe> {
      const probe = await probeSessionContext(profile, tabId, request);
      if (probe.context) return { pin: pinFromContext(probe.context) };
      return {
        note:
          ` Workspace context was NOT pinned (${probe.error}); writes will not be ` +
          'checked against a workspace until this succeeds.',
      };
    },

    summary(pin: WorkatoPin | undefined) {
      return {
        host: pin?.host ?? null,
        workspace_id: pin?.workspace_id ?? null,
        workspace_name: pin?.workspace_name ?? null,
        environment: pin?.environment ?? null,
      };
    },

    describe(pin: WorkatoPin | undefined) {
      if (!pin || pin.workspace_id === undefined) return '';
      return (
        `, workspace ${pin.workspace_id}` +
        (pin.workspace_name ? ` "${pin.workspace_name}"` : '') +
        (pin.environment ? `, environment ${pin.environment}` : '')
      );
    },

    targets: owns,

    // `allow_context_mismatch:true` is the caller saying they know the target
    // is elsewhere; an explicit expected_context is theirs to keep.
    inject(name, args, pin: WorkatoPin) {
      const expected = expectedContext(pin);
      if (
        !expected ||
        name === SESSION_CONTEXT_TOOL ||
        // A switch exists to leave the pinned context; checking it against that would refuse it.
        isContextChangingTool(name) ||
        args.expected_context != null ||
        args.allow_context_mismatch === true
      ) {
        return args;
      }
      return { ...args, expected_context: expected };
    },

    isContextChanging: isContextChangingTool,

    needsRecheck(name, pin: WorkatoPin) {
      return (
        !isContextChangingTool(name) &&
        (pin.workspace_id !== undefined || pin.environment !== undefined)
      );
    },

    // A profile that reconnected may be a different browser session; the pinned
    // tab id can now belong to another workspace.
    async recheck(pin: WorkatoPin, target, request: ExtensionRequest): Promise<ModuleRecheck> {
      const probe = await probeSessionContext(target.profile, target.tabId, request);
      // A failed probe changes nothing, so the next call retries; the call
      // itself surfaces the real transport failure.
      if (!probe.context) return {};
      const actual = probe.context;
      const workspaceChanged =
        pin.workspace_id !== undefined &&
        actual.workspace_id !== undefined &&
        Number(actual.workspace_id) !== Number(pin.workspace_id);
      const environmentChanged =
        pin.environment !== undefined &&
        actual.environment !== undefined &&
        String(actual.environment) !== String(pin.environment);
      if (workspaceChanged || environmentChanged) {
        return {
          refusal:
            `ContextChanged: profile "${target.profile}" reconnected and tab ` +
            `${target.tabId} is now workspace ${actual.workspace_id ?? '?'}` +
            (actual.environment ? `, environment ${actual.environment}` : '') +
            `, but this session is pinned to workspace ${pin.workspace_id ?? '?'}` +
            (pin.environment ? `, environment ${pin.environment}` : '') +
            '. Nothing was sent. Check workato_session_context, then re-pin with ' +
            'chrome_switch_profile(profile, tabId).',
        };
      }
      const next: WorkatoPin = { ...pin };
      if (typeof actual.host === 'string') next.host = actual.host;
      if (typeof actual.workspace_name === 'string') next.workspace_name = actual.workspace_name;
      return { pin: next };
    },

    // The session cookie belongs to the Chrome profile: a pin on the profile
    // that just switched follows it, or its next call reports ContextChanged.
    follow(result: CallToolResult, pin: WorkatoPin | undefined) {
      const switched = parseSwitchResult(result);
      if (!switched) return null;
      const next: WorkatoPin = { ...(pin ?? {}) };
      if (switched.workspace_id !== undefined) next.workspace_id = switched.workspace_id;
      if (switched.workspace_name !== undefined) next.workspace_name = switched.workspace_name;
      if (switched.environment !== undefined) next.environment = switched.environment;
      return next;
    },
  };
}
