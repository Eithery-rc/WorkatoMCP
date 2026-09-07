import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchRecipeConnectionsInPage,
  projectRecipeConnections,
  summarizeRecipeConnections,
  type RecipeConnectionsRaw,
} from '@/entrypoints/background/tools/workato/recipe-connections';

/**
 * Fixtures mirror live captures from 2026-09-07:
 *   GET /recipes/<id>.json          -> result.recipe_data.flow.config (JSON string)
 *   GET /connections/<id>.json      -> {result:{...}} with the health fields and an input bag
 *   GET /integrations/meta?name=a,b -> per adapter {config:{required}}
 */
const HEALTHY_CONNECTION = {
  id: 19092754,
  name: 'Salesforce',
  provider: 'salesforce',
  authorization_status: 'success',
  authorization_error: null,
  authorized_at: '2026-08-24T06:24:48.631-07:00',
  connection_lost_at: null,
  connection_lost_reason: null,
  warning: null,
  recipe_count: 22,
  running_recipe_count: 4,
  identity: 'jonathan.warren@example.com.pffull',
  url: 'https://user:pass@example.my.salesforce.com',
  input: {
    auth_type: 'oauth2',
    client_id: 'AAAA1111',
    client_secret: 'shhh',
    refresh_token:
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  },
};

const LOST_CONNECTION = {
  id: 1236,
  name: 'Salesforce sandbox',
  provider: 'salesforce',
  authorization_status: 'connection_lost',
  authorization_error: 'expired access/refresh token',
  authorized_at: '2026-05-02T10:00:00.000-07:00',
  connection_lost_at: '2026-09-01T04:12:00.000-07:00',
  connection_lost_reason: 'Session expired or invalid',
  warning: null,
  recipe_count: 3,
  running_recipe_count: 0,
  input: { password: 'nope' },
};

function rawFixture(): RecipeConnectionsRaw {
  return {
    ok: true,
    recipe: {
      recipe_id: 72272208,
      name: 'Milestone Test',
      state: 'stopped',
      running: false,
      version_no: 7,
    },
    entries: [
      { provider: 'salesforce', name: 'salesforce', account_id: 19092754, skip_validation: false },
      { provider: 'netsuite', name: 'netsuite', account_id: 1236, skip_validation: false },
      { provider: 'slack', name: 'slack', account_id: null, skip_validation: false },
      { provider: 'logger', name: 'logger', account_id: null, skip_validation: false },
      { provider: 'sftp', name: 'sftp', account_id: 999999, skip_validation: false },
    ],
    connections: {
      '19092754': HEALTHY_CONNECTION,
      '1236': LOST_CONNECTION,
    },
    connection_errors: {
      '999999':
        'GET /connections/999999.json returned HTTP 404 (connection not found in this workspace/environment)',
    },
    meta_required: { slack: true, logger: false },
  };
}

describe('projectRecipeConnections', () => {
  it('classifies every binding a recipe can have', () => {
    const payload = projectRecipeConnections(rawFixture());
    const byProvider = Object.fromEntries(payload.connections.map((c) => [c.provider, c]));

    expect(byProvider.salesforce.status).toBe('ok');
    expect(byProvider.salesforce.connection_name).toBe('Salesforce');
    expect(byProvider.salesforce.running_recipe_count).toBe(4);

    expect(byProvider.netsuite.status).toBe('lost');
    expect(byProvider.netsuite.authorization_error).toBe('expired access/refresh token');
    expect(byProvider.netsuite.connection_lost_reason).toBe('Session expired or invalid');

    expect(byProvider.slack.status).toBe('missing');
    expect(byProvider.slack.connection_id).toBeNull();

    expect(byProvider.logger.status).toBe('not_required');

    expect(byProvider.sftp.status).toBe('missing');
    expect(byProvider.sftp.connection_id).toBe(999999);
    expect(byProvider.sftp.error).toContain('404');
  });

  it('reports the recipe verdict with actions that name the connection by id', () => {
    const payload = projectRecipeConnections(rawFixture());

    expect(payload.healthy).toBe(false);
    expect(payload.blocking.map((b) => b.provider).sort()).toEqual(['netsuite', 'sftp', 'slack']);

    const reAuth = payload.actions.find((a) => a.startsWith('Re-authorize'));
    expect(reAuth).toContain('connection 1236');
    expect(reAuth).toContain('Salesforce sandbox');
    expect(reAuth).toContain('do not ask for a new one');

    const askFor = payload.actions.find((a) => a.startsWith('Provider slack'));
    expect(askFor).toContain('cannot create a connection');
    expect(askFor).toContain('adapter slack');
  });

  it('is healthy when every binding is usable', () => {
    const raw = rawFixture();
    raw.entries = [
      { provider: 'salesforce', name: 'salesforce', account_id: 19092754 },
      { provider: 'logger', name: 'logger', account_id: null },
    ];
    const payload = projectRecipeConnections(raw);
    expect(payload.healthy).toBe(true);
    expect(payload.blocking).toEqual([]);
    expect(payload.actions).toEqual([]);
  });

  it('never returns credentials or the provider input bag', () => {
    const payload = projectRecipeConnections(rawFixture());
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain('client_secret');
    expect(serialized).not.toContain('refresh_token');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('shhh');
    expect(serialized).not.toContain('salesforce.com');
    for (const entry of payload.connections) {
      expect(entry).not.toHaveProperty('input');
      expect(entry).not.toHaveProperty('identity');
      expect(entry).not.toHaveProperty('url');
    }
  });

  it('says so when connection_required could not be read', () => {
    const raw = rawFixture();
    raw.entries = [{ provider: 'mystery', name: 'mystery', account_id: null }];
    raw.meta_required = { mystery: null };
    raw.meta_error = 'GET /integrations/meta returned HTTP 500';

    const payload = projectRecipeConnections(raw);
    expect(payload.connections[0].status).toBe('unknown');
    expect(payload.healthy).toBe(false);
    expect(payload.meta_error).toBe('GET /integrations/meta returned HTTP 500');
    expect(payload.actions[0]).toContain('Could not determine the health');
  });

  it('summarizes to a compact shape for other tools', () => {
    const summary = summarizeRecipeConnections(projectRecipeConnections(rawFixture()));
    expect(summary.healthy).toBe(false);
    expect(summary.connections[0]).toEqual({
      provider: 'salesforce',
      connection_id: 19092754,
      connection_name: 'Salesforce',
      status: 'ok',
    });
    expect(JSON.stringify(summary)).not.toContain('authorized_at');
  });
});

describe('fetchRecipeConnectionsInPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubFetch(config: unknown) {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith('/recipes/')) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              result: {
                recipe_data: {
                  state: 'stopped',
                  running: false,
                  flow: { name: 'Milestone Test', version_no: 7, config },
                },
              },
            }),
        };
      }
      if (url === '/connections/19092754.json') {
        return { status: 200, text: async () => JSON.stringify({ result: HEALTHY_CONNECTION }) };
      }
      if (url.startsWith('/integrations/meta')) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              logger: { config: { required: false } },
              slack: { config: { required: true } },
            }),
        };
      }
      return { status: 404, text: async () => 'not found' };
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
  }

  const CONFIG = [
    {
      keyword: 'application',
      name: 'salesforce',
      provider: 'salesforce',
      skip_validation: false,
      account_id: 19092754,
    },
    { keyword: 'application', name: 'logger', provider: 'logger', skip_validation: false },
    { keyword: 'application', name: 'slack', provider: 'slack', skip_validation: false },
  ];

  it('reads config as a JSON string, then each connection and meta once', async () => {
    const calls = stubFetch(JSON.stringify(CONFIG));

    const raw = await fetchRecipeConnectionsInPage(72272208);

    expect(raw.ok).toBe(true);
    expect(raw.entries).toEqual([
      { provider: 'salesforce', name: 'salesforce', account_id: 19092754, skip_validation: false },
      { provider: 'logger', name: 'logger', account_id: null, skip_validation: false },
      { provider: 'slack', name: 'slack', account_id: null, skip_validation: false },
    ]);
    expect(raw.connections?.['19092754']).toMatchObject({ id: 19092754 });
    expect(raw.meta_required).toEqual({ logger: false, slack: true });
    expect(calls).toEqual([
      '/recipes/72272208.json',
      '/connections/19092754.json',
      '/integrations/meta?name=logger%2Cslack&cacheKey=x',
    ]);
  });

  it('accepts config already parsed as an array', async () => {
    stubFetch(CONFIG);
    const raw = await fetchRecipeConnectionsInPage(72272208);
    expect(raw.entries?.length).toBe(3);
    expect(raw.config_parse_error).toBeUndefined();
  });

  it('records a failed connection read instead of dropping the binding', async () => {
    stubFetch(
      JSON.stringify([
        { keyword: 'application', name: 'sftp', provider: 'sftp', account_id: 999999 },
      ]),
    );

    const raw = await fetchRecipeConnectionsInPage(72272208);

    expect(raw.entries).toEqual([{ provider: 'sftp', name: 'sftp', account_id: 999999 }]);
    expect(raw.connections).toEqual({});
    expect(raw.connection_errors?.['999999']).toContain('HTTP 404');
    expect(projectRecipeConnections(raw).connections[0].status).toBe('missing');
  });

  it('fails cleanly when the recipe read fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 403, text: async () => 'forbidden' })),
    );
    const raw = await fetchRecipeConnectionsInPage(1);
    expect(raw.ok).toBe(false);
    expect(raw.failure?.status).toBe(403);
  });
});
