import { describe, it, expect } from 'vitest';
import {
  buildSlimRecipe,
  buildSlimConnection,
} from '../../entrypoints/background/tools/workato/slim-asset';

const RECIPE_FIXTURE = {
  asset_type: 'recipe',
  id: 72652236,
  folder_id: 28075001,
  project_id: 199094,
  name: 'Roman Testing of [SFDC] REC | Asset Base Creation (SID and SNR)',
  state: 'active',
  running: false,
  last_run_at: '2026-05-11T09:54:54.243-07:00',
  job_succeeded_count: 50,
  job_failed_count: 2,
  trigger_application: 'salesforce',
  trigger_business_object: 'new_custom_object',
  action_applications: ['salesforce', 'netsuite'],
  updated_at: '2026-05-11T11:58:11.414-07:00',
  created_at: '2026-04-22T10:00:00.000-07:00',
  tags: [],
  latest_activity: { event_type: 'updated', timestamp: '...', user_name: 'Roman' },
};

const CONNECTION_FIXTURE = {
  asset_type: 'connection',
  id: 14474811,
  folder_id: 19006924,
  project_id: 199094,
  name: '[SFDC] CONN | Avid SIT Sandbox',
  provider: 'salesforce',
  authorization_status: 'success',
  authorized_at: '2026-05-01T10:00:00.000-07:00',
  connection_lost_at: null,
  connection_lost_reason: null,
  recipe_count: 42,
  updated_at: '2026-05-06T06:41:05.974-07:00',
  latest_activity: { event_type: 'connection_connected', timestamp: '...', user_name: 'Roman' },
  tags: [],
};

describe('buildSlimRecipe', () => {
  it('extracts the 12 documented fields from a full recipe item', () => {
    const slim = buildSlimRecipe(RECIPE_FIXTURE);
    expect(slim).toEqual({
      id: 72652236,
      name: 'Roman Testing of [SFDC] REC | Asset Base Creation (SID and SNR)',
      folder_id: 28075001,
      project_id: 199094,
      running: false,
      state: 'active',
      last_run_at: '2026-05-11T09:54:54.243-07:00',
      job_succeeded_count: 50,
      job_failed_count: 2,
      trigger_application: 'salesforce',
      trigger_business_object: 'new_custom_object',
      action_applications: ['salesforce', 'netsuite'],
    });
  });

  it('falls back to sensible defaults for missing fields', () => {
    const slim = buildSlimRecipe({});
    expect(slim).toEqual({
      id: 0,
      name: '',
      folder_id: 0,
      project_id: 0,
      running: false,
      state: '',
      last_run_at: null,
      job_succeeded_count: 0,
      job_failed_count: 0,
      trigger_application: '',
      trigger_business_object: '',
      action_applications: [],
    });
  });

  it('preserves null last_run_at (never-run recipe)', () => {
    const slim = buildSlimRecipe({ ...RECIPE_FIXTURE, last_run_at: null });
    expect(slim.last_run_at).toBeNull();
  });

  it('coerces non-array action_applications to []', () => {
    const slim = buildSlimRecipe({ ...RECIPE_FIXTURE, action_applications: undefined });
    expect(slim.action_applications).toEqual([]);
  });
});

describe('buildSlimConnection', () => {
  it('extracts the 11 documented fields from a full connection item', () => {
    const slim = buildSlimConnection(CONNECTION_FIXTURE);
    expect(slim).toEqual({
      id: 14474811,
      name: '[SFDC] CONN | Avid SIT Sandbox',
      provider: 'salesforce',
      folder_id: 19006924,
      project_id: 199094,
      recipe_count: 42,
      authorization_status: 'success',
      authorized_at: '2026-05-01T10:00:00.000-07:00',
      connection_lost_at: null,
      connection_lost_reason: null,
      updated_at: '2026-05-06T06:41:05.974-07:00',
    });
  });

  it('falls back to sensible defaults for missing fields', () => {
    const slim = buildSlimConnection({});
    expect(slim).toEqual({
      id: 0,
      name: '',
      provider: '',
      folder_id: 0,
      project_id: 0,
      recipe_count: 0,
      authorization_status: '',
      authorized_at: null,
      connection_lost_at: null,
      connection_lost_reason: null,
      updated_at: '',
    });
  });

  it('preserves a lost-connection payload', () => {
    const slim = buildSlimConnection({
      ...CONNECTION_FIXTURE,
      authorization_status: 'failed',
      connection_lost_at: '2026-05-10T00:00:00.000-07:00',
      connection_lost_reason: 'token revoked',
    });
    expect(slim.authorization_status).toBe('failed');
    expect(slim.connection_lost_at).toBe('2026-05-10T00:00:00.000-07:00');
    expect(slim.connection_lost_reason).toBe('token revoked');
  });
});
