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

  test('GET /ws-client refuses any other origin with a 403 at the upgrade, and logs it', async () => {
    const registerSpy = jest.spyOn(profileRegistry, 'register').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const upgrade = (headers: Record<string, string>) =>
      (Server.getInstance() as any).injectWS('/ws-client?profile=personal', { headers });
    try {
      for (const origin of [
        'http://127.0.0.1.attacker.tld',
        'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh',
        // Local pages may use the HTTP routes, never the profile socket.
        'http://127.0.0.1:5173',
        // Upstream's Web Store id is not ours any more.
        'chrome-extension://hbdgbgagpkpjffpklnamcljpakneikee',
      ]) {
        // Refused before the upgrade: the client gets an error, not an open socket.
        await expect(upgrade({ origin })).rejects.toThrow('Unexpected server response: 403');
      }
      expect(registerSpy).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls.map((call) => String(call[0])).join('\n')).toMatch(
        /\[bridge\] refused a \/ws-client upgrade from origin "http:\/\/127\.0\.0\.1\.attacker\.tld"/,
      );

      const ours = await upgrade({ origin: `chrome-extension://${EXTENSION_IDS[0]}` });
      ours.close();
      const noOrigin = await upgrade({});
      noOrigin.close();
      expect(registerSpy).toHaveBeenCalledTimes(2);
    } finally {
      registerSpy.mockRestore();
      errorSpy.mockRestore();
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
