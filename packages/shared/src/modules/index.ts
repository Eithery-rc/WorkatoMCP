/**
 * Installed modules, and the full catalogue assembled from core plus every
 * module.
 *
 * This is the one place outside a module folder that knows the modules. The
 * bridge and the extension list and switch them through MODULES; TOOL_NAMES
 * and TOOL_SCHEMAS keep their pre-module contents (every tool, whatever is
 * switched on) for the consumers that want the whole catalogue.
 */
import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolModule } from '../module';
import { CORE_TOOL_NAMES, CORE_TOOL_SCHEMAS } from '../tools';
import { WORKATO_MODULE, WORKATO_TOOL_NAMES } from './workato';

export {
  WORKATO_MODULE,
  WORKATO_TOOL_NAMES,
  WORKATO_TOOL_SCHEMAS,
  WORKATO_INSTRUCTIONS,
} from './workato';

/** Every installed module, in listing order. */
export const MODULES: readonly ToolModule[] = [WORKATO_MODULE];

/**
 * Every tool name, grouped as before the module split. WORKATO still holds the
 * four core profile/bridge tools (CORE_TOOL_NAMES.BRIDGE) so existing lookups
 * keep working.
 */
export const TOOL_NAMES = {
  BROWSER: CORE_TOOL_NAMES.BROWSER,
  WORKATO: { ...WORKATO_TOOL_NAMES.WORKATO, ...CORE_TOOL_NAMES.BRIDGE },
  WORKATO_UI: WORKATO_TOOL_NAMES.WORKATO_UI,
  WORKATO_RECIPE: WORKATO_TOOL_NAMES.WORKATO_RECIPE,
  WORKATO_LCAP: WORKATO_TOOL_NAMES.WORKATO_LCAP,
  WORKATO_LOOKUP: WORKATO_TOOL_NAMES.WORKATO_LOOKUP,
  WORKATO_DATA_TABLE: WORKATO_TOOL_NAMES.WORKATO_DATA_TABLE,
  WORKATO_SESSION: WORKATO_TOOL_NAMES.WORKATO_SESSION,
};

/** Every tool schema: core first, then each module's. */
export const TOOL_SCHEMAS: Tool[] = [...CORE_TOOL_SCHEMAS, ...MODULES.flatMap((m) => m.tools)];

const OWNER = new Map<string, ToolModule>();
for (const module of MODULES) {
  for (const tool of module.tools) OWNER.set(tool.name, module);
}

/** The installed module a tool belongs to, or undefined for a core (or unknown) tool. */
export function moduleOfTool(name: string): ToolModule | undefined {
  return OWNER.get(name);
}
