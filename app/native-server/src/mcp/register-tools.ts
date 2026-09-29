/**
 * MCP Tools Registry.
 * Handles listing and dispatching MCP tool calls to the active WebSocket Chrome profile connection.
 *
 * Author: Roman Chikalenko
 * Version: 1.4.0
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance from '../native-messaging-host';
import { NativeMessageType, TOOL_SCHEMAS, TOOL_NAMES } from 'workatomcp-shared';
import {
  isWorkatoFileTool,
  prepareWorkatoCall,
  writePulledRecipe,
  type RecipeFileOrigin,
} from './workato-file-io';
import {
  isWorkatoLcapFileTool,
  prepareLcapCall,
  writeLcapOutFile,
  type LcapOutFile,
} from './workato-lcap-io';
import {
  handleWorkatoRecipeMutatorCall,
  isWorkatoRecipeMutatorTool,
} from './workato-recipe-mutators';
import { handleWorkatoCallableCall, isWorkatoCallableTool } from './workato-callable-schema';
import {
  handleWorkatoSaveWithDependentsCall,
  isWorkatoSaveWithDependentsTool,
} from './workato-save-dependents';
import { handleWorkatoDatapillCall, isWorkatoDatapillTool } from './workato-datapill';
import { handleWorkatoOperationCall, isWorkatoOperationTool } from './workato-operation-status';
import { handleWorkatoBridgeInfoCall, isWorkatoBridgeInfoTool } from './workato-bridge-info';
import {
  handleWorkatoReloadExtensionCall,
  isWorkatoReloadExtensionTool,
} from './workato-reload-extension';
import { handleWorkatoStepSchemaApplyCall, isStepSchemaApplyCall } from './workato-step-schema';
import {
  applyAutoFile,
  prepareAutoFileCall,
  withOutFileToolSchemas,
  type AutoFilePlan,
} from './workato-auto-file';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { profileRegistry } from '../server/profile-registry';

export const PROFILE_ROUTING_ARG = 'profile';
export const TAB_ROUTING_ARG = 'tabId';

const PROFILE_ROUTING_PROPERTY = {
  type: 'string',
  description:
    'Optional connected Chrome profile name for this call only. Overrides this MCP session profile without changing it.',
};

const PROFILE_MANAGEMENT_TOOLS = new Set([
  TOOL_NAMES.WORKATO.LIST_PROFILES,
  TOOL_NAMES.WORKATO.SWITCH_PROFILE,
  // Its own `profile` argument selects which profiles reload, not where to route.
  TOOL_NAMES.WORKATO.RELOAD_EXTENSION,
]);

type JsonObject = Record<string, any>;

interface RoutedArgs {
  args: JsonObject;
  profile: string | null;
}

/**
 * What this MCP session is pinned to.
 *
 * Workato resolves the workspace and environment from the browser tab's own
 * session, so "profile + tab" is the whole identity of a call: the same recipe
 * id is a different recipe in another workspace, and a wrong-workspace id
 * answers 404 rather than an error anyone can act on. Pinning the tuple, and
 * refusing to route around it, is what keeps a long session on one target.
 */
export interface SessionContext {
  profile: string;
  tabId: number | null;
  host?: string;
  workspace_id?: number;
  workspace_name?: string;
  environment?: string;
  /** ISO timestamp of the pin. */
  pinned_at: string;
  /**
   * profileRegistry generation observed when the context was last verified. A
   * change means a profile connected or disconnected, so the pinned tab is
   * re-checked before the next call is routed.
   */
  generation: number;
}

/** The subset a write handler compares the target tab against. */
interface ExpectedContext {
  host?: string;
  workspace_id?: number;
  environment?: string;
}

function sessionExpectedContext(session: SessionContext | null): ExpectedContext | null {
  if (!session) return null;
  const expected: ExpectedContext = {};
  if (session.host) expected.host = session.host;
  if (session.workspace_id !== undefined) expected.workspace_id = session.workspace_id;
  if (session.environment !== undefined) expected.environment = session.environment;
  return Object.keys(expected).length > 0 ? expected : null;
}

const CONTEXT_BLOCK_PREFIX = '{"context":';

function firstText(result: CallToolResult | undefined): string {
  const block = Array.isArray(result?.content)
    ? result.content.find((item: any) => item?.type === 'text')
    : undefined;
  return typeof (block as any)?.text === 'string' ? (block as any).text : '';
}

/** Parse the last JSON object line of a `summary\nJSON` tool response. */
function parseLastJsonObject(text: string): JsonObject | null {
  const lines = text.split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next line */
    }
  }
  return null;
}

/** Index of the trailing actual-context block the extension appends, if any. */
function contextBlockIndex(result: CallToolResult | undefined): number {
  if (!result || !Array.isArray(result.content) || result.content.length === 0) return -1;
  const last = result.content.length - 1;
  const block: any = result.content[last];
  if (block?.type !== 'text' || typeof block.text !== 'string') return -1;
  return block.text.startsWith(CONTEXT_BLOCK_PREFIX) ? last : -1;
}

/** The extension's actual-context block, parsed. Null when there is none. */
function readContextBlock(result: CallToolResult | undefined): JsonObject | null {
  const index = contextBlockIndex(result);
  if (index < 0) return null;
  try {
    const parsed = JSON.parse((result!.content[index] as any).text);
    const context = parsed?.context;
    return context && typeof context === 'object' && !Array.isArray(context) ? context : null;
  } catch {
    return null;
  }
}

/**
 * Add the routed profile to the extension's context block. The extension knows
 * the tab and workspace; only the bridge knows which profile the call went to.
 */
function stampContextBlock(result: CallToolResult, profile: string | null): CallToolResult {
  const index = contextBlockIndex(result);
  if (index < 0) return result;
  const context = readContextBlock(result);
  if (!context) return result;
  const content = [...result.content];
  content[index] = {
    type: 'text',
    text: JSON.stringify({ context: { ...context, profile: profile ?? null } }),
  };
  return { ...result, content };
}

/** Origin metadata for a recipe file, from the pull response and the routing. */
function buildPullOrigin(
  result: CallToolResult,
  profile: string | null,
  args: JsonObject,
): Partial<RecipeFileOrigin> {
  const context = readContextBlock(result);
  const origin: Partial<RecipeFileOrigin> = {};
  if (profile) origin.profile = profile;
  const tabId =
    typeof context?.tab_id === 'number'
      ? context.tab_id
      : typeof args?.tabId === 'number'
        ? args.tabId
        : undefined;
  if (tabId !== undefined) origin.tab_id = tabId;
  if (typeof context?.host === 'string') origin.host = context.host;
  if (typeof context?.workspace_id === 'number') origin.workspace_id = context.workspace_id;
  if (typeof context?.workspace_name === 'string') origin.workspace_name = context.workspace_name;
  if (context?.environment !== undefined && context.environment !== null) {
    origin.environment = String(context.environment);
  }
  return origin;
}

interface ToolRouter {
  listTools: () => Promise<{ tools: Tool[] }>;
  handleToolCall: (name: string, args: any) => Promise<CallToolResult>;
}

export function withProfileRoutingToolSchemas(tools: Tool[]): Tool[] {
  return tools.map((tool) => {
    if (PROFILE_MANAGEMENT_TOOLS.has(tool.name)) return tool;

    const inputSchema = (tool.inputSchema || { type: 'object' }) as JsonObject;
    if (inputSchema.type !== 'object') return tool;

    const properties = { ...(inputSchema.properties || {}) };
    if (!properties[PROFILE_ROUTING_ARG]) {
      properties[PROFILE_ROUTING_ARG] = PROFILE_ROUTING_PROPERTY;
    }

    return {
      ...tool,
      inputSchema: {
        ...inputSchema,
        type: 'object',
        properties,
        required: Array.isArray(inputSchema.required) ? inputSchema.required : [],
      },
    };
  });
}

function routeError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function normalizeProfile(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${PROFILE_ROUTING_ARG} must be a non-empty connected profile name`);
  }
  return value.trim();
}

function extractRoutedArgs(args: any): RoutedArgs {
  const source = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const profile = normalizeProfile(source[PROFILE_ROUTING_ARG]);
  const { [PROFILE_ROUTING_ARG]: _profile, ...cleanArgs } = source;
  return { args: cleanArgs, profile };
}

function normalizeTabId(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${TAB_ROUTING_ARG} must be a non-negative integer Chrome tab id`);
  }
  return value;
}

function isSessionTargetedTool(name: string): boolean {
  if (!name.startsWith('workato_')) return false;
  return !PROFILE_MANAGEMENT_TOOLS.has(name);
}

/**
 * Put the session's pinned tab and expected workspace on a call.
 *
 * Applied to the top-level call and to every nested orchestrator call, so a
 * multi-step operation cannot read one tab and write another. An explicit
 * tabId/windowId always wins, and `allow_context_mismatch:true` is the caller
 * saying they know the target is elsewhere.
 */
function withSessionTarget(
  name: string,
  args: JsonObject,
  session: SessionContext | null,
): JsonObject {
  if (!session || !isSessionTargetedTool(name)) return args;
  let next = args;
  if (
    session.tabId !== null &&
    typeof args.tabId !== 'number' &&
    typeof args.windowId !== 'number'
  ) {
    next = { ...next, tabId: session.tabId };
  }
  const expected = sessionExpectedContext(session);
  if (
    expected &&
    name !== TOOL_NAMES.WORKATO_SESSION.SESSION_CONTEXT &&
    args.expected_context == null &&
    args.allow_context_mismatch !== true
  ) {
    next = { ...next, expected_context: expected };
  }
  return next;
}

function isConnectedProfile(profile: string): boolean {
  return profileRegistry.getConnectedProfiles().includes(profile);
}

function requireConnectedProfile(profile: string): void {
  if (!isConnectedProfile(profile)) {
    throw new Error(
      `profile "${profile}" is not connected. Connected profiles: ${JSON.stringify(
        profileRegistry.getConnectedProfiles(),
      )}`,
    );
  }
}

/**
 * Route one message to the extension.
 *
 * A pinned profile is honoured absolutely: a failure there is reported, never
 * retried against another profile or the stdio native-messaging host, because
 * "the call silently went somewhere else" is the drift this whole subsystem
 * exists to stop. The native host stays reachable only when no Chrome profile
 * is connected at all, and the response says so.
 */
async function sendRequestToExtension(
  messagePayload: any,
  messageType: string = 'request_data',
  timeoutMs?: number,
  profile: string | null = null,
): Promise<any> {
  if (profile) {
    requireConnectedProfile(profile);
    try {
      return await profileRegistry.sendRequest(profile, messagePayload, messageType, timeoutMs);
    } catch (err: any) {
      throw new Error(
        `call to pinned profile "${profile}" failed: ${err?.message || String(err)}. ` +
          `Connected profiles: ${JSON.stringify(profileRegistry.getConnectedProfiles())}. ` +
          'The call was NOT re-sent to another profile or to the native-messaging host, because ' +
          'this session is pinned. Use workato_switch_profile to move the session deliberately.',
      );
    }
  }

  const activeProfile = profileRegistry.getActiveProfile();
  if (activeProfile) {
    try {
      return await profileRegistry.sendRequest(
        activeProfile,
        messagePayload,
        messageType,
        timeoutMs,
      );
    } catch (err: any) {
      throw new Error(
        `call to the bridge default profile "${activeProfile}" failed: ` +
          `${err?.message || String(err)}. Connected profiles: ` +
          `${JSON.stringify(profileRegistry.getConnectedProfiles())}. No profile is pinned for ` +
          'this MCP session and the call was NOT re-sent through the native-messaging host, ' +
          'because a Chrome profile is connected. Pin the intended one with ' +
          'workato_switch_profile(profile, tabId).',
      );
    }
  }

  // No Chrome profile is connected at all: the legacy stdio host is the only
  // transport left, and the caller is told that is what happened.
  try {
    return await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      messagePayload,
      messageType,
      timeoutMs,
    );
  } catch (err: any) {
    throw new Error(
      `no Chrome profile is connected to the bridge, so the call was sent through the legacy ` +
        `native-messaging host, which failed: ${err?.message || String(err)}. Open Chrome with ` +
        'the WorkatoMCP extension, then check workato_list_profiles.',
    );
  }
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
  profile: string | null,
  tabId: number,
): Promise<{ context?: ProbedContext; error?: string }> {
  try {
    const response = await sendRequestToExtension(
      { name: TOOL_NAMES.WORKATO_SESSION.SESSION_CONTEXT, args: { tabId } },
      NativeMessageType.CALL_TOOL,
      30000,
      profile,
    );
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

async function listDynamicFlowTools(profile: string | null): Promise<Tool[]> {
  try {
    const response = await sendRequestToExtension({}, 'rr_list_published_flows', 20000, profile);
    if (response && response.status === 'success' && Array.isArray(response.items)) {
      const tools: Tool[] = [];
      for (const item of response.items) {
        const name = `flow.${item.slug}`;
        const description =
          (item.meta && item.meta.tool && item.meta.tool.description) ||
          item.description ||
          'Recorded flow';
        const properties: Record<string, any> = {};
        const required: string[] = [];
        for (const v of item.variables || []) {
          const desc = v.label || v.key;
          const typ = (v.type || 'string').toLowerCase();
          const prop: any = { description: desc };
          if (typ === 'boolean') prop.type = 'boolean';
          else if (typ === 'number') prop.type = 'number';
          else if (typ === 'enum') {
            prop.type = 'string';
            if (v.rules && Array.isArray(v.rules.enum)) prop.enum = v.rules.enum;
          } else if (typ === 'array') {
            // default array of strings; can extend with itemType later
            prop.type = 'array';
            prop.items = { type: 'string' };
          } else {
            prop.type = 'string';
          }
          if (v.default !== undefined) prop.default = v.default;
          if (v.rules && v.rules.required) required.push(v.key);
          properties[v.key] = prop;
        }
        // Run options
        properties['tabTarget'] = { type: 'string', enum: ['current', 'new'], default: 'current' };
        properties['refresh'] = { type: 'boolean', default: false };
        properties['captureNetwork'] = { type: 'boolean', default: false };
        properties['returnLogs'] = { type: 'boolean', default: false };
        properties['timeoutMs'] = { type: 'number', minimum: 0 };
        const tool: Tool = {
          name,
          description,
          inputSchema: { type: 'object', properties, required },
        };
        tools.push(tool);
      }
      return withProfileRoutingToolSchemas(tools);
    }
    return [];
  } catch (e) {
    return [];
  }
}

export const setupTools = (server: Server) => {
  const router = createToolRouter();

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, router.listTools);

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    router.handleToolCall(request.params.name, request.params.arguments || {}),
  );
};

export function createToolRouter(): ToolRouter {
  // One pinned tuple per MCP session (one createToolRouter per transport).
  let session: SessionContext | null = null;

  const getRoutingProfile = (callProfile: string | null): string | null =>
    callProfile || session?.profile || null;

  const sessionSummary = () =>
    session
      ? {
          profile: session.profile,
          tab_id: session.tabId,
          host: session.host ?? null,
          workspace_id: session.workspace_id ?? null,
          workspace_name: session.workspace_name ?? null,
          environment: session.environment ?? null,
          pinned_at: session.pinned_at,
        }
      : null;

  const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
    try {
      // 1. Check for Profile Management Admin Tools
      if (name === TOOL_NAMES.WORKATO.LIST_PROFILES) {
        const defaultProfile = profileRegistry.getActiveProfile();
        const connected = profileRegistry.getConnectedProfiles();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  active_profile: session?.profile || defaultProfile,
                  session_profile: session?.profile ?? null,
                  session_tab_id: session?.tabId ?? null,
                  session_context: sessionSummary(),
                  server_default_profile: defaultProfile,
                  connected_profiles: connected,
                  routing_note: session
                    ? `This session is pinned to profile "${session.profile}"` +
                      (session.tabId !== null ? ` and tab ${session.tabId}` : '') +
                      '. Calls never fall back to another profile or transport.'
                    : connected.length > 0
                      ? 'No profile is pinned: calls follow the bridge default profile, which ' +
                        'can change when profiles connect or disconnect. Pin one with ' +
                        'workato_switch_profile(profile, tabId).'
                      : 'No Chrome profile is connected: calls go through the legacy ' +
                        'native-messaging host, which has no profile or tab identity.',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (name === TOOL_NAMES.WORKATO.SWITCH_PROFILE) {
        const targetProfile = normalizeProfile(args?.profile);
        if (!targetProfile) {
          return routeError('Error: target profile parameter is required.');
        }
        if (!isConnectedProfile(targetProfile)) {
          return routeError(
            `Error: profile "${targetProfile}" is not connected. Connected profiles: ${JSON.stringify(
              profileRegistry.getConnectedProfiles(),
            )}`,
          );
        }
        const nextSessionTabId = normalizeTabId(args?.tabId);
        const profileChanged = session?.profile !== targetProfile;
        const nextTabId =
          nextSessionTabId !== null
            ? nextSessionTabId
            : profileChanged
              ? null
              : (session?.tabId ?? null);
        const next: SessionContext = {
          profile: targetProfile,
          tabId: nextTabId,
          pinned_at: new Date().toISOString(),
          generation: profileRegistry.getGeneration(),
        };

        // Pin what the tab actually is, not what it was assumed to be: one
        // cheap workato_session_context call is the whole difference between
        // "pinned to a tab" and "pinned to a workspace".
        let contextNote = '';
        if (nextTabId !== null) {
          const probe = await probeSessionContext(targetProfile, nextTabId);
          if (probe.context) {
            if (typeof probe.context.host === 'string') next.host = probe.context.host;
            if (typeof probe.context.workspace_id === 'number') {
              next.workspace_id = probe.context.workspace_id;
            }
            if (typeof probe.context.workspace_name === 'string') {
              next.workspace_name = probe.context.workspace_name;
            }
            if (probe.context.environment !== undefined && probe.context.environment !== null) {
              next.environment = String(probe.context.environment);
            }
          } else {
            contextNote =
              ` Workspace context was NOT pinned (${probe.error}); writes will not be ` +
              'checked against a workspace until this succeeds.';
          }
        }
        session = next;

        const summary = sessionSummary();
        return {
          content: [
            {
              type: 'text',
              text:
                `Successfully switched this MCP session to profile context: "${targetProfile}"` +
                (session.tabId !== null ? ` and Workato tab ID: ${session.tabId}` : '') +
                (session.workspace_id !== undefined
                  ? `, workspace ${session.workspace_id}` +
                    (session.workspace_name ? ` "${session.workspace_name}"` : '') +
                    (session.environment ? `, environment ${session.environment}` : '')
                  : '') +
                contextNote +
                `\n${JSON.stringify({ session_context: summary })}`,
            },
          ],
        };
      }

      // Runs across every connected profile, so it bypasses profile routing.
      if (isWorkatoReloadExtensionTool(name)) {
        return handleWorkatoReloadExtensionCall(args, {
          connectedProfiles: () => profileRegistry.getConnectedProfiles(),
          connectionSerial: (profile) => profileRegistry.getConnectionSerial(profile),
          defaultProfile: () => profileRegistry.getActiveProfile(),
          request: (profile, type, payload, timeoutMs) =>
            profileRegistry.sendRequest(profile, payload, type, timeoutMs),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        });
      }

      const routed = extractRoutedArgs(args);
      const routingProfile = getRoutingProfile(routed.profile);

      // A profile that reconnected may be a different browser session; the
      // pinned tab id can now belong to another workspace. Re-check once per
      // registry generation before anything is routed.
      if (
        session &&
        session.tabId !== null &&
        name.startsWith('workato_') &&
        (session.workspace_id !== undefined || session.environment !== undefined)
      ) {
        const generation = profileRegistry.getGeneration();
        if (generation !== session.generation) {
          const probe = await probeSessionContext(session.profile, session.tabId);
          if (probe.context) {
            const actual = probe.context;
            const workspaceChanged =
              session.workspace_id !== undefined &&
              actual.workspace_id !== undefined &&
              Number(actual.workspace_id) !== Number(session.workspace_id);
            const environmentChanged =
              session.environment !== undefined &&
              actual.environment !== undefined &&
              String(actual.environment) !== String(session.environment);
            if (workspaceChanged || environmentChanged) {
              return routeError(
                `ContextChanged: profile "${session.profile}" reconnected and tab ` +
                  `${session.tabId} is now workspace ${actual.workspace_id ?? '?'}` +
                  (actual.environment ? `, environment ${actual.environment}` : '') +
                  `, but this session is pinned to workspace ${session.workspace_id ?? '?'}` +
                  (session.environment ? `, environment ${session.environment}` : '') +
                  '. Nothing was sent. Check workato_session_context, then re-pin with ' +
                  'workato_switch_profile(profile, tabId).',
              );
            }
            if (typeof actual.host === 'string') session.host = actual.host;
            if (typeof actual.workspace_name === 'string') {
              session.workspace_name = actual.workspace_name;
            }
            session.generation = generation;
          }
          // A failed probe leaves the generation alone so the next call retries;
          // the call itself surfaces the real transport failure.
        }
      }

      // 2. If calling a dynamic flow tool (name starts with flow.), proxy to common flow-run tool
      if (name && name.startsWith('flow.')) {
        // We need to resolve flow by slug to ID
        try {
          const resp = await sendRequestToExtension(
            {},
            'rr_list_published_flows',
            20000,
            routingProfile,
          );
          const items = (resp && resp.items) || [];
          const slug = name.slice('flow.'.length);
          const match = items.find((it: any) => it.slug === slug);
          if (!match) throw new Error(`Flow not found for tool ${name}`);
          const flowArgs = { flowId: match.id, args: routed.args };
          const proxyRes = await sendRequestToExtension(
            { name: 'record_replay_flow_run', args: flowArgs },
            NativeMessageType.CALL_TOOL,
            120000,
            routingProfile,
          );
          if (proxyRes.status === 'success') return proxyRes.data;
          return {
            content: [{ type: 'text', text: `Error calling dynamic flow tool: ${proxyRes.error}` }],
            isError: true,
          };
        } catch (err: any) {
          return {
            content: [
              {
                type: 'text',
                text: `Error resolving dynamic flow tool: ${err?.message || String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }
      // workato_pull_recipe(out_file) / workato_ui_save_recipe_code(code_path):
      // resolve the file params here (this process has filesystem access).
      let effectiveArgs: any = withSessionTarget(name, routed.args || {}, session);
      let pullOutFile: string | undefined;
      if (isWorkatoFileTool(name)) {
        const prepared = prepareWorkatoCall(name, effectiveArgs || {});
        effectiveArgs = prepared.args;
        pullOutFile = prepared.pullOutFile;
      }

      // workato_lcap_page_get(out_file) / *_save(content_path) / api_request(out_file):
      // the LCAP page tree and raw response bodies get the same treatment.
      let lcapOutFile: LcapOutFile | undefined;
      if (isWorkatoLcapFileTool(name)) {
        const prepared = prepareLcapCall(name, effectiveArgs || {});
        effectiveArgs = prepared.args;
        lcapOutFile = prepared.outFile;
      }

      // Generic out_file / auto-file for every other read tool and for
      // chrome_screenshot: strip the file params here, spill the result on the
      // way back out. See workato-auto-file.ts.
      let autoFilePlan: AutoFilePlan | undefined;
      {
        const prepared = prepareAutoFileCall(name, effectiveArgs || {});
        effectiveArgs = prepared.args;
        autoFilePlan = prepared.plan;
      }

      // `workato_datapill` is pure string assembly — no browser round trip.
      if (isWorkatoDatapillTool(name)) {
        return handleWorkatoDatapillCall(name, effectiveArgs || {});
      }

      // `workato_bridge_info` reports this build's own identity, locally.
      if (isWorkatoBridgeInfoTool(name)) {
        return handleWorkatoBridgeInfoCall({
          connected_profiles: profileRegistry.getConnectedProfiles(),
          session_context: sessionSummary(),
          default_profile: profileRegistry.getActiveProfile(),
        });
      }

      // Native orchestrators: they drive several extension tools in sequence
      // (pull -> mutate -> save, or stop -> save -> restore) and need Node's
      // filesystem for code_path, so they run here rather than in the page.
      if (
        isWorkatoRecipeMutatorTool(name) ||
        isWorkatoCallableTool(name) ||
        isWorkatoSaveWithDependentsTool(name) ||
        isWorkatoOperationTool(name) ||
        isStepSchemaApplyCall(name, effectiveArgs)
      ) {
        const callExtension = async (
          toolName: string,
          toolArgs: Record<string, unknown>,
        ): Promise<CallToolResult> => {
          // Each nested call goes through the same file-param resolution the
          // top-level dispatch does, so an orchestrator can pass code_path
          // straight through to the save tool.
          // Nested calls get the same pinned tab and workspace as the top-level
          // one: an orchestrator that reads in one tab must not write in another.
          let nestedArgs: JsonObject = withSessionTarget(toolName, toolArgs || {}, session);
          let nestedOutFile: string | undefined;
          if (isWorkatoFileTool(toolName)) {
            const prepared = prepareWorkatoCall(toolName, nestedArgs);
            nestedArgs = prepared.args;
            nestedOutFile = prepared.pullOutFile;
          }
          const response = await sendRequestToExtension(
            {
              name: toolName,
              args: nestedArgs,
            },
            NativeMessageType.CALL_TOOL,
            120000,
            routingProfile,
          );
          if (response.status === 'success') {
            return nestedOutFile
              ? writePulledRecipe(
                  nestedOutFile,
                  response.data,
                  buildPullOrigin(response.data, routingProfile, nestedArgs),
                )
              : response.data;
          }
          return {
            content: [{ type: 'text', text: `Error calling tool: ${response.error}` }],
            isError: true,
          };
        };

        if (isWorkatoRecipeMutatorTool(name)) {
          return handleWorkatoRecipeMutatorCall(name, effectiveArgs || {}, callExtension);
        }
        // workato_step_schema(apply_to): generate in the extension, then write
        // both schemas onto the step in one saved version.
        if (isStepSchemaApplyCall(name, effectiveArgs)) {
          return handleWorkatoStepSchemaApplyCall(name, effectiveArgs || {}, callExtension);
        }
        if (isWorkatoCallableTool(name)) {
          return handleWorkatoCallableCall(name, effectiveArgs || {}, callExtension);
        }
        // Journal reads happen in this process; only refresh/resume calls out.
        if (isWorkatoOperationTool(name)) {
          return handleWorkatoOperationCall(name, effectiveArgs || {}, callExtension);
        }
        return handleWorkatoSaveWithDependentsCall(name, effectiveArgs || {}, callExtension);
      }

      const response = await sendRequestToExtension(
        {
          name,
          args: effectiveArgs,
        },
        NativeMessageType.CALL_TOOL,
        120000,
        routingProfile,
      );
      if (response.status === 'success') {
        if (pullOutFile) {
          return writePulledRecipe(
            pullOutFile,
            response.data,
            buildPullOrigin(response.data, routingProfile, effectiveArgs),
          );
        }
        if (lcapOutFile) return writeLcapOutFile(lcapOutFile, response.data);
        // Single return path for a routed tool response: spill a large result
        // to disk first (the context block is kept out of the file), then stamp
        // the profile into the context block (only this side knows the name).
        return stampContextBlock(applyAutoFile(name, autoFilePlan, response.data), routingProfile);
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Error calling tool: ${response.error}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error calling tool: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  };

  const listTools = async () => {
    const dynamicTools = await listDynamicFlowTools(session?.profile ?? null);
    return {
      tools: withOutFileToolSchemas(
        withProfileRoutingToolSchemas([...TOOL_SCHEMAS, ...dynamicTools]),
      ),
    };
  };

  return { listTools, handleToolCall };
}
