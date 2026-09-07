/**
 * @fileoverview workato_test_recipe: mode detection, trigger-input validation,
 * the write gate, and the in-page run/stop/status calls.
 *
 * Fixtures mirror recipe 82145419 'MCP probe test-input' (sandbox folder
 * 30945905), captured 2026-09-07: a workato_recipe_function trigger declaring
 * the string parameter `greeting` plus one logger step. That recipe is kept
 * live so these shapes can be re-verified.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assessTestWriteGate,
  buildTestRequestBody,
  collectStepProviders,
  detectTestMode,
  parseRecipeConfig,
  readTestStatusInPage,
  readTriggerParameters,
  runRecipeTestInPage,
  stopRecipeTestInPage,
  validateTriggerInput,
} from '@/entrypoints/background/tools/workato/test-recipe';

const PARAMETERS_SCHEMA_JSON = JSON.stringify([
  {
    name: 'greeting',
    type: 'string',
    optional: false,
    control_type: 'text',
    label: 'Greeting',
  },
]);

/** Trigger node of recipe 82145419, with its logger step. */
const RECIPE_FUNCTION_CODE = {
  as: '0fd4f0d3-1b60-4310-8949-fea0603cc3b0',
  keyword: 'trigger',
  name: 'execute',
  provider: 'workato_recipe_function',
  number: 0,
  input: { parameters_schema_json: PARAMETERS_SCHEMA_JSON },
  extended_output_schema: [
    {
      label: 'Parameters',
      name: 'parameters',
      type: 'object',
      properties: [
        {
          control_type: 'text',
          label: 'Greeting',
          name: 'greeting',
          optional: false,
          type: 'string',
        },
      ],
    },
  ],
  block: [
    {
      number: 1,
      keyword: 'action',
      name: 'log_message',
      provider: 'logger',
      as: 'a1b2c3d4',
      input: { message: 'greeting=#{_dp(...)}' },
    },
  ],
};

const CONNECTIONLESS_CONFIG = JSON.stringify([
  {
    keyword: 'application',
    name: 'workato_recipe_function',
    provider: 'workato_recipe_function',
    skip_validation: false,
  },
  { keyword: 'application', name: 'logger', provider: 'logger', skip_validation: false },
]);

const CLOCK_CODE = {
  as: 'e74c2506',
  keyword: 'trigger',
  name: 'scheduled_event',
  provider: 'clock',
  number: 0,
  input: { time_unit: 'minutes', trigger_every: '60' },
  block: [],
};

const WEBHOOK_CODE = {
  as: 'bb11cc22',
  keyword: 'trigger',
  name: 'new_event',
  provider: 'workato_webhooks',
  number: 0,
  input: {},
  block: [],
};

const PUB_SUB_CODE = {
  as: 'cc33dd44',
  keyword: 'trigger',
  name: 'subscribe_to_topic',
  provider: 'workato_pub_sub',
  number: 0,
  input: { topic_id: '97166' },
  block: [],
};

const SALESFORCE_CODE = {
  as: '147f5e51',
  keyword: 'trigger',
  name: 'new_custom_object',
  provider: 'salesforce',
  number: 0,
  input: { sobject_name: 'Asset' },
  block: [
    {
      number: 1,
      keyword: 'action',
      name: 'add_record',
      provider: 'netsuite',
      as: 'dd55ee66',
      input: {},
    },
  ],
};

describe('detectTestMode', () => {
  it('reads a recipe_function trigger as the input mode with its declared parameters', () => {
    const decision = detectTestMode(RECIPE_FUNCTION_CODE);
    expect(decision.mode).toBe('input');
    expect(decision.provider).toBe('workato_recipe_function');
    expect(decision.trigger_name).toBe('execute');
    expect(decision.parameters).toEqual([{ name: 'greeting', required: true, type: 'string' }]);
  });

  it('falls back to the extended_output_schema parameters wrapper', () => {
    const code = {
      ...RECIPE_FUNCTION_CODE,
      input: {},
    };
    expect(readTriggerParameters(code)).toEqual([
      { name: 'greeting', required: true, type: 'string' },
    ]);
  });

  it('returns null parameters when the trigger declares no schema at all', () => {
    const code = { ...RECIPE_FUNCTION_CODE, input: {}, extended_output_schema: undefined };
    const decision = detectTestMode(code);
    expect(decision.mode).toBe('input');
    expect(decision.parameters).toBeNull();
  });

  it('treats a clock trigger as immediate', () => {
    const decision = detectTestMode(CLOCK_CODE);
    expect(decision.mode).toBe('immediate');
    expect(decision.parameters).toBeNull();
  });

  it('treats webhook and pub_sub triggers as waiting', () => {
    expect(detectTestMode(WEBHOOK_CODE).mode).toBe('waiting');
    expect(detectTestMode(PUB_SUB_CODE).mode).toBe('waiting');
  });

  it('treats any other trigger as unsupported and says why', () => {
    const decision = detectTestMode(SALESFORCE_CODE);
    expect(decision.mode).toBe('unsupported');
    expect(decision.provider).toBe('salesforce');
    expect(decision.reason).toMatch(/salesforce\/new_custom_object/);
  });

  it('treats an unreadable code tree as unsupported instead of guessing', () => {
    expect(detectTestMode(null).mode).toBe('unsupported');
    expect(detectTestMode('[]').mode).toBe('unsupported');
  });
});

describe('validateTriggerInput', () => {
  const parameters = [
    { name: 'greeting', required: true, type: 'string' },
    { name: 'count', required: false, type: 'number' },
  ];

  it('accepts a complete input', () => {
    expect(validateTriggerInput({ greeting: 'hello from API' }, parameters)).toEqual({
      unknown_keys: [],
      missing_required: [],
    });
  });

  it('preserves 0 and false as supplied values', () => {
    expect(validateTriggerInput({ greeting: '', count: 0 }, parameters)).toEqual({
      unknown_keys: [],
      missing_required: [],
    });
    expect(
      validateTriggerInput({ greeting: false as unknown as string }, parameters).missing_required,
    ).toEqual([]);
  });

  it('reports missing required parameters and keys the trigger does not declare', () => {
    expect(validateTriggerInput({ greetings: 'typo' }, parameters)).toEqual({
      unknown_keys: ['greetings'],
      missing_required: ['greeting'],
    });
  });

  it('treats an omitted input as every required parameter missing', () => {
    expect(validateTriggerInput(undefined, parameters)).toEqual({
      unknown_keys: [],
      missing_required: ['greeting'],
    });
  });
});

describe('assessTestWriteGate', () => {
  it('lets a connectionless recipe run without allow_writes', () => {
    const gate = assessTestWriteGate(CONNECTIONLESS_CONFIG, RECIPE_FUNCTION_CODE);
    expect(gate).toEqual({
      connection_backed: [],
      unbound_step_providers: [],
      unbound_providers: [],
      requires_allow_writes: false,
    });
  });

  it('reports a config entry with no account_id for a provider that needs one', () => {
    // The shape remove_step leaves behind: salesforce has an entry, no
    // account_id, and a step still uses it. Workato refuses the run itself.
    const config = JSON.stringify([
      { keyword: 'application', name: 'logger', provider: 'logger', skip_validation: false },
      {
        keyword: 'application',
        name: 'salesforce',
        provider: 'salesforce',
        skip_validation: false,
      },
    ]);
    const gate = assessTestWriteGate(config, SALESFORCE_CODE);
    expect(gate.unbound_providers).toEqual(['salesforce']);
    expect(gate.connection_backed).toEqual([]);
    // netsuite has no entry at all, which is the pre-existing gate.
    expect(gate.unbound_step_providers).toEqual(['netsuite']);
  });

  it('does not report an account-less entry for a connectionless provider', () => {
    const gate = assessTestWriteGate(CONNECTIONLESS_CONFIG, RECIPE_FUNCTION_CODE);
    expect(gate.unbound_providers).toEqual([]);
  });

  it('does not report an account-less entry no step uses', () => {
    const config = JSON.stringify([
      { keyword: 'application', name: 'logger', provider: 'logger', skip_validation: false },
      {
        keyword: 'application',
        name: 'salesforce',
        provider: 'salesforce',
        skip_validation: false,
      },
    ]);
    // Nothing in this tree is a salesforce step, so the entry is dead weight.
    const gate = assessTestWriteGate(config, RECIPE_FUNCTION_CODE);
    expect(gate.unbound_providers).toEqual([]);
  });

  it('requires allow_writes when a config entry carries an account_id', () => {
    const config = JSON.stringify([
      {
        keyword: 'application',
        name: 'salesforce',
        provider: 'salesforce',
        skip_validation: false,
        account_id: 14474811,
      },
      { keyword: 'application', name: 'netsuite', provider: 'netsuite', account_id: 784927 },
      { keyword: 'application', name: 'logger', provider: 'logger', skip_validation: false },
    ]);
    const gate = assessTestWriteGate(config, SALESFORCE_CODE);
    expect(gate.connection_backed).toEqual(['salesforce', 'netsuite']);
    expect(gate.unbound_step_providers).toEqual([]);
    expect(gate.requires_allow_writes).toBe(true);
  });

  it('gates a step provider that the config does not describe at all', () => {
    const gate = assessTestWriteGate(CONNECTIONLESS_CONFIG, {
      ...RECIPE_FUNCTION_CODE,
      block: [
        {
          number: 1,
          keyword: 'action',
          name: 'add_record',
          provider: 'netsuite',
          as: 'ee77ff88',
          input: {},
        },
      ],
    });
    expect(gate.connection_backed).toEqual([]);
    expect(gate.unbound_step_providers).toEqual(['netsuite']);
    expect(gate.requires_allow_writes).toBe(true);
  });

  it('tolerates an already-parsed config array and an unusable one', () => {
    expect(parseRecipeConfig(JSON.parse(CONNECTIONLESS_CONFIG))).toHaveLength(2);
    expect(parseRecipeConfig('not json')).toEqual([]);
    expect(parseRecipeConfig(undefined)).toEqual([]);
  });

  it('collects step providers from nested blocks and skips control flow nodes', () => {
    const code = {
      keyword: 'trigger',
      provider: 'clock',
      name: 'scheduled_event',
      block: [
        {
          keyword: 'if',
          number: 1,
          block: [{ keyword: 'action', number: 2, provider: 'logger', name: 'log_message' }],
        },
      ],
    };
    expect(collectStepProviders(code)).toEqual(['clock', 'logger']);
  });
});

describe('buildTestRequestBody', () => {
  it('wraps trigger input for a recipe_function trigger', () => {
    expect(buildTestRequestBody('input', { greeting: 'hello from API' })).toEqual({
      trigger_event: {
        parameters: { greeting: 'hello from API' },
        context: { calling_job_id: '0', calling_recipe_id: '0' },
      },
      error_format: 'json',
    });
  });

  it('sends only error_format for clock, webhook and pub_sub triggers', () => {
    expect(buildTestRequestBody('immediate', undefined)).toEqual({ error_format: 'json' });
    expect(buildTestRequestBody('waiting', undefined)).toEqual({ error_format: 'json' });
  });
});

/* -------------------------------------------------------------------------- */
/* In-page calls                                                              */
/* -------------------------------------------------------------------------- */

const OLD_JOB = {
  id: 'j-AbWgPDab-HGRdzY-CD',
  status: 'succeeded',
  is_test: true,
  started_at: '2026-09-07T09:38:26.014-07:00',
  completed_at: '2026-09-07T09:38:26.086-07:00',
};

const NEW_JOB_DONE = {
  id: 'j-AbWgPXs9-YDeonA-CD',
  status: 'succeeded',
  is_test: true,
  started_at: '2026-09-07T09:41:02.100-07:00',
  completed_at: '2026-09-07T09:41:02.172-07:00',
};

const NEW_JOB_RUNNING = {
  id: 'j-AbWgPXs9-YDeonA-CD',
  status: 'running',
  is_test: true,
  started_at: '2026-09-07T09:41:02.100-07:00',
  completed_at: null,
};

const PUT_RESPONSE = {
  success: true,
  flow: {
    id: 82145419,
    last_run_at: '2026-09-07T09:41:02.014-07:00',
    stopped_at: null,
    running: false,
    testing: true,
  },
};

function jobsPage(jobs: unknown[]) {
  return {
    job_scope_count: jobs.length,
    job_count: jobs.length,
    job_per_page: 5,
    jobs,
  };
}

/** fetch stub that answers the jobs list from a queue and the PUT from a fixture. */
function stubTestFetch(jobsQueue: unknown[][], options?: { jobsStatus?: number }) {
  let jobsCall = 0;
  const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const href = String(url);
    if (href.indexOf('/jobs.json') !== -1) {
      const status = options?.jobsStatus ?? 200;
      const page = jobsQueue[Math.min(jobsCall, jobsQueue.length - 1)] ?? [];
      jobsCall += 1;
      return { status, text: async () => JSON.stringify(jobsPage(page)) };
    }
    if (href.indexOf('/test.json') !== -1) {
      return { status: 200, text: async () => JSON.stringify(PUT_RESPONSE) };
    }
    throw new Error(`unexpected fetch ${href}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('runRecipeTestInPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = 'XSRF-TOKEN-V2=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('PUTs test.json with the editor request shape and returns the job seen on the second poll', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = stubTestFetch([
      [OLD_JOB], // pre-run scan
      [OLD_JOB], // first poll: nothing new yet
      [NEW_JOB_DONE, OLD_JOB], // second poll: the test job has landed
    ]);

    const body = buildTestRequestBody('input', { greeting: 'hello from API' });
    const result = await runRecipeTestInPage(82145419, body, 5_000, 1);

    expect(result.ok).toBe(true);
    expect(result.job).toEqual({
      id: 'j-AbWgPXs9-YDeonA-CD',
      status: 'succeeded',
      started_at: '2026-09-07T09:41:02.100-07:00',
      completed_at: '2026-09-07T09:41:02.172-07:00',
    });
    expect(result.polls).toBe(2);
    expect(result.timed_out).toBe(false);
    expect(result.flow).toMatchObject({ testing: true, running: false });

    const preScan = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(preScan[0])).toBe(
      '/web_api/recipes/82145419/jobs.json?test_jobs_only=true&per_page=5',
    );

    const put = fetchMock.mock.calls[1] as [RequestInfo | URL, RequestInit];
    expect(String(put[0])).toBe('/recipes/82145419/test.json');
    expect(put[1]).toMatchObject({
      method: 'PUT',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': 'csrf token',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    expect(JSON.parse(put[1].body as string)).toEqual({
      trigger_event: {
        parameters: { greeting: 'hello from API' },
        context: { calling_job_id: '0', calling_recipe_id: '0' },
      },
      error_format: 'json',
    });
  });

  it('keeps polling while the new job is still running', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    stubTestFetch([[OLD_JOB], [NEW_JOB_RUNNING], [NEW_JOB_RUNNING], [NEW_JOB_DONE, OLD_JOB]]);

    const result = await runRecipeTestInPage(
      82145419,
      buildTestRequestBody('immediate', undefined),
      5_000,
      1,
    );

    expect(result.polls).toBe(3);
    expect(result.job?.status).toBe('succeeded');
    expect(result.timed_out).toBe(false);
  });

  it('reports a timeout as pending with the elapsed time instead of a fabricated result', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    stubTestFetch([[OLD_JOB]]);

    const result = await runRecipeTestInPage(
      82145419,
      buildTestRequestBody('immediate', undefined),
      30,
      1,
    );

    expect(result.ok).toBe(true);
    expect(result.timed_out).toBe(true);
    expect(result.job).toBeNull();
    expect(result.polls).toBeGreaterThan(0);
    expect(typeof result.waited_ms).toBe('number');
  });

  it('returns immediately without polling when the wait window is zero', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = stubTestFetch([[OLD_JOB]]);

    const result = await runRecipeTestInPage(
      82145419,
      buildTestRequestBody('waiting', undefined),
      0,
      1,
    );

    expect(result).toMatchObject({ ok: true, job: null, polls: 0, timed_out: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse((fetchMock.mock.calls[1] as [unknown, RequestInit])[1].body as string),
    ).toEqual({ error_format: 'json' });
  });

  it('sends no PUT when the pre-run job scan fails', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = stubTestFetch([[OLD_JOB]], { jobsStatus: 503 });

    const result = await runRecipeTestInPage(
      82145419,
      buildTestRequestBody('immediate', undefined),
      5_000,
      1,
    );

    expect(result.ok).toBe(false);
    expect(result.failure?.stage).toBe('prescan');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses without a CSRF token before touching the network', async () => {
    const fetchMock = stubTestFetch([[OLD_JOB]]);

    const result = await runRecipeTestInPage(
      82145419,
      buildTestRequestBody('immediate', undefined),
      5_000,
      1,
    );

    expect(result.ok).toBe(false);
    expect(result.failure?.stage).toBe('csrf');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a Workato error body from the PUT', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).indexOf('/jobs.json') !== -1) {
          return { status: 200, text: async () => JSON.stringify(jobsPage([])) };
        }
        return {
          status: 200,
          text: async () => JSON.stringify({ error: { details: { trigger: ['is invalid'] } } }),
        };
      }),
    );

    const result = await runRecipeTestInPage(
      82145419,
      buildTestRequestBody('immediate', undefined),
      5_000,
      1,
    );

    expect(result.ok).toBe(false);
    expect(result.failure?.stage).toBe('workato');
    expect(result.failure?.details).toEqual({ trigger: ['is invalid'] });
  });
});

describe('stopRecipeTestInPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = 'XSRF-TOKEN-V2=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('PUTs stop_test.json with the CSRF header and no body', async () => {
    document.cookie = `XSRF-TOKEN-V2=${encodeURIComponent('csrf token')}`;
    const fetchMock = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ result: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await stopRecipeTestInPage(82145419);

    expect(result).toEqual({ ok: true, result: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe('/recipes/82145419/stop_test.json');
    expect(init).toMatchObject({
      method: 'PUT',
      credentials: 'include',
      headers: { 'x-csrf-token': 'csrf token', 'x-requested-with': 'XMLHttpRequest' },
    });
    expect(init.body).toBeUndefined();
  });
});

describe('readTestStatusInPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports flow.testing and the newest test job', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).indexOf('/status.json') !== -1) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              flow: {
                id: 82145419,
                last_run_at: '2026-09-07T09:41:02.014-07:00',
                stopped_at: '2026-09-07T09:41:03.000-07:00',
                state: 'stopped',
                running: false,
                testing: false,
                stop_reason: 'test_run_stop',
              },
            }),
        };
      }
      return { status: 200, text: async () => JSON.stringify(jobsPage([NEW_JOB_DONE, OLD_JOB])) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await readTestStatusInPage(82145419);

    expect(result.ok).toBe(true);
    expect(result.flow).toEqual({
      state: 'stopped',
      running: false,
      testing: false,
      stop_reason: 'test_run_stop',
      last_run_at: '2026-09-07T09:41:02.014-07:00',
    });
    expect(result.latest_test_job).toEqual({
      id: 'j-AbWgPXs9-YDeonA-CD',
      status: 'succeeded',
      started_at: '2026-09-07T09:41:02.100-07:00',
      completed_at: '2026-09-07T09:41:02.172-07:00',
    });
    expect(String((fetchMock.mock.calls[0] as [RequestInfo | URL])[0])).toBe(
      '/recipes/82145419/status.json',
    );
  });

  it('still answers with the flow when the test-job list is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).indexOf('/status.json') !== -1) {
          return {
            status: 200,
            text: async () =>
              JSON.stringify({ flow: { state: 'stopped', running: false, testing: true } }),
          };
        }
        return { status: 500, text: async () => 'nope' };
      }),
    );

    const result = await readTestStatusInPage(82145419);
    expect(result.ok).toBe(true);
    expect(result.flow?.testing).toBe(true);
    expect(result.latest_test_job).toBeNull();
  });
});
