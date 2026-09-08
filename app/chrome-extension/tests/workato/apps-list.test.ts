/**
 * @fileoverview Tests for workato_apps_list's merge of the app sources, the
 * standard-connector catalogue included.
 *
 * Fixtures mirror the real response shapes captured from a live workspace on
 * 2026-08-26 and 2026-09-08, including the detail that made this tool
 * necessary: a custom connector's technical name is a generated string nobody
 * can guess, and only published_custom_adapters.json ties it to a readable
 * title; a standard connector the workspace never connected is visible only
 * through the catalogue.
 */

import { describe, expect, it } from 'vitest';

import {
  buildAppMatcher,
  buildCategoryMatcher,
  isVisibleApp,
  mergeAppSources,
  summariseApps,
  type AppEntry,
  type CatalogueEntry,
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
    // Same connector reached from three directions: one entry, not three.
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

/**
 * Reduced in-page from window.Workato.config.providers, the catalogue every
 * app page preloads via /web_api/dynamic_app_config/<sha256>.js. Captured
 * 2026-09-08. These are the connectors a workspace has never connected, which
 * the old five-source merge could not see at all, plus the Workato tools whose
 * technical name cannot be derived from what a person calls them.
 */
const CATALOGUE: CatalogueEntry[] = [
  {
    name: 'workato_pub_sub',
    title: 'Workato Event Streams',
    aliases: ['Workato Event Streams', 'utility', 'utilities', 'pubsub', 'pub/sub', 'events'],
    categories: ['Recipe Tools', 'Workato'],
    connection_required: false,
    actions_count: 4,
    triggers_count: 2,
  },
  {
    name: 'rest',
    title: 'HTTP',
    categories: ['Developer Tool', 'API Integration'],
    connection_required: true,
    actions_count: 3,
    triggers_count: 1,
  },
  {
    name: 'email',
    title: 'Email by Workato',
    aliases: ['Email by Workato', 'utility', 'workato', 'utilities'],
    categories: ['Recipe Tools', 'Workato'],
    connection_required: false,
    actions_count: 1,
    triggers_count: 0,
  },
  {
    name: 'google_sheets',
    title: 'Google Sheets',
    aliases: ['Google Sheets', 'spreadsheets', 'spread sheet'],
    categories: ['Document/File', 'Sales Enablement'],
    connection_required: true,
    actions_count: 12,
    triggers_count: 9,
    url_name: 'google-sheets',
  },
  {
    name: 'smartsheet',
    title: 'Smartsheet',
    categories: ['Project Management'],
    connection_required: true,
    actions_count: 20,
    triggers_count: 4,
  },
  {
    name: 'salesforce',
    title: 'Salesforce',
    aliases: ['Salesforce', 'sfdc', 'apptus'],
    categories: ['CRM', 'Marketing'],
    connection_required: true,
    actions_count: 60,
    triggers_count: 36,
    deprecated_actions_count: 27,
    deprecated_triggers_count: 20,
  },
  {
    name: 'capsulecrm',
    title: 'Capsule CRM',
    categories: ['CRM'],
    connection_required: true,
    actions_count: 5,
    triggers_count: 2,
    deprecated: true,
  },
  {
    name: 'soap',
    title: 'SOAP',
    categories: ['Recipe Tools', 'Workato'],
    connection_required: false,
    actions_count: 1,
    triggers_count: 0,
    deprecated: true,
  },
];

describe('the standard-connector catalogue', () => {
  const apps = mergeAppSources({
    connections: CONNECTIONS,
    usedAdapters: USED_ADAPTERS,
    catalogue: CATALOGUE,
    custom: CUSTOM,
    certified: CERTIFIED,
  });

  it('finds Workato Event Streams by the name a person would use', () => {
    // "workato_event_streams" and "event_streams" both resolve to nothing at
    // /integrations/meta: the adapter is workato_pub_sub. Without the catalogue
    // the app is unreachable from what the user actually says.
    const hits = apps.filter(buildAppMatcher('event stream'));
    expect(hits.map((a) => a.name)).toEqual(['workato_pub_sub']);
    expect(hits[0].connection_required).toBe(false);
    expect(hits[0].source).toEqual(['builtin']);
  });

  it('finds it by alias too', () => {
    expect(apps.filter(buildAppMatcher('pub/sub')).map((a) => a.name)).toEqual(['workato_pub_sub']);
  });

  it('resolves HTTP, whose adapter name is "rest", as a standard connector', () => {
    const hits = apps.filter(buildAppMatcher('HTTP'));
    expect(hits.map((a) => a.name)).toEqual(['rest']);
    expect(hits[0].connection_required).toBe(true);
    expect(hits[0].source).toEqual(['standard']);
  });

  it('lists a standard connector this workspace never connected', () => {
    // The acceptance case from the spec: "sheet" lands on both sheet apps.
    const hits = apps.filter(buildAppMatcher('sheet'));
    expect(hits.map((a) => a.name).sort()).toEqual(['google_sheets', 'smartsheet']);
    const sheets = byName(apps, 'google_sheets');
    expect(sheets?.source).toEqual(['standard']);
    expect(sheets?.connections).toBeUndefined();
    expect(sheets?.actions_count).toBe(12);
  });

  it('matches a category substring as well', () => {
    expect(
      apps
        .filter(buildAppMatcher('crm'))
        .map((a) => a.name)
        .sort(),
    ).toEqual(['capsulecrm', 'salesforce']);
  });

  it('merges a built-in that is also used in recipes, without duplicating it', () => {
    const email = apps.filter((a) => a.name === 'email');
    expect(email).toHaveLength(1);
    expect(email[0].source.sort()).toEqual(['builtin', 'recipes']);
    expect(email[0].title).toBe('Email by Workato');
  });

  it('carries the deprecation counts a connected app has', () => {
    const sf = byName(apps, 'salesforce');
    expect(sf?.source.sort()).toEqual(['connection', 'recipes', 'standard']);
    expect(sf?.deprecated_actions_count).toBe(27);
    expect(sf?.aliases).toContain('sfdc');
  });

  it("ranks built-ins after the workspace's own apps, standard after custom, certified last", () => {
    const rankOf = (name: string) => apps.findIndex((a) => a.name === name);
    expect(rankOf('salesforce')).toBeLessThan(rankOf('workato_pub_sub'));
    expect(rankOf('workato_pub_sub')).toBeLessThan(rankOf('enerflo_connector_5105163_1744901872'));
    expect(rankOf('enerflo_connector_5105163_1744901872')).toBeLessThan(rankOf('google_sheets'));
    expect(rankOf('google_sheets')).toBeLessThan(
      rankOf('new_connector_3_connector_32331_1635253734'),
    );
  });
});

describe('buildCategoryMatcher', () => {
  const apps = mergeAppSources({ catalogue: CATALOGUE });

  it('matches one category exactly, case-insensitively', () => {
    expect(
      apps
        .filter(buildCategoryMatcher('crm'))
        .map((a) => a.name)
        .sort(),
    ).toEqual(['capsulecrm', 'salesforce']);
    // "Recipe Tools" is not matched by the substring "tools": exact only.
    expect(apps.filter(buildCategoryMatcher('tools'))).toHaveLength(0);
    expect(
      apps
        .filter(buildCategoryMatcher('Recipe Tools'))
        .map((a) => a.name)
        .sort(),
    ).toEqual(['email', 'soap', 'workato_pub_sub']);
  });
});

describe('isVisibleApp', () => {
  it('hides a deprecated catalogue entry unless asked, or unless the workspace uses it', () => {
    const apps = mergeAppSources({
      connections: CONNECTIONS,
      usedAdapters: { result: ['soap'] },
      catalogue: CATALOGUE,
    });
    const capsule = byName(apps, 'capsulecrm')!;
    const soap = byName(apps, 'soap')!;
    const sf = byName(apps, 'salesforce')!;
    expect(isVisibleApp(capsule, false)).toBe(false);
    expect(isVisibleApp(capsule, true)).toBe(true);
    // Deprecated, but a recipe here is built with it: a fact about the workspace.
    expect(isVisibleApp(soap, false)).toBe(true);
    expect(isVisibleApp(sf, false)).toBe(true);
  });
});

describe('summariseApps', () => {
  const apps = mergeAppSources({
    connections: CONNECTIONS,
    usedAdapters: USED_ADAPTERS,
    catalogue: CATALOGUE,
    custom: CUSTOM,
    certified: CERTIFIED,
  });
  const summary = summariseApps(apps, false);

  it('lists what the workspace has in full and the catalogue by the numbers', () => {
    expect(summary.connected.map((a) => a.name).sort()).toEqual([
      'netsuite_rest_connector_5105163_1745592003',
      'salesforce',
    ]);
    // A custom connector that also has a connection is under connected, not custom.
    expect(summary.custom.map((a) => a.name)).toEqual(['enerflo_connector_5105163_1744901872']);
    expect(summary.used_in_recipes).toContain('py_eval');
    // salesforce, rest, google_sheets, smartsheet visible; capsulecrm hidden.
    expect(summary.catalogue.standard).toBe(4);
    // workato_pub_sub, email visible; soap hidden.
    expect(summary.catalogue.builtin).toBe(2);
    expect(summary.catalogue.certified).toBe(1);
    expect(summary.catalogue.deprecated_hidden).toBe(2);
  });

  it('orders categories by count, largest first, counting only visible apps', () => {
    const cats = Object.entries(summary.catalogue.categories);
    expect(cats[0]).toEqual(['Recipe Tools', 2]);
    expect(summary.catalogue.categories.CRM).toBe(1);
    expect(summary.catalogue.categories['Project Management']).toBe(1);
  });

  it('counts deprecated apps in when asked', () => {
    const all = summariseApps(apps, true);
    expect(all.catalogue.deprecated_hidden).toBe(0);
    expect(all.catalogue.standard).toBe(5);
    expect(all.catalogue.categories.CRM).toBe(2);
  });
});
