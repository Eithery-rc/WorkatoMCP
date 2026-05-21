/**
 * HTTP Server - Core server implementation.
 *
 * Author: Roman Chikalenko
 * Version: 1.3.2
 *
 * Responsibilities:
 * - Fastify instance management
 * - Plugin registration (CORS, etc.)
 * - Route delegation to specialized modules
 * - MCP transport handling
 * - Server lifecycle management
 */
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import {
  NATIVE_SERVER_PORT,
  TIMEOUTS,
  SERVER_CONFIG,
  HTTP_STATUS,
  ERROR_MESSAGES,
} from '../constant';
import { NativeMessagingHost } from '../native-messaging-host';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../mcp/mcp-server';

// ============================================================
// Types
// ============================================================

interface ExtensionRequestPayload {
  data?: unknown;
}

// ============================================================
// Server Class
// ============================================================

export class Server {
  private fastify: FastifyInstance;
  public isRunning = false;
  private nativeHost: NativeMessagingHost | null = null;
  private transportsMap: Map<string, StreamableHTTPServerTransport | SSEServerTransport> =
    new Map();

  constructor() {
    this.fastify = Fastify({ logger: SERVER_CONFIG.LOGGER_ENABLED });
    this.setupPlugins();
    this.setupRoutes();
  }

  /**
   * Associate NativeMessagingHost instance.
   */
  public setNativeHost(nativeHost: NativeMessagingHost): void {
    this.nativeHost = nativeHost;
  }

  private async setupPlugins(): Promise<void> {
    await this.fastify.register(cors, {
      origin: (origin, cb) => {
        // Allow requests with no origin (e.g., curl, server-to-server)
        if (!origin) {
          return cb(null, true);
        }
        // Check if origin matches any pattern in whitelist
        const allowed = SERVER_CONFIG.CORS_ORIGIN.some((pattern) =>
          pattern instanceof RegExp ? pattern.test(origin) : origin.startsWith(pattern),
        );
        cb(null, allowed);
      },
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      credentials: true,
    });
  }

  private setupRoutes(): void {
    // Health check
    this.setupHealthRoutes();

    // Extension communication
    this.setupExtensionRoutes();

    // File-read endpoint (bridge has Node.js filesystem access)
    this.setupFileRoutes();

    // MCP routes
    this.setupMcpRoutes();
  }

  // ============================================================
  // File Routes — let the extension stream local files via the
  // bridge so file contents never have to live in agent context.
  // Loopback-only by design (bridge binds 127.0.0.1).
  // ============================================================

  private setupFileRoutes(): void {
    this.fastify.get(
      '/file',
      async (request: FastifyRequest<{ Querystring: { path?: string } }>, reply: FastifyReply) => {
        const filePath = request.query?.path;
        if (typeof filePath !== 'string' || filePath.length === 0) {
          reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: 'missing required query param: path' });
          return;
        }
        try {
          // Lazy require so we don't pay startup cost when /file is unused.
          const fs = await import('node:fs/promises');
          const path = await import('node:path');
          const resolved = path.resolve(filePath);
          const stat = await fs.stat(resolved);
          if (!stat.isFile()) {
            reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: 'path is not a file' });
            return;
          }
          const ext = path.extname(resolved).toLowerCase();
          const contentType =
            ext === '.csv'
              ? 'text/csv; charset=utf-8'
              : ext === '.json'
                ? 'application/json; charset=utf-8'
                : ext === '.txt'
                  ? 'text/plain; charset=utf-8'
                  : 'application/octet-stream';
          const buf = await fs.readFile(resolved);
          reply
            .code(HTTP_STATUS.OK)
            .header('content-type', contentType)
            .header('content-length', String(buf.byteLength))
            .header('x-file-path', resolved)
            .send(buf);
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e?.code === 'ENOENT') {
            reply.code(404).send({ error: 'file not found', path: filePath });
          } else if (e?.code === 'EACCES' || e?.code === 'EPERM') {
            reply.code(403).send({ error: 'permission denied', path: filePath });
          } else {
            reply
              .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
              .send({ error: `failed to read file: ${e?.message ?? String(err)}` });
          }
        }
      },
    );
  }

  // ============================================================
  // Health Routes
  // ============================================================

  private setupHealthRoutes(): void {
    this.fastify.get('/ping', async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        message: 'pong',
      });
    });
  }

  // ============================================================
  // Extension Routes
  // ============================================================

  private setupExtensionRoutes(): void {
    this.fastify.get(
      '/ask-extension',
      async (request: FastifyRequest<{ Body: ExtensionRequestPayload }>, reply: FastifyReply) => {
        if (!this.nativeHost) {
          return reply
            .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.NATIVE_HOST_NOT_AVAILABLE });
        }
        if (!this.isRunning) {
          return reply
            .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.SERVER_NOT_RUNNING });
        }

        try {
          const extensionResponse = await this.nativeHost.sendRequestToExtensionAndWait(
            request.query,
            'process_data',
            TIMEOUTS.EXTENSION_REQUEST_TIMEOUT,
          );
          return reply.status(HTTP_STATUS.OK).send({ status: 'success', data: extensionResponse });
        } catch (error: unknown) {
          const err = error as Error;
          if (err.message.includes('timed out')) {
            return reply
              .status(HTTP_STATUS.GATEWAY_TIMEOUT)
              .send({ status: 'error', message: ERROR_MESSAGES.REQUEST_TIMEOUT });
          } else {
            return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
              status: 'error',
              message: `Failed to get response from extension: ${err.message}`,
            });
          }
        }
      },
    );
  }

  // ============================================================
  // MCP Routes
  // ============================================================

  private setupMcpRoutes(): void {
    // SSE endpoint
    this.fastify.get('/sse', async (_, reply) => {
      reply.hijack();
      try {
        const transport = new SSEServerTransport('/messages', reply.raw);
        this.transportsMap.set(transport.sessionId, transport);

        reply.raw.on('close', () => {
          this.transportsMap.delete(transport.sessionId);
        });

        const server = createMcpServer();
        await server.connect(transport);
      } catch (error) {
        if (!reply.raw.writableEnded) {
          reply.raw.writeHead(HTTP_STATUS.INTERNAL_SERVER_ERROR, {
            'Content-Type': 'application/json',
          });
          reply.raw.end(JSON.stringify({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR }));
        }
      }
    });

    // SSE messages endpoint
    this.fastify.post('/messages', async (req, reply) => {
      try {
        const { sessionId } = req.query as { sessionId?: string };
        const transport = this.transportsMap.get(sessionId || '') as SSEServerTransport;
        if (!sessionId || !transport) {
          reply.code(HTTP_STATUS.BAD_REQUEST).send('No transport found for sessionId');
          return;
        }

        await transport.handlePostMessage(req.raw, reply.raw, req.body);
      } catch (error) {
        if (!reply.sent) {
          reply.code(HTTP_STATUS.INTERNAL_SERVER_ERROR).send(ERROR_MESSAGES.INTERNAL_SERVER_ERROR);
        }
      }
    });

    // MCP POST endpoint
    this.fastify.post('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined = this.transportsMap.get(
        sessionId || '',
      ) as StreamableHTTPServerTransport;

      if (transport) {
        // Transport found, proceed
      } else if (!sessionId && isInitializeRequest(request.body)) {
        const newSessionId = randomUUID();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
          onsessioninitialized: (initializedSessionId) => {
            if (transport && initializedSessionId === newSessionId) {
              this.transportsMap.set(initializedSessionId, transport);
            }
          },
        });

        transport.onclose = () => {
          if (transport?.sessionId && this.transportsMap.get(transport.sessionId)) {
            this.transportsMap.delete(transport.sessionId);
          }
        };
        await createMcpServer().connect(transport);
      } else {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_MCP_REQUEST });
        return;
      }

      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        if (!reply.sent) {
          reply
            .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.MCP_REQUEST_PROCESSING_ERROR });
        }
      }
    });

    // MCP GET endpoint (SSE stream)
    this.fastify.get('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      const transport = sessionId
        ? (this.transportsMap.get(sessionId) as StreamableHTTPServerTransport)
        : undefined;

      if (!transport) {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_SSE_SESSION });
        return;
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders();

      try {
        await transport.handleRequest(request.raw, reply.raw);
        if (!reply.sent) {
          reply.hijack();
        }
      } catch (error) {
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }

      request.socket.on('close', () => {
        request.log.info(`SSE client disconnected for session: ${sessionId}`);
      });
    });

    // MCP DELETE endpoint
    this.fastify.delete('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      const transport = sessionId
        ? (this.transportsMap.get(sessionId) as StreamableHTTPServerTransport)
        : undefined;

      if (!transport) {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_SESSION_ID });
        return;
      }

      try {
        await transport.handleRequest(request.raw, reply.raw);
        if (!reply.sent) {
          reply.code(HTTP_STATUS.NO_CONTENT).send();
        }
      } catch (error) {
        if (!reply.sent) {
          reply
            .code(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.MCP_SESSION_DELETION_ERROR });
        }
      }
    });
  }

  // ============================================================
  // Server Lifecycle
  // ============================================================

  public async start(port = NATIVE_SERVER_PORT, nativeHost: NativeMessagingHost): Promise<void> {
    if (!this.nativeHost) {
      this.nativeHost = nativeHost;
    } else if (this.nativeHost !== nativeHost) {
      this.nativeHost = nativeHost;
    }

    if (this.isRunning) {
      return;
    }

    try {
      await this.fastify.listen({ port, host: SERVER_CONFIG.HOST });

      // Set port environment variables after successful listen for Chrome MCP URL resolution
      process.env.CHROME_MCP_PORT = String(port);
      process.env.MCP_HTTP_PORT = String(port);

      this.isRunning = true;
    } catch (err) {
      this.isRunning = false;
      throw err;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.fastify.close();
      this.isRunning = false;
    } catch (err) {
      this.isRunning = false;
      throw err;
    }
  }

  public getInstance(): FastifyInstance {
    return this.fastify;
  }
}

const serverInstance = new Server();
export default serverInstance;
