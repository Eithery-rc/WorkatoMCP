/**
 * @fileoverview An erased job answers `line_details: []`. Projecting that
 * produces a trace with zero steps, which reads as "this job ran nothing".
 * These tests pin the shape that says the data is gone instead.
 *
 * Fixtures follow the shapes captured in probe_job-search.json (2026-09-07):
 * the list keeps erased jobs with `erased: true`, `report: null` and no
 * `error`; `/web_api/recipes/<id>/jobs/<job_id>` still returns the job header;
 * `/line_details` returns `{line_details: [], lines_truncated: false,
 * kms_error: null}`.
 */

import { describe, expect, it } from 'vitest';

import {
  buildErasedTrace,
  buildSlimTrace,
  ERASED_TRACE_NOTE,
  isErasedJob,
  type RawLineDetailsResponse,
  type RawMetaResponse,
} from '@/entrypoints/background/tools/workato/slim-trace';

const ERASED_META: RawMetaResponse = {
  result: {
    job: {
      id: 'j-Aacs4LMK-BJYDo8-CD',
      status: 'succeeded',
      title: '',
      started_at: '2026-06-25T06:58:43.454-07:00',
      completed_at: '2026-06-25T06:58:59.960-07:00',
      erased: true,
      zero_retention: false,
    },
    recipe: { id: 72988590, name: 'Order sync', version_no: 41 },
  },
};

/** `/line_details` for an erased job, verbatim from the probe capture. */
const ERASED_LINES: RawLineDetailsResponse = {
  line_details: [],
  lines_truncated: false,
};

const KEPT_META: RawMetaResponse = {
  result: {
    job: {
      id: 'j-AbWgaWbC-WpahEG-CD',
      status: 'failed',
      started_at: '2026-09-05T09:41:12.000-07:00',
      completed_at: '2026-09-05T09:41:14.000-07:00',
      erased: false,
      zero_retention: false,
    },
    recipe: { id: 82145436, name: 'Marker probe', version_no: 6 },
  },
};

describe('isErasedJob', () => {
  it('is true only when the job header says the data was erased', () => {
    expect(isErasedJob(ERASED_META)).toBe(true);
    expect(isErasedJob(KEPT_META)).toBe(false);
    expect(isErasedJob({})).toBe(false);
  });

  it('does not read a zero_retention policy as erased data', () => {
    // zero_retention describes the recipe; `erased` describes this job.
    const zeroRetention: RawMetaResponse = {
      result: { job: { id: 'j-1', status: 'succeeded', zero_retention: true } },
    };
    expect(isErasedJob(zeroRetention)).toBe(false);
  });
});

describe('buildErasedTrace', () => {
  it('returns the job header and an explicit reason, not a zero-step trace', () => {
    const trace = buildErasedTrace('j-Aacs4LMK-BJYDo8-CD', ERASED_META);

    expect(trace).toEqual({
      job_id: 'j-Aacs4LMK-BJYDo8-CD',
      erased: true,
      zero_retention: false,
      note: ERASED_TRACE_NOTE,
      recipe: { id: 72988590, name: 'Order sync', version_no: 41 },
      status: 'succeeded',
      started_at: '2026-06-25T06:58:43.454-07:00',
      completed_at: '2026-06-25T06:58:59.960-07:00',
    });
    expect(trace.note).toMatch(/erased by retention/);
    expect('steps' in trace).toBe(false);
  });

  it('preserves zero_retention false and omits an empty title', () => {
    const trace = buildErasedTrace('j-1', ERASED_META);
    // false is information: the recipe DOES retain data, this job was swept.
    expect(trace.zero_retention).toBe(false);
    expect(trace.title).toBeUndefined();
  });

  it('keeps a title when the job has one', () => {
    const withTitle: RawMetaResponse = {
      result: {
        job: { id: 'j-2', status: 'succeeded', title: 'Processed event', erased: true },
        recipe: { id: 1, name: 'R', version_no: 2 },
      },
    };
    expect(buildErasedTrace('j-2', withTitle).title).toBe('Processed event');
  });

  it('reports zero_retention true when the recipe stored nothing at all', () => {
    const zero: RawMetaResponse = {
      result: {
        job: { id: 'j-3', status: 'succeeded', erased: true, zero_retention: true },
        recipe: { id: 1, name: 'R', version_no: 2 },
      },
    };
    expect(buildErasedTrace('j-3', zero).zero_retention).toBe(true);
  });

  it('is what the empty line_details would otherwise have produced', () => {
    // The old answer: a real trace with no steps and nothing saying why.
    const slim = buildSlimTrace('j-Aacs4LMK-BJYDo8-CD', ERASED_META, ERASED_LINES);
    expect(slim.steps).toEqual([]);
    expect(JSON.stringify(slim)).not.toMatch(/erased/);

    const trace = buildErasedTrace('j-Aacs4LMK-BJYDo8-CD', ERASED_META);
    expect(trace.erased).toBe(true);
    expect(trace.recipe).toEqual(slim.recipe);
    expect(trace.started_at).toBe(slim.started_at);
  });
});
