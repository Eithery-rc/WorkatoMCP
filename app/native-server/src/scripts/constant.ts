/** The command; the 1.x names (workatomcp-bridge and the upstream ones) stay bin aliases until 3.0. */
export const COMMAND_NAME = 'mokutab-bridge';

/** The npm package, for install commands (the command name is not installable). */
export const PACKAGE_NAME = '@mokuhub/mokutab-bridge';

/**
 * Extension IDs allowed to connect to this bridge: the native-messaging
 * manifest's `allowed_origins` (written by `register`), the extension
 * WebSocket and the CORS answer. Only this project's own ID, derived from the
 * RSA public key pinned in `app/chrome-extension/wxt.config.ts`, so everyone
 * who builds from this repo gets it. Upstream's Web Store ID is no longer
 * listed: the project is detached from upstream, and an id on this list can
 * register as a Chrome profile and receive its tool calls.
 */
export const EXTENSION_IDS = ['bpjpdgkeelhkijkllcmogemkmndgeana'];

/** @deprecated Use EXTENSION_IDS (array). Kept so older import sites still resolve. */
export const EXTENSION_ID = EXTENSION_IDS[0];

export const HOST_NAME = 'com.chromemcp.nativehost';
export const DESCRIPTION = 'MokuTab native messaging host (Chrome ↔ MCP bridge)';
