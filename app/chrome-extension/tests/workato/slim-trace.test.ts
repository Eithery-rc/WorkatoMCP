import { describe, it, expect } from 'vitest';
import { buildSlimTrace } from '../../entrypoints/background/tools/workato/slim-trace';

const META_OK = {
  result: {
    job: {
      id: 42,
      status: 'succeeded',
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:00:01.500Z',
    },
    recipe: { id: 7, name: 'My Recipe', version_no: 3 },
  },
};

const META_FAILED = {
  result: {
    job: {
      id: 99,
      status: 'failed',
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:00:02.000Z',
      error: {
        message: 'NetSuite write failed',
        error_type: 'AdapterError',
        line_number: 7,
        adapter: 'netsuite',
        action: 'add_record',
      },
    },
    recipe: { id: 7, name: 'My Recipe', version_no: 3 },
  },
};

const LINES = {
  line_details: [
    {
      recipe_line_number: 0,
      adapter_name: 'salesforce',
      adapter_operation: 'new_updated_object',
      input: { sobject: 'Account' },
      output: { Id: '001xxx', Name: 'Acme' },
    },
    {
      recipe_line_number: 1,
      adapter_name: 'netsuite',
      adapter_operation: 'add_record',
      input: { huge: 'x'.repeat(2000) },
      output: { ok: true },
    },
  ],
  lines_truncated: false,
  kms_error: false,
};

describe('buildSlimTrace', () => {
  it('shapes a succeeded job', () => {
    const slim = buildSlimTrace(42, META_OK, LINES);
    expect(slim.job_id).toBe(42);
    expect(slim.status).toBe('succeeded');
    expect(slim.duration_ms).toBe(1500);
    expect(slim.error).toBeUndefined();
    expect(slim.recipe).toEqual({ id: 7, name: 'My Recipe', version_no: 3 });
    expect(slim.steps).toHaveLength(2);
    expect(slim.steps[0].adapter_name).toBe('salesforce');
  });

  it('includes error block when job failed', () => {
    const slim = buildSlimTrace(99, META_FAILED, LINES);
    expect(slim.status).toBe('failed');
    expect(slim.error?.message).toBe('NetSuite write failed');
    expect(slim.error?.line_number).toBe(7);
  });

  it('truncates large input_summary to 500 chars + ellipsis', () => {
    const slim = buildSlimTrace(42, META_OK, LINES);
    const big = slim.steps[1].input_summary;
    expect(big.length).toBeLessThanOrEqual(503); // 500 + '...'
    expect(big.endsWith('...')).toBe(true);
  });

  it('passes through lines_truncated and kms_error flags', () => {
    const slim = buildSlimTrace(1, META_OK, { ...LINES, lines_truncated: true, kms_error: true });
    expect(slim.lines_truncated).toBe(true);
    expect(slim.kms_error).toBe(true);
  });

  it('handles missing line_details safely', () => {
    const slim = buildSlimTrace(1, META_OK, {});
    expect(slim.steps).toEqual([]);
    expect(slim.lines_truncated).toBe(false);
  });

  it('handles missing job/recipe fields with sensible defaults', () => {
    const slim = buildSlimTrace('abc', {}, {});
    expect(slim.job_id).toBe('abc');
    expect(slim.status).toBe('unknown');
    expect(slim.recipe).toEqual({ id: 0, name: '', version_no: 0 });
    expect(slim.duration_ms).toBe(0);
  });

  // Regression: summarize(undefined) used to throw TypeError because
  // JSON.stringify(undefined) returns undefined, not "undefined".
  it('summarizes step with undefined input/output without throwing', () => {
    const lines = {
      line_details: [
        {
          recipe_line_number: 0,
          adapter_name: 'workato_variable',
          adapter_operation: 'stop',
          input: undefined,
          output: undefined,
        },
      ],
    };
    const slim = buildSlimTrace(1, META_OK, lines);
    expect(slim.steps).toHaveLength(1);
    expect(slim.steps[0].input_summary).toBe('undefined');
    expect(slim.steps[0].output_summary).toBe('undefined');
  });

  // Regression: duration_ms could be NaN on malformed date strings (serializes
  // as null in JSON, violating the typed number contract).
  it('returns duration_ms = 0 when started_at/completed_at are malformed dates', () => {
    const malformedMeta = {
      result: {
        job: {
          id: 1,
          status: 'succeeded',
          started_at: 'not-a-date',
          completed_at: 'also-not-a-date',
        },
        recipe: { id: 1, name: 'x', version_no: 1 },
      },
    };
    const slim = buildSlimTrace(1, malformedMeta, LINES);
    expect(Number.isFinite(slim.duration_ms)).toBe(true);
    expect(slim.duration_ms).toBe(0);
  });
});
