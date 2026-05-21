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

async function sendRequestToActiveExtension(
  messagePayload: any,
  messageType: string = 'request_data',
  timeoutMs?: number,
): Promise<any> {
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

async function listDynamicFlowTools(): Promise<Tool[]> {
  try {
    const response = await sendRequestToActiveExtension({}, 'rr_list_published_flows', 20000);
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
      return tools;
    }
    return [];
  } catch (e) {
    return [];
  }
}

export const setupTools = (server: Server) => {
  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const dynamicTools = await listDynamicFlowTools();
    return { tools: [...TOOL_SCHEMAS, ...dynamicTools] };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name, request.params.arguments || {}),
  );
};

const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
  try {
    // 1. Check for Profile Management Admin Tools
    if (name === TOOL_NAMES.WORKATO.LIST_PROFILES) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                active_profile: profileRegistry.getActiveProfile(),
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
      const targetProfile = args.profile;
      if (!targetProfile) {
        return {
          content: [{ type: 'text', text: 'Error: target profile parameter is required.' }],
          isError: true,
        };
      }
      const success = profileRegistry.switchProfile(targetProfile);
      if (success) {
        return {
          content: [
            {
              type: 'text',
              text: `Successfully switched to active profile context: "${targetProfile}"`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Error: profile "${targetProfile}" is not connected. Connected profiles: ${JSON.stringify(
                profileRegistry.getConnectedProfiles(),
              )}`,
            },
          ],
          isError: true,
        };
      }
    }

    // 2. If calling a dynamic flow tool (name starts with flow.), proxy to common flow-run tool
    if (name && name.startsWith('flow.')) {
      // We need to resolve flow by slug to ID
      try {
        const resp = await sendRequestToActiveExtension({}, 'rr_list_published_flows', 20000);
        const items = (resp && resp.items) || [];
        const slug = name.slice('flow.'.length);
        const match = items.find((it: any) => it.slug === slug);
        if (!match) throw new Error(`Flow not found for tool ${name}`);
        const flowArgs = { flowId: match.id, args };
        const proxyRes = await sendRequestToActiveExtension(
          { name: 'record_replay_flow_run', args: flowArgs },
          NativeMessageType.CALL_TOOL,
          120000,
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
    let effectiveArgs: any = args;
    let pullOutFile: string | undefined;
    if (isWorkatoFileTool(name)) {
      const prepared = prepareWorkatoCall(name, args || {});
      effectiveArgs = prepared.args;
      pullOutFile = prepared.pullOutFile;
    }

    if (isWorkatoRecipeMutatorTool(name)) {
      return handleWorkatoRecipeMutatorCall(
        name,
        effectiveArgs || {},
        async (toolName, toolArgs) => {
          const response = await sendRequestToActiveExtension(
            {
              name: toolName,
              args: toolArgs,
            },
            NativeMessageType.CALL_TOOL,
            120000,
          );
          if (response.status === 'success') return response.data;
          return {
            content: [{ type: 'text', text: `Error calling tool: ${response.error}` }],
            isError: true,
          };
        },
      );
    }

    const response = await sendRequestToActiveExtension(
      {
        name,
        args: effectiveArgs,
      },
      NativeMessageType.CALL_TOOL,
      120000,
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
