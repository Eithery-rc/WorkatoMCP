import { describe, expect, test, afterAll, beforeAll, jest } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';
import { profileRegistry } from './profile-registry';
import { SERVER_NAME } from '../mcp/server-identity';
import { EXTENSION_IDS } from '../scripts/constant';

describe('server tests', () => {
  beforeAll(async () => {
    await Server.getInstance().ready();
  });

  afterAll(async () => {
    await Server.stop();
  });

  test('GET /ping should return correct response', async () => {
    const response = await supertest(Server.getInstance().server)
      .get('/ping')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({
      status: 'ok',
      message: 'pong',
    });
  });

  test('POST /mcp initialize should return a JSON-RPC response as application/json', async () => {
    const response = await supertest(Server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'codex-regression-test',
            version: '0.0.0',
          },
        },
      })
      .expect(200)
      .expect('Content-Type', /application\/json/);

    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
        },
      },
    });
    expect(response.headers['mcp-session-id']).toBeTruthy();
  });

  test('POST /mcp with an invalid session should return a JSON-RPC error', async () => {
    const response = await supertest(Server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .set('mcp-session-id', 'stale-session')
      .send({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: {
          name: 'workato_list_profiles',
          arguments: {},
        },
      })
      .expect(404)
      .expect('Content-Type', /application\/json/);

    expect(response.body).toEqual({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Session not found',
      },
      id: null,
    });
  });

  test('GET /ws-client should register the accepted WebSocket for the requested profile', async () => {
    const registerSpy = jest.spyOn(profileRegistry, 'register').mockImplementation(() => undefined);
    let ws: { close: () => void } | undefined;

    try {
      ws = await (Server.getInstance() as any).injectWS('/ws-client?profile=probe');

      expect(registerSpy).toHaveBeenCalledWith(
        'probe',
        expect.objectContaining({
          close: expect.any(Function),
          on: expect.any(Function),
          send: expect.any(Function),
        }),
      );
    } finally {
      ws?.close();
      registerSpy.mockRestore();
    }
  });

  test('GET /ws-client registers only our extension (or no origin), never a look-alike', async () => {
    const registerSpy = jest.spyOn(profileRegistry, 'register').mockImplementation(() => undefined);
    const open = async (origin: string) => {
      const ws = await (Server.getInstance() as any).injectWS('/ws-client?profile=personal', {
        headers: { origin },
      });
      // The route closes a refused socket at once; give it a tick to do so.
      await new Promise((resolve) => setTimeout(resolve, 20));
      ws.close();
    };
    try {
      await open('http://127.0.0.1.attacker.tld');
      await open('chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh');
      expect(registerSpy).not.toHaveBeenCalled();
      await open(`chrome-extension://${EXTENSION_IDS[0]}`);
      expect(registerSpy).toHaveBeenCalledTimes(1);
    } finally {
      registerSpy.mockRestore();
    }
  });

  test('CORS answers a preflight only for allowed origins', async () => {
    const preflight = (origin: string) =>
      supertest(Server.getInstance().server)
        .options('/mcp')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type');

    const local = await preflight('http://127.0.0.1:12306');
    expect(local.headers['access-control-allow-origin']).toBe('http://127.0.0.1:12306');

    const ours = await preflight(`chrome-extension://${EXTENSION_IDS[0]}`);
    expect(ours.headers['access-control-allow-origin']).toBe(
      `chrome-extension://${EXTENSION_IDS[0]}`,
    );

    for (const origin of [
      'http://127.0.0.1.attacker.tld',
      'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh',
    ]) {
      const refused = await preflight(origin);
      expect(refused.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});
