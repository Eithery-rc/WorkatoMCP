/**
 * Who may talk to the bridge over HTTP and the extension WebSocket.
 *
 * The WebSocket (/ws-client) is how a Chrome profile registers: a socket that
 * gets through under an existing profile name replaces the live one and
 * receives every tool call routed to that profile, vault fill steps included.
 * The HTTP routes run tools (/mcp) and read local files by path (/file). So
 * both are checked on the parsed values, exactly:
 *
 *   Origin (a browser sends it; MCP clients and CLIs send none)
 *     /ws-client   none, or `chrome-extension://<id>` for this extension's
 *                  ids (EXTENSION_IDS, the same list the native-messaging
 *                  manifest allows)
 *     HTTP routes  the same, plus `http://127.0.0.1[:port]` for local
 *                  debugging pages
 *
 * A prefix match once let `http://127.0.0.1.attacker.tld` through, and any
 * `chrome-extension://` origin, i.e. any installed extension.
 */

import { EXTENSION_IDS } from '../scripts/constant';

export const LOCAL_HTTP_HOSTS: readonly string[] = ['127.0.0.1'];

function absent(value: string | undefined | null): boolean {
  return value === undefined || value === null || value === '';
}

function parse(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    // Includes the literal "null" origin of sandboxed and file pages.
    return null;
  }
}

function isOurExtension(origin: string, url: URL, extensionIds: readonly string[]): boolean {
  return (
    url.protocol === 'chrome-extension:' &&
    extensionIds.includes(url.hostname) &&
    origin === `chrome-extension://${url.hostname}`
  );
}

/** The extension WebSocket: no Origin, or this extension. */
export function isAllowedWsOrigin(
  origin: string | undefined | null,
  extensionIds: readonly string[] = EXTENSION_IDS,
): boolean {
  if (absent(origin)) return true;
  const url = parse(origin!);
  return url !== null && isOurExtension(origin!, url, extensionIds);
}

/** The HTTP routes (and the CORS answer): the WebSocket's rule, plus local http pages. */
export function isAllowedOrigin(
  origin: string | undefined | null,
  extensionIds: readonly string[] = EXTENSION_IDS,
): boolean {
  if (absent(origin)) return true;
  const url = parse(origin!);
  if (url === null) return false;
  if (url.protocol === 'chrome-extension:') return isOurExtension(origin!, url, extensionIds);
  if (url.protocol === 'http:') {
    // url.origin is the normalized form (no path, credentials, case or
    // shorthand); a header that differs from it is not a real origin.
    return LOCAL_HTTP_HOSTS.includes(url.hostname) && origin === url.origin;
  }
  return false;
}

/** Refusals go to stderr: stdout is the native-messaging channel, and Fastify's logger is off. */
export function logRefusal(message: string): void {
  console.error(`[bridge] refused ${message}`);
}
