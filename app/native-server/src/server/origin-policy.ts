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
 *     and /file    ids (EXTENSION_IDS, the same list the native-messaging
 *                  manifest allows)
 *     other HTTP   the same, plus `http://127.0.0.1[:port]` for local
 *     routes       debugging pages
 *   Host (every HTTP/1.1 client sends it)
 *     `127.0.0.1:<port>` or `localhost:<port>`, the port this request came
 *     in on. A DNS-rebinding page is same-origin with the bridge, so its
 *     Origin passes; its Host is its own domain, and that is refused.
 *
 * A prefix match once let `http://127.0.0.1.attacker.tld` through, and any
 * `chrome-extension://` origin, i.e. any installed extension.
 */

import { EXTENSION_IDS } from '../scripts/constant';

export const LOCAL_HTTP_HOSTS: readonly string[] = ['127.0.0.1'];

/** Host names the bridge answers to (it binds 127.0.0.1; localhost resolves there). */
export const LOCAL_HOST_NAMES: readonly string[] = ['127.0.0.1', 'localhost'];

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

/** The extension WebSocket and /file: no Origin, or this extension. */
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

/**
 * The Host header: a local name with the port the request came in on. A
 * missing header is allowed: every browser sends one, so its absence is a
 * test injection or a raw HTTP/1.0 client, not a rebinding page.
 *
 * @param port The local port of the connection, when known.
 */
export function isAllowedHost(host: string | undefined | null, port?: number | null): boolean {
  if (absent(host)) return true;
  const match = /^([^:]+)(?::(\d+))?$/.exec(host!.trim().toLowerCase());
  if (!match) return false;
  const [, name, portText] = match;
  if (!LOCAL_HOST_NAMES.includes(name)) return false;
  if (port === undefined || port === null) return true;
  return Number(portText ?? 80) === port;
}

/** Why a request is refused, or null when it may proceed. */
export function requestRefusal(request: {
  origin?: string | null;
  host?: string | null;
  port?: number | null;
}): string | null {
  if (!isAllowedHost(request.host, request.port)) return `host ${JSON.stringify(request.host)}`;
  if (!isAllowedOrigin(request.origin)) return `origin ${JSON.stringify(request.origin)}`;
  return null;
}

/** Refusals go to stderr: stdout is the native-messaging channel, and Fastify's logger is off. */
export function logRefusal(message: string): void {
  console.error(`[bridge] refused ${message}`);
}
