/**
 * Which browser origins may talk to the bridge: the CORS check on the HTTP
 * routes (/mcp, /sse, /messages, /file) and the check on the extension's
 * WebSocket (/ws-client). One rule for both.
 *
 * The WebSocket is how a Chrome profile registers: a socket that gets through
 * under an existing profile name replaces the live one and receives every
 * tool call routed to that profile, vault fill steps included. So the check
 * compares parsed origins exactly. A prefix match let
 * `http://127.0.0.1.attacker.tld` through, and any `chrome-extension://`
 * origin, i.e. any installed extension.
 *
 * Allowed:
 *   - no Origin header: local MCP clients and CLIs, which send none;
 *   - `chrome-extension://<id>` for this extension's ids only (EXTENSION_IDS,
 *     the same list the native-messaging manifest allows);
 *   - `http://127.0.0.1[:port]`, the local host the bridge served before, for
 *     local debugging pages.
 */

import { EXTENSION_IDS } from '../scripts/constant';

export const LOCAL_HTTP_HOSTS: readonly string[] = ['127.0.0.1'];

export function isAllowedOrigin(
  origin: string | undefined | null,
  extensionIds: readonly string[] = EXTENSION_IDS,
): boolean {
  if (origin === undefined || origin === null || origin === '') return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    // Includes the literal "null" origin of sandboxed and file pages.
    return false;
  }
  if (url.protocol === 'chrome-extension:') {
    return extensionIds.includes(url.hostname) && origin === `chrome-extension://${url.hostname}`;
  }
  if (url.protocol === 'http:') {
    // url.origin drops any path or credentials; an Origin header never has
    // them, so a value that differs is not a real origin.
    return LOCAL_HTTP_HOSTS.includes(url.hostname) && origin === url.origin;
  }
  return false;
}
