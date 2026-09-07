import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  describeStartError,
  fetchRecipeActivationStateInPage,
  mentionsAccountId,
  normalizeConfigErrors,
  normalizeStartError,
} from '@/entrypoints/background/tools/workato/recipe-state';

/**
 * Fixtures captured live 2026-09-07 from GET /web_api/recipes/<id>/state.json.
 * Workato uses two serializations for config_errors: positional arrays on later
 * reads, objects on the read right after activation. Same headers, same recipe.
 */
const POSITIONAL_ERROR = {
  state: 'stopped',
  error: {
    details: {
      code_errors: [],
      config_errors: [[1, [['account_id', null, "can't be blank"]]]],
      param_errors: [],
      requirements_errors: [],
    },
  },
};

const OBJECT_ERROR = {
  state: 'stopped',
  error: {
    details: {
      code_errors: [],
      config_errors: [
        {
          line_number: 1,
          errors: [{ field_label: 'account_id', value: null, message: "can't be blank" }],
        },
      ],
      param_errors: [],
      requirements_errors: [],
    },
  },
};

const MESSAGE_ERROR = {
  state: 'permanently_stopped',
  error: {
    details: {
      message:
        'Webhook registration error. API returned: Error while creating channel member: The ' +
        "selected field type, Shipping_Account_Address__c, isn't supported for event enrichment.",
    },
  },
};

describe('normalizeConfigErrors', () => {
  it('normalizes the positional serialization', () => {
    expect(normalizeConfigErrors([[1, [['account_id', null, "can't be blank"]]]])).toEqual([
      { line_number: 1, field: 'account_id', value: null, message: "can't be blank" },
    ]);
  });

  it('normalizes the object serialization', () => {
    expect(
      normalizeConfigErrors([
        {
          line_number: 4,
          errors: [{ field_label: 'account_id', value: null, message: "can't be blank" }],
        },
      ]),
    ).toEqual([{ line_number: 4, field: 'account_id', value: null, message: "can't be blank" }]);
  });

  it('preserves 0 and false as field values', () => {
    expect(
      normalizeConfigErrors([
        [0, [['retries', 0, 'must be positive']]],
        [2, [['enabled', false, 'must be true']]],
      ]),
    ).toEqual([
      { line_number: 0, field: 'retries', value: 0, message: 'must be positive' },
      { line_number: 2, field: 'enabled', value: false, message: 'must be true' },
    ]);
  });

  it('keeps an unrecognised entry rather than dropping it', () => {
    const out = normalizeConfigErrors(['something odd']);
    expect(out).toEqual([
      { line_number: null, field: null, value: 'something odd', message: 'something odd' },
    ]);
  });

  it('returns an empty list for a non-array', () => {
    expect(normalizeConfigErrors(null)).toEqual([]);
    expect(normalizeConfigErrors(undefined)).toEqual([]);
  });
});

describe('normalizeStartError', () => {
  it('returns null when Workato recorded no activation error', () => {
    expect(normalizeStartError({ state: 'stopped', error: null })).toBeNull();
    expect(normalizeStartError({ state: 'permanently_stopped', error: null })).toBeNull();
  });

  it('returns null when every error bucket is empty', () => {
    expect(
      normalizeStartError({
        state: 'stopped',
        error: {
          details: {
            code_errors: [],
            config_errors: [],
            param_errors: [],
            requirements_errors: [],
          },
        },
      }),
    ).toBeNull();
  });

  it('normalizes both config_errors serializations to the same shape', () => {
    const fromPositional = normalizeStartError(POSITIONAL_ERROR);
    const fromObject = normalizeStartError(OBJECT_ERROR);
    expect(fromPositional).toEqual({
      state: 'stopped',
      code_errors: [],
      config_errors: [
        { line_number: 1, field: 'account_id', value: null, message: "can't be blank" },
      ],
      param_errors: [],
      requirements_errors: [],
    });
    expect(fromObject?.config_errors).toEqual(fromPositional?.config_errors);
  });

  it('carries the runtime-failure message form', () => {
    const normalized = normalizeStartError(MESSAGE_ERROR);
    expect(normalized?.state).toBe('permanently_stopped');
    expect(normalized?.message).toContain('Webhook registration error');
    expect(normalized?.config_errors).toEqual([]);
  });
});

describe('describeStartError / mentionsAccountId', () => {
  it('names the offending line and field', () => {
    const normalized = normalizeStartError(POSITIONAL_ERROR)!;
    expect(describeStartError(normalized)).toBe("line 1 field account_id: can't be blank");
    expect(mentionsAccountId(normalized)).toBe(true);
  });

  it('does not claim a connection problem for an unrelated error', () => {
    const normalized = normalizeStartError({
      state: 'stopped',
      error: { details: { config_errors: [[2, [['schedule', null, 'is invalid']]]] } },
    })!;
    expect(mentionsAccountId(normalized)).toBe(false);
    expect(describeStartError(normalized)).toBe('line 2 field schedule: is invalid');
  });

  it('reports the message form and other error buckets', () => {
    const normalized = normalizeStartError({
      state: 'stopped',
      error: { details: { requirements_errors: ['recipe has no trigger'] } },
    })!;
    expect(describeStartError(normalized)).toBe('recipe has no trigger');
  });
});

describe('fetchRecipeActivationStateInPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('GETs state.json with the XMLHttpRequest header and returns state plus error', async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify(POSITIONAL_ERROR),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchRecipeActivationStateInPage(82145420);

    expect(result.ok).toBe(true);
    expect(result.state).toBe('stopped');
    expect(
      normalizeStartError({ state: result.state!, error: result.error })?.config_errors,
    ).toEqual([{ line_number: 1, field: 'account_id', value: null, message: "can't be blank" }]);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/web_api/recipes/82145420/state.json');
    expect(options.headers).toMatchObject({ 'x-requested-with': 'XMLHttpRequest' });
  });

  it('reports an HTTP failure instead of pretending there is no error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 404, text: async () => 'No route matches' })),
    );

    const result = await fetchRecipeActivationStateInPage(1);

    expect(result.ok).toBe(false);
    expect(result.failure?.stage).toBe('fetch');
    expect(result.failure?.status).toBe(404);
  });
});
