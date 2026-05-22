import { describe, expect, test, afterAll, beforeAll, jest } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';
import { profileRegistry } from './profile-registry';

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
          name: 'ChromeMcpServer',
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
});
