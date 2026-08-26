/**
 * @fileoverview Tests for workato_apps_list's merge of the four app sources.
 *
 * Fixtures mirror the real response shapes captured from a live workspace on
 * 2026-08-26, including the detail that made this tool necessary: a custom
 * connector's technical name is a generated string nobody can guess, and only
 * published_custom_adapters.json ties it to a readable title.
 */

import { describe, expect, it } from 'vitest';

import {
  buildAppMatcher,
  mergeAppSources,
  type AppEntry,
} from '@/entrypoints/background/tools/workato/apps-list';

const CONNECTIONS = {
  result: {
    items: [
      {
        id: 1234,
        name: 'PF Salesforce',
        provider: 'salesforce',
        authorization_status: 'success',
      },
      {
        id: 1235,
        name: 'NetSuite REST v2',
        provider: 'netsuite_rest_connector_5105163_1745592003',
        authorization_status: 'success',
      },
      {
        id: 1236,
        name: 'Salesforce sandbox',
        provider: 'salesforce',
        authorization_status: 'connection_lost',
      },
      { id: 1237, name: 'no provider', authorization_status: 'success' },
    ],
  },
};

/** The whole body: nine adapter names, 177 bytes on the wire. */
const USED_ADAPTERS = {
  result: [
    'workato_workflow_task',
    'workato_recipe_function',
    'salesforce',
    'netsuite_rest_connector_5105163_1745592003',
    'py_eval',
    'logger',
    'email',
  ],
};

const CUSTOM = {
  result: [
    {
      id: 965135,
      name: 'enerflo_connector_5105163_1744901872',
      config: { title: 'Enerflo', aliases: [], triggers_count: 3, actions_count: 4 },
    },
    {
      id: 1198281,
      name: 'netsuite_rest_connector_5105163_1745592003',
      config: { title: 'NetSuite REST v2', triggers_count: 3, actions_count: 12 },
    },
  ],
};

const CERTIFIED = {
  result: [
    {
      id: 'cc-AXF46fme-nQ6Msr-CD-us-50046',
      name: 'new_connector_3_connector_32331_1635253734',
      installed: false,
      config: {
        title: 'OpenAPI',
        aliases: ['openapi', 'swagger', 'universal'],
        triggers_count: 2,
        actions_count: 7,
      },
    },
  ],
};

const byName = (apps: AppEntry[], name: string) => apps.find((a) => a.name === name);

describe('mergeAppSources', () => {
  it('merges an adapter seen in several sources into one entry', () => {
    const apps = mergeAppSources({
      connections: CONNECTIONS,
      usedAdapters: USED_ADAPTERS,
      custom: CUSTOM,
      certified: CERTIFIED,
    });
    const custom = byName(apps, 'netsuite_rest_connector_5105163_1745592003');
    // Same connector reached from three directions — one entry, not three.
    expect(custom?.source.sort()).toEqual(['connection', 'custom', 'recipes']);
    // The whole point: the unguessable name now carries a readable title.
    expect(custom?.title).toBe('NetSuite REST v2');
    expect(custom?.actions_count).toBe(12);
  });

  it('groups every connection of one adapter and keeps its authorization status', () => {
    const apps = mergeAppSources({ connections: CONNECTIONS });
    const sf = byName(apps, 'salesforce');
    expect(sf?.connections).toEqual([
      { id: 1234, name: 'PF Salesforce', status: 'success' },
      // A lost connection is still listed: it explains a step that fails at run time.
      { id: 1236, name: 'Salesforce sandbox', status: 'connection_lost' },
    ]);
  });

  it('skips a connection with no provider rather than inventing an empty app', () => {
    const apps = mergeAppSources({ connections: CONNECTIONS });
    expect(apps.every((a) => a.name.length > 0)).toBe(true);
    expect(apps).toHaveLength(2);
  });

  it('orders connected apps first, then used-in-recipes, then the rest', () => {
    const apps = mergeAppSources({
      connections: CONNECTIONS,
      usedAdapters: USED_ADAPTERS,
      custom: CUSTOM,
      certified: CERTIFIED,
    });
    const rankOf = (name: string) => apps.findIndex((a) => a.name === name);
    expect(rankOf('salesforce')).toBeLessThan(rankOf('email'));
    expect(rankOf('email')).toBeLessThan(rankOf('enerflo_connector_5105163_1744901872'));
    expect(rankOf('enerflo_connector_5105163_1744901872')).toBeLessThan(
      rankOf('new_connector_3_connector_32331_1635253734'),
    );
  });

  it('survives a source that failed or was skipped', () => {
    const apps = mergeAppSources({ connections: CONNECTIONS, usedAdapters: undefined });
    expect(apps.map((a) => a.name)).toContain('salesforce');
    expect(byName(apps, 'email')).toBeUndefined();
  });

  it('ignores a malformed source body instead of throwing', () => {
    expect(mergeAppSources({ connections: { result: 'nope' } })).toEqual([]);
    expect(mergeAppSources({ usedAdapters: { result: [1, null, ''] } })).toEqual([]);
    expect(mergeAppSources({})).toEqual([]);
  });
});

describe('buildAppMatcher', () => {
  const apps = mergeAppSources({
    connections: CONNECTIONS,
    usedAdapters: USED_ADAPTERS,
    custom: CUSTOM,
    certified: CERTIFIED,
  });

  it('matches on the technical name', () => {
    expect(apps.filter(buildAppMatcher('netsuite')).map((a) => a.name)).toEqual([
      'netsuite_rest_connector_5105163_1745592003',
    ]);
  });

  it('matches on the human title, which is how anyone actually searches', () => {
    expect(apps.filter(buildAppMatcher('enerflo')).map((a) => a.title)).toEqual(['Enerflo']);
  });

  it('matches on an alias', () => {
    // "swagger" appears nowhere in the name or title.
    expect(apps.filter(buildAppMatcher('swagger')).map((a) => a.title)).toEqual(['OpenAPI']);
  });

  it('is case-insensitive and passes everything through when empty', () => {
    expect(apps.filter(buildAppMatcher('SALESFORCE')).map((a) => a.name)).toEqual(['salesforce']);
    expect(apps.filter(buildAppMatcher('   '))).toHaveLength(apps.length);
  });
});
