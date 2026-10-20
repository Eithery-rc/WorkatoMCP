/**
 * The tool catalogue as core sees it: the core schemas plus what the
 * installed modules bring, through the module registry. Core code uses this
 * instead of the shared aggregate TOOL_SCHEMAS (the boundary test refuses
 * that import), so every list of tools in core is the list the router serves.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CORE_TOOL_SCHEMAS, aliasDescription } from '@mokuhub/mokutab-shared';
import { INSTALLED_MODULES } from '../modules';
import type { BridgeModule } from './module-api';

/** The tools listed with these modules on: core first, then each module's. */
export function listedToolSchemas(modules: readonly Pick<BridgeModule, 'tools'>[]): Tool[] {
  return [...CORE_TOOL_SCHEMAS, ...modules.flatMap((module) => module.tools)];
}

/** Every tool this bridge has: core plus every installed module, on or off. */
export function installedToolSchemas(): Tool[] {
  return listedToolSchemas(INSTALLED_MODULES);
}

/**
 * `tools` followed by the aliases of these (enabled) modules. Applied last,
 * to the served list: an alias is a copy of its target as served (routing,
 * file and lease params included), so the two can never take different
 * arguments; only the name and a pointer for a description differ.
 */
export function withAliasToolSchemas(
  tools: Tool[],
  modules: readonly Pick<BridgeModule, 'aliases'>[],
): Tool[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const aliases: Tool[] = [];
  for (const module of modules) {
    for (const [alias, target] of Object.entries(module.aliases ?? {})) {
      const tool = byName.get(target);
      if (tool) aliases.push({ ...tool, name: alias, description: aliasDescription(target) });
    }
  }
  return aliases.length > 0 ? [...tools, ...aliases] : tools;
}
