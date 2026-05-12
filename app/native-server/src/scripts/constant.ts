export const COMMAND_NAME = 'workatomcp-bridge';

/**
 * Extension IDs allowed to connect to this native host.
 * First entry is the deterministic WorkatoMCP ID derived from the pinned RSA public
 * key in `app/chrome-extension/wxt.config.ts` — everyone who builds from this repo
 * gets this ID. Second is upstream's Web Store ID, kept so an existing install of
 * upstream's `mcp-chrome` extension would still work against this bridge.
 * The `register` script writes ALL of these into the manifest's `allowed_origins`.
 */
export const EXTENSION_IDS = [
  'bpjpdgkeelhkijkllcmogemkmndgeana',
  'hbdgbgagpkpjffpklnamcljpakneikee',
];

/** @deprecated Use EXTENSION_IDS (array). Kept so older import sites still resolve. */
export const EXTENSION_ID = EXTENSION_IDS[0];

export const HOST_NAME = 'com.chromemcp.nativehost';
export const DESCRIPTION = 'WorkatoMCP native messaging host (Chrome ↔ MCP bridge)';
