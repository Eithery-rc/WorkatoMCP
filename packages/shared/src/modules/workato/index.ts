import type { ToolModule } from '../../module';
import { WORKATO_INSTRUCTIONS } from './instructions';
import { WORKATO_TOOL_SCHEMAS } from './schemas';

export { WORKATO_TOOL_NAMES } from './tool-names';
export { WORKATO_TOOL_SCHEMAS } from './schemas';
export { WORKATO_INSTRUCTIONS } from './instructions';

export const WORKATO_MODULE: ToolModule = {
  id: 'workato',
  title: 'Workato',
  tools: WORKATO_TOOL_SCHEMAS,
  instructions: WORKATO_INSTRUCTIONS,
};
