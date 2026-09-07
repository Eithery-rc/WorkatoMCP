/**
 * What this MCP server calls itself, and how it tells a client to pick a tool.
 *
 * The handshake used to say `ChromeMcpServer 1.0.0`, which matched no release
 * of anything, and it passed no `instructions`, so a client with lazy tool
 * discovery saw ~120 tool NAMES and no guidance about which one answers which
 * question. Both are fixed here, in one place shared by the HTTP and stdio
 * servers.
 */

import {
  readPackageVersion,
  bridgePackageCandidates,
  UNKNOWN_VERSION,
} from './workato-bridge-info';

export const SERVER_NAME = 'WorkatoMCP';

/**
 * Concise task-to-tool guidance, sent once at initialize.
 *
 * Documented limit is 2 KB; this is deliberately kept under 1500 bytes so it
 * survives a client that budgets instructions alongside tool descriptions. It
 * names tools only, never repeats their parameters: the schema is the
 * documentation, and duplicating it here is how the two drift apart.
 */
export const SERVER_INSTRUCTIONS = [
  'Workato tools driving a logged-in browser session. Pick by task:',
  'one field to change -> workato_recipe_set_input_path;',
  'several edits or any structural change -> workato_recipe_apply (one version, not five);',
  'find a field or a value inside a recipe -> workato_recipe_grep, then read the path it reports;',
  'inspect a job -> workato_job_trace with paths and empty, not the whole trace;',
  'find jobs -> workato_list_jobs with started_from/started_to or match, never page walking;',
  'find who calls a recipe -> workato_recipe_callers;',
  'check a recipe can still authenticate before you start it -> workato_recipe_connections;',
  'check what a change would break -> workato_recipe_validate;',
  'a save that stops and restarts callers -> workato_recipe_save_with_dependents,',
  'then workato_operation_status if the call times out;',
  'run a fixture through a recipe -> workato_test_recipe;',
  'confirm which workspace a call will land in -> workato_session_context;',
  'confirm which build is answering -> workato_bridge_info.',
  'Large results spill to a file automatically (auto_file) and come back as a summary;',
  'pass out_file for a path of your own, or auto_file:false to force the result inline.',
  'Writes are gated: a tool that can change data says so in its description and needs its',
  'own flag. Read the description before the first call to a tool; it carries the',
  'constraints that make the call succeed.',
].join(' ');

/** The bridge version, read once from the package.json that ships with dist. */
export function serverVersion(): string {
  const read = readPackageVersion(bridgePackageCandidates());
  return read.version === UNKNOWN_VERSION ? '0.0.0-unknown' : read.version;
}
