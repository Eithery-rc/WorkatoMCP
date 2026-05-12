import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { setupTools } from './register-tools';

/**
 * Build a fresh MCP Server per transport/session.
 *
 * Upstream cached a single module-level Server and reused it for every HTTP
 * MCP session. The MCP SDK's Server only allows ONE transport attached at a
 * time, so the second concurrent client received HTTP 500
 * "Already connected to a transport." Using a factory per session removes
 * that limitation; `setupTools` is stateless registration so the per-call
 * cost is negligible.
 */
export const createMcpServer = (): Server => {
  const server = new Server(
    {
      name: 'ChromeMcpServer',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  setupTools(server);
  return server;
};
