import { CORE_TOOL_NAMES } from '../../tools';

/**
 * The 1.x names of the four core profile/bridge tools, which carried the
 * workato_ prefix until 2.0. Skills, CLAUDE.md files and permission lists
 * still name them, so they keep working until 3.0 while this module is on:
 * listed with the schema of the tool they now name, routed to it.
 */
export const WORKATO_TOOL_ALIASES: Readonly<Record<string, string>> = {
  workato_list_profiles: CORE_TOOL_NAMES.BRIDGE.LIST_PROFILES,
  workato_switch_profile: CORE_TOOL_NAMES.BRIDGE.SWITCH_PROFILE,
  workato_bridge_info: CORE_TOOL_NAMES.BRIDGE.BRIDGE_INFO,
  workato_reload_extension: CORE_TOOL_NAMES.BRIDGE.RELOAD_EXTENSION,
};
