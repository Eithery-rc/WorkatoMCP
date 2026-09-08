/**
 * @fileoverview workato_properties: the pure helpers, and the one in-page
 * function that talks to /account_properties.json.
 *
 * The endpoint is documented in
 * docs/design/specs/2026-09-08-account-project-properties-endpoints.md. Two
 * of its behaviours are what these tests exist for: a validation failure comes
 * back as HTTP 200 with an error envelope, and an update requires
 * last_version_no and then issues a NEW id.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decideUpsert,
  filterPropertiesByName,
  isDuplicateNameError,
  isStaleRowError,
  maskPropertyValue,
  parseErrorEnvelope,
  propertiesInPage,
  resolvePropertyByName,
  shapeProperty,
  type PropertyRecord,
} from '@/entrypoints/background/tools/workato/properties';

function record(over: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    id: 19189098,
    name: 'mcp_probe_alpha',
    value: 'probe_value_alpha',
    version_no: '1788860207.51103',
    sensitive: false,
    ...over,
  };
}

describe('maskPropertyValue', () => {
  it('keeps only the last three characters, like the Workato UI', () => {
    expect(maskPropertyValue('sensitive_test_value_123')).toBe('XXXXXXXXXX123');
  });

  it('reveals nothing of a value three characters or shorter', () => {
    expect(maskPropertyValue('abc')).toBe('XXXXXXXXXX');
    expect(maskPropertyValue('a')).toBe('XXXXXXXXXX');
  });

  it('leaves an empty value empty rather than inventing a mask', () => {
    expect(maskPropertyValue('')).toBe('');
  });
});

describe('shapeProperty', () => {
  it('masks a sensitive value and flags it', () => {
    const shaped = shapeProperty(
      record({ name: 'mcp_probe_secret_key', value: 'sensitive_test_value_123', sensitive: true }),
      false,
    );
    expect(shaped).toEqual({
      id: 19189098,
      name: 'mcp_probe_secret_key',
      value: 'XXXXXXXXXX123',
      version_no: '1788860207.51103',
      sensitive: true,
      value_masked: true,
    });
  });

  it('returns the clear value when reveal is set', () => {
    const shaped = shapeProperty(
      record({ value: 'sensitive_test_value_123', sensitive: true }),
      true,
    );
    expect(shaped.value).toBe('sensitive_test_value_123');
    expect(shaped).not.toHaveProperty('value_masked');
  });

  it('never masks a property Workato did not flag', () => {
    const shaped = shapeProperty(record(), false);
    expect(shaped.value).toBe('probe_value_alpha');
    expect(shaped).not.toHaveProperty('value_masked');
  });
});

describe('filterPropertiesByName', () => {
  const list = [
    record({ id: 1, name: 'mcp_probe_alpha' }),
    record({ id: 2, name: 'MCP_PROBE_ALPHA_LONG' }),
    record({ id: 3, name: 'unrelated' }),
  ];

  it('returns the exact match alone when there is one', () => {
    expect(filterPropertiesByName(list, 'mcp_probe_alpha').map((p) => p.id)).toEqual([1]);
  });

  it('falls back to a case-insensitive substring match', () => {
    expect(filterPropertiesByName(list, 'probe_alpha').map((p) => p.id)).toEqual([1, 2]);
  });

  it('returns nothing when the name matches nothing', () => {
    expect(filterPropertiesByName(list, 'nope')).toEqual([]);
  });
});

describe('resolvePropertyByName', () => {
  it('finds an exact match', () => {
    const list = [record({ id: 7, name: 'mcp_probe_alpha' }), record({ id: 8, name: 'other' })];
    expect(resolvePropertyByName(list, 'mcp_probe_alpha')).toEqual({
      status: 'found',
      property: list[0],
    });
  });

  it('accepts a case-insensitive exact match when nothing matches exactly', () => {
    const list = [record({ id: 7, name: 'MCP_Probe_Alpha' })];
    expect(resolvePropertyByName(list, 'mcp_probe_alpha')).toEqual({
      status: 'found',
      property: list[0],
    });
  });

  it('refuses when two properties share the name', () => {
    const list = [record({ id: 7, name: 'dup' }), record({ id: 9, name: 'dup' })];
    const resolution = resolvePropertyByName(list, 'dup');
    expect(resolution.status).toBe('ambiguous');
    expect(resolution.status === 'ambiguous' && resolution.matches.map((p) => p.id)).toEqual([
      7, 9,
    ]);
  });

  it('reports near misses when nothing resolves', () => {
    const list = [record({ id: 7, name: 'mcp_probe_alpha' })];
    expect(resolvePropertyByName(list, 'probe')).toEqual({
      status: 'not_found',
      suggestions: ['mcp_probe_alpha'],
    });
  });
});

describe('decideUpsert', () => {
  it('creates when the name is absent', () => {
    expect(decideUpsert([record({ name: 'other' })], 'fresh')).toEqual({ action: 'create' });
  });

  it('updates with the current version_no when the name exists', () => {
    const current = record({ id: 19864989, version_no: '1788860207.51103' });
    expect(decideUpsert([current], 'mcp_probe_alpha')).toEqual({
      action: 'update',
      id: 19864989,
      last_version_no: '1788860207.51103',
      current,
    });
  });

  it('sends the caller version when expected_version_no matches', () => {
    const current = record({ version_no: '1788860207.51103' });
    const decision = decideUpsert([current], 'mcp_probe_alpha', '1788860207.51103');
    expect(decision.action === 'update' && decision.last_version_no).toBe('1788860207.51103');
  });

  it('refuses before writing when expected_version_no is stale', () => {
    const current = record({ version_no: '1788860285.09003' });
    const decision = decideUpsert([current], 'mcp_probe_alpha', '1788860207.51103');
    expect(decision.action).toBe('conflict');
    expect(decision.action === 'conflict' && decision.reason).toBe('stale_version');
    expect(decision.action === 'conflict' && decision.message).toContain('1788860285.09003');
    expect(decision.action === 'conflict' && decision.message).toContain('1788860207.51103');
  });

  it('refuses a name that differs from an existing one only in case', () => {
    const decision = decideUpsert([record({ name: 'MCP_Probe_Alpha' })], 'mcp_probe_alpha');
    expect(decision.action).toBe('conflict');
    expect(decision.action === 'conflict' && decision.reason).toBe('case_variant');
  });
});

describe('parseErrorEnvelope', () => {
  it('reads a field error', () => {
    expect(
      parseErrorEnvelope(
        JSON.stringify({ error: { details: { name: ['has already been taken'] } } }),
      ),
    ).toBe('name has already been taken');
  });

  it('reads a base error without repeating the field name', () => {
    expect(
      parseErrorEnvelope(
        JSON.stringify({ error: { details: { base: ["can't update a stale row"] } } }),
      ),
    ).toBe("can't update a stale row");
  });

  it('joins several fields', () => {
    expect(
      parseErrorEnvelope(
        JSON.stringify({ error: { details: { name: ["can't be blank"], value: ['too long'] } } }),
      ),
    ).toBe("name can't be blank; value too long");
  });

  it('accepts a plain string error', () => {
    expect(parseErrorEnvelope(JSON.stringify({ error: 'nope' }))).toBe('nope');
  });

  it('returns null for a successful body and for unparseable text', () => {
    expect(parseErrorEnvelope(JSON.stringify({ result: [] }))).toBeNull();
    expect(parseErrorEnvelope('<html>')).toBeNull();
  });

  it('classifies the two errors the tool reports specially', () => {
    expect(isStaleRowError("can't update a stale row")).toBe(true);
    expect(isStaleRowError('name has already been taken')).toBe(false);
    expect(isDuplicateNameError('name has already been taken')).toBe(true);
    expect(isDuplicateNameError("can't update a stale row")).toBe(false);
  });
});

describe('propertiesInPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = 'XSRF-TOKEN-V2=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  function stubFetch(body: unknown, status = 200) {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => ({
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('lists account properties with no csrf and no project_id', async () => {
    const fetchMock = stubFetch({
      result: [
        {
          id: 19189098,
          name: 'Workato SFDC User ID',
          value: '005RT00000duS1ZYAU',
          version_no: '1785338089.43985',
          sensitive: false,
        },
        {
          id: 19865009,
          name: 'mcp_probe_secret_key',
          value: 'sensitive_test_value_123',
          version_no: '1788860308.41596',
          sensitive: true,
        },
      ],
    });

    const result = await propertiesInPage('list', null, null, null, null, null);

    expect(result.ok).toBe(true);
    expect(result.properties).toEqual([
      {
        id: 19189098,
        name: 'Workato SFDC User ID',
        value: '005RT00000duS1ZYAU',
        version_no: '1785338089.43985',
        sensitive: false,
      },
      {
        id: 19865009,
        name: 'mcp_probe_secret_key',
        value: 'sensitive_test_value_123',
        version_no: '1788860308.41596',
        sensitive: true,
      },
    ]);
    const [url, options] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('/account_properties.json');
    expect(options).toMatchObject({
      method: 'GET',
      credentials: 'include',
      headers: {
        accept: 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    expect(options.headers).not.toHaveProperty('x-csrf-token');
    expect(options.body).toBeUndefined();
  });

  it('scopes a list to a project with the project_id query', async () => {
    const fetchMock = stubFetch({ result: [] });

    const result = await propertiesInPage('list', 15842038, null, null, null, null);

    expect(result).toEqual({ ok: true, properties: [] });
    expect(fetchMock.mock.calls[0][0]).toBe('/account_properties.json?project_id=15842038');
  });

  it('creates a property with the account_property envelope and csrf', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = stubFetch({
      result: {
        id: 19864989,
        name: 'mcp_probe_alpha',
        value: 'probe_value_alpha',
        version_no: '1788860207.51103',
        sensitive: false,
      },
    });

    const result = await propertiesInPage(
      'create',
      null,
      null,
      'mcp_probe_alpha',
      'probe_value_alpha',
      null,
    );

    expect(result.ok).toBe(true);
    expect(result.property?.id).toBe(19864989);
    const [url, options] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('/account_properties.json');
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'x-csrf-token': 'csrf token',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    expect(JSON.parse(options.body as string)).toEqual({
      account_property: { name: 'mcp_probe_alpha', value: 'probe_value_alpha' },
    });
  });

  it('creates a project property against the project_id query', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = stubFetch({
      result: {
        id: 19865018,
        name: 'mcp_probe_proj_alpha',
        value: 'probe_proj_value_1',
        version_no: '1788860403.01203',
        sensitive: false,
      },
    });

    await propertiesInPage(
      'create',
      15842038,
      null,
      'mcp_probe_proj_alpha',
      'probe_proj_value_1',
      null,
    );

    expect(fetchMock.mock.calls[0][0]).toBe('/account_properties.json?project_id=15842038');
  });

  it('updates by id and sends last_version_no', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = stubFetch({
      result: {
        id: 19864997,
        name: 'mcp_probe_beta',
        value: 'probe_value_alpha_updated',
        version_no: '1788860285.09003',
        sensitive: false,
      },
    });

    const result = await propertiesInPage(
      'update',
      null,
      19864989,
      'mcp_probe_beta',
      'probe_value_alpha_updated',
      '1788860207.51103',
    );

    // A successful update issues a NEW id: the caller must not reuse the old one.
    expect(result.property?.id).toBe(19864997);
    expect(result.property?.version_no).toBe('1788860285.09003');
    const [url, options] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('/account_properties/19864989.json');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body as string)).toEqual({
      account_property: {
        name: 'mcp_probe_beta',
        value: 'probe_value_alpha_updated',
        last_version_no: '1788860207.51103',
      },
    });
  });

  it('reports the HTTP-200 stale-row envelope as an error, not a success', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    stubFetch({ error: { details: { base: ["can't update a stale row"] } } }, 200);

    const result = await propertiesInPage(
      'update',
      null,
      19864989,
      'mcp_probe_beta',
      'v',
      '1788860207.51103',
    );

    expect(result.ok).toBe(false);
    expect(result.api_error).toBe("can't update a stale row");
    expect(result.failure?.stage).toBe('api');
    expect(result.failure?.status).toBe(200);
    expect(isStaleRowError(result.api_error as string)).toBe(true);
  });

  it('reports the duplicate-name envelope on create', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    stubFetch({ error: { details: { name: ['has already been taken'] } } }, 200);

    const result = await propertiesInPage('create', null, null, 'mcp_probe_alpha', 'v', null);

    expect(result.ok).toBe(false);
    expect(result.api_error).toBe('name has already been taken');
    expect(isDuplicateNameError(result.api_error as string)).toBe(true);
  });

  it('deletes by id with csrf and no body', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = stubFetch({
      result: {
        id: 19865021,
        name: 'mcp_probe_proj_alpha',
        value: 'probe_proj_value_1_updated',
        version_no: '1788860429.25835',
        sensitive: false,
      },
    });

    const result = await propertiesInPage('delete', 15842038, 19865021, null, null, null);

    expect(result.property?.name).toBe('mcp_probe_proj_alpha');
    const [url, options] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('/account_properties/19865021.json?project_id=15842038');
    expect(options.method).toBe('DELETE');
    expect(options.body).toBeUndefined();
    expect(options.headers).toMatchObject({
      'x-csrf-token': 'csrf token',
      'x-requested-with': 'XMLHttpRequest',
    });
    expect(options.headers).not.toHaveProperty('content-type');
  });

  it('refuses a write when no CSRF token is available', async () => {
    const fetchMock = stubFetch({ result: {} });

    const result = await propertiesInPage('create', null, null, 'n', 'v', null);

    expect(result.ok).toBe(false);
    expect(result.failure?.stage).toBe('csrf');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a non-2xx status with the body excerpt', async () => {
    stubFetch('<html>login</html>', 401);

    const result = await propertiesInPage('list', null, null, null, null, null);

    expect(result.ok).toBe(false);
    expect(result.failure?.stage).toBe('fetch');
    expect(result.failure?.status).toBe(401);
    expect(result.failure?.body_excerpt).toContain('login');
  });
});
