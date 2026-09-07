import { createErrorResponse } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import * as browserTools from './browser';
import * as workatoTools from './workato';
import * as workatoUiTools from './workato-ui';
import * as workatoLookupTools from './workato-lookup';
import * as workatoLcapTools from './workato-lcap';
import * as workatoDataTableTools from './workato-data-table';
import * as workatoSessionTools from './workato-session';
import { flowRunTool, listPublishedFlowsTool } from './record-replay';
import { maybeAppendContextBlock } from './workato/session-context';

const tools = {
  ...browserTools,
  ...workatoTools,
  ...workatoUiTools,
  ...workatoLookupTools,
  ...workatoLcapTools,
  ...workatoDataTableTools,
  ...workatoSessionTools,
  flowRunTool,
  listPublishedFlowsTool,
} as any;
const toolsMap = new Map(Object.values(tools).map((tool: any) => [tool.name, tool]));

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

  try {
    const result = await tool.execute(param.args);
    // Say which tab/workspace the call actually ran in. Best effort: it never
    // turns a successful call into a failure (see maybeAppendContextBlock).
    return await maybeAppendContextBlock(param.name, param.args, result);
  } catch (error) {
    console.error(`Tool execution failed for ${param.name}:`, error);
    return createErrorResponse(
      error instanceof Error ? error.message : ERROR_MESSAGES.TOOL_EXECUTION_FAILED,
    );
  }
};
