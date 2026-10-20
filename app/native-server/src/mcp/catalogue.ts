/**
 * The tool catalogue as core sees it: the core schemas plus what the
 * installed modules bring, through the module registry. Core code uses this
 * instead of the shared aggregate TOOL_SCHEMAS (the boundary test refuses
 * that import), so every list of tools in core is the list the router serves.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CORE_TOOL_SCHEMAS } from 'workatomcp-shared';
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
