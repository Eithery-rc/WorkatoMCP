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
import { isWorkatoFileTool, prepareWorkatoCall, writePulledRecipe } from './workato-file-io';
import {
  handleWorkatoRecipeMutatorCall,
  isWorkatoRecipeMutatorTool,
} from './workato-recipe-mutators';
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
]);

type JsonObject = Record<string, any>;

interface RoutedArgs {
  args: JsonObject;
  profile: string | null;
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

function shouldApplySessionTab(
  name: string,
  args: JsonObject,
  sessionTabId: number | null,
): boolean {
  if (sessionTabId === null) return false;
  if (!name.startsWith('workato_')) return false;
  if (PROFILE_MANAGEMENT_TOOLS.has(name)) return false;
  if (typeof args.tabId === 'number') return false;
  if (typeof args.windowId === 'number') return false;
  return true;
}

function withSessionTabTarget(
  name: string,
  args: JsonObject,
  sessionTabId: number | null,
): JsonObject {
  if (!shouldApplySessionTab(name, args, sessionTabId)) return args;
  return { ...args, tabId: sessionTabId };
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

async function sendRequestToExtension(
  messagePayload: any,
  messageType: string = 'request_data',
  timeoutMs?: number,
  profile: string | null = null,
): Promise<any> {
  if (profile) {
    requireConnectedProfile(profile);
    return await profileRegistry.sendRequest(profile, messagePayload, messageType, timeoutMs);
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
      console.warn(
        `[register-tools] Failed to send request to active profile "${activeProfile}" via WS, falling back to native host:`,
        err.message,
      );
    }
  }
  // Fallback
  return await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
    messagePayload,
    messageType,
    timeoutMs,
  );
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
  let sessionProfile: string | null = null;
  let sessionTabId: number | null = null;

  const getRoutingProfile = (callProfile: string | null): string | null =>
    callProfile || sessionProfile;

  const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
    try {
      // 1. Check for Profile Management Admin Tools
      if (name === TOOL_NAMES.WORKATO.LIST_PROFILES) {
        const defaultProfile = profileRegistry.getActiveProfile();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  active_profile: sessionProfile || defaultProfile,
                  session_profile: sessionProfile,
                  session_tab_id: sessionTabId,
                  server_default_profile: defaultProfile,
                  connected_profiles: profileRegistry.getConnectedProfiles(),
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
        const profileChanged = sessionProfile !== targetProfile;
        sessionProfile = targetProfile;
        if (nextSessionTabId !== null) {
          sessionTabId = nextSessionTabId;
        } else if (profileChanged) {
          sessionTabId = null;
        }
        return {
          content: [
            {
              type: 'text',
              text:
                `Successfully switched this MCP session to profile context: "${targetProfile}"` +
                (sessionTabId !== null ? ` and Workato tab ID: ${sessionTabId}` : ''),
            },
          ],
        };
      }

      const routed = extractRoutedArgs(args);
      const routingProfile = getRoutingProfile(routed.profile);

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
      let effectiveArgs: any = withSessionTabTarget(name, routed.args || {}, sessionTabId);
      let pullOutFile: string | undefined;
      if (isWorkatoFileTool(name)) {
        const prepared = prepareWorkatoCall(name, effectiveArgs || {});
        effectiveArgs = prepared.args;
        pullOutFile = prepared.pullOutFile;
      }

      if (isWorkatoRecipeMutatorTool(name)) {
        return handleWorkatoRecipeMutatorCall(
          name,
          effectiveArgs || {},
          async (toolName, toolArgs) => {
            const response = await sendRequestToExtension(
              {
                name: toolName,
                args: toolArgs,
              },
              NativeMessageType.CALL_TOOL,
              120000,
              routingProfile,
            );
            if (response.status === 'success') return response.data;
            return {
              content: [{ type: 'text', text: `Error calling tool: ${response.error}` }],
              isError: true,
            };
          },
        );
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
        return pullOutFile ? writePulledRecipe(pullOutFile, response.data) : response.data;
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
    const dynamicTools = await listDynamicFlowTools(sessionProfile);
    return { tools: withProfileRoutingToolSchemas([...TOOL_SCHEMAS, ...dynamicTools]) };
  };

  return { listTools, handleToolCall };
}
