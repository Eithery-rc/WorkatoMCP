import { createErrorResponse } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import * as browserTools from './browser';
import { EXTENSION_MODULES } from '../modules';
import type { ExtensionModule } from '../extension-module';
import { runExclusiveForTab } from './tab-queue';

const toolsMap = new Map<string, any>(
  Object.values(browserTools as Record<string, any>).map((tool: any) => [tool.name, tool]),
);
/** The module each module tool belongs to. */
const ownerOf = new Map<string, ExtensionModule>();
for (const module of EXTENSION_MODULES) {
  for (const executor of module.executors) {
    toolsMap.set(executor.name, executor);
    ownerOf.set(executor.name, module);
  }
}

/**
 * Tool call parameter interface
 */
export interface ToolCallParam {
  name: string;
  args: any;
}

/**
 * Handle tool execution
 */
export const handleCallTool = async (param: ToolCallParam) => {
  const tool = toolsMap.get(param.name);
  if (!tool) {
    return createErrorResponse(`Tool ${param.name} not found`);
  }
  const owner = ownerOf.get(param.name);
  const tabId = param.args?.tabId;
  // chrome_handle_dialog answers the dialog another call on this tab is blocked
  // on; queueing it behind that call would deadlock the tab.
  if (typeof tabId === 'number' && param.name !== 'chrome_handle_dialog') {
    return runExclusiveForTab(tabId, () => executeTool(tool, param, owner));
  }
  return executeTool(tool, param, owner);
};

async function executeTool(tool: any, param: ToolCallParam, owner?: ExtensionModule) {
  try {
    const result = await tool.execute(param.args);
    return owner?.afterCall ? await owner.afterCall(param.name, param.args, result) : result;
  } catch (error) {
    console.error(`Tool execution failed for ${param.name}:`, error);
    return createErrorResponse(
      error instanceof Error ? error.message : ERROR_MESSAGES.TOOL_EXECUTION_FAILED,
    );
  }
}
