export const COMMAND_NAME = 'workatomcp-bridge';

/**
 * Extension IDs allowed to connect to this native host.
 * First entry is the WorkatoMCP unpacked-load ID for this dev box; second is the
 * upstream published ID kept for compatibility with older installs.
 * The `register` script writes ALL of these into the manifest's `allowed_origins`.
 */
export const EXTENSION_IDS = [
  'plnjlpaeelbcbhahjhenjifeceodoikl',
  'hbdgbgagpkpjffpklnamcljpakneikee',
];

/** @deprecated Use EXTENSION_IDS (array). Kept so older import sites still resolve. */
export const EXTENSION_ID = EXTENSION_IDS[0];

export const HOST_NAME = 'com.chromemcp.nativehost';
export const DESCRIPTION = 'WorkatoMCP native messaging host (Chrome ↔ MCP bridge)';
