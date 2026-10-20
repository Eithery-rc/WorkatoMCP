import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { INSTALLED_MODULES } from '../modules';
import type { BridgeModule } from './module-api';
import { moduleSwitch, type ModuleSwitch } from './module-switch';
import { setupTools } from './register-tools';
import { buildServerInstructions, SERVER_NAME, serverVersion } from './server-identity';

/** Every MCP server with a session open, so a module switch can reach them all. */
const liveServers = new Set<Server>();

export interface McpServerOptions {
  modules?: readonly BridgeModule[];
  switch?: ModuleSwitch;
}

/**
 * Build a fresh MCP Server per transport/session.
 *
 * Upstream cached a single module-level Server and reused it for every HTTP
 * MCP session. The MCP SDK's Server only allows ONE transport attached at a
 * time, so the second concurrent client received HTTP 500
 * "Already connected to a transport." Using a factory per session removes
 * that limitation; `setupTools` is stateless registration so the per-call
 * cost is negligible.
 *
 * The instructions reflect the modules that are on when the session starts;
 * the tool list is read per tools/list, and a switch change sends
 * notifications/tools/list_changed to every live session.
 */
export const createMcpServer = (options: McpServerOptions = {}): Server => {
  const modules = options.modules ?? INSTALLED_MODULES;
  const switches = options.switch ?? moduleSwitch;
  const server = new Server(
    {
      name: SERVER_NAME,
      version: serverVersion(),
    },
    {
      capabilities: {
        tools: { listChanged: true },
      },
      instructions: buildServerInstructions(modules, (id) => switches.isEnabled(id)),
    },
  );

  setupTools(server, { modules, switch: switches });
  // Registered once the client finished initializing: before that there is
  // no session to tell, and a transport that never initializes (a failed
  // handshake) would otherwise stay in the set for good.
  const previousOnInitialized = server.oninitialized;
  server.oninitialized = () => {
    liveServers.add(server);
    previousOnInitialized?.();
  };
  const previousOnClose = server.onclose;
  server.onclose = () => {
    liveServers.delete(server);
    previousOnClose?.();
  };
  return server;
};

/** Sessions currently registered for list_changed (test seam and diagnostics). */
export function liveMcpServerCount(): number {
  return liveServers.size;
}

/**
 * Tell every open session its tool list changed. Best effort: a session that
 * is mid-shutdown, or whose transport refuses the send, is skipped. Resolves
 * to how many sends the transports accepted. That is not a count of clients
 * that heard it: a streamable HTTP session with no standalone SSE stream
 * open accepts the send and drops it, and a client may ignore it. Such a
 * client sees the change on its next tools/list or in its next session.
 */
export async function notifyToolListChanged(): Promise<number> {
  const sends = [...liveServers].map((server) => server.sendToolListChanged());
  const settled = await Promise.allSettled(sends);
  return settled.filter((outcome) => outcome.status === 'fulfilled').length;
}

const wiredSwitches = new WeakSet<ModuleSwitch>();

/** Send list_changed on every change of this module switch. Idempotent per switch. */
export function wireToolListChanged(switches: ModuleSwitch = moduleSwitch): void {
  if (wiredSwitches.has(switches)) return;
  wiredSwitches.add(switches);
  switches.onChange(() => {
    void notifyToolListChanged();
  });
}
