/**
 * @fileoverview Tests for the pure half of workato_list_jobs: job shaping with
 * report-column labels, the fields projector, date-bound normalization and the
 * coverage summary.
 *
 * Fixtures come from a live capture (2026-09-07): an erased job keeps
 * erased:true with report null and NO error key even though it failed, a kept
 * job carries custom_column_0/1, and the labels live on the recipe trigger's
 * job_report_schema.
 */

import { describe, expect, it } from 'vitest';

import {
  buildCoverageSummary,
  normalizeMatchSpec,
  normalizeStartedBound,
  parseReportColumns,
  projectJobFields,
  reportLabelMap,
  resolveTimezoneOffset,
  shapeSlimJob,
  validateJobFields,
  type JobScanCoverage,
} from '@/entrypoints/background/tools/workato/job-projection';

const COLUMNS = [
  { name: 'custom_column_0', label: 'Marker code' },
  { name: 'custom_column_1', label: 'Marker pill' },
];

const KEPT_JOB = {
  id: 'j-AbWgaWbC-WpahEG-CD',
  master_job_id: 'j-AbWgaWbC-WpahEG-CD',
  recipe_id: 82145436,
  calling_job_id: null,
  calling_recipe_id: null,
  title: '',
  status: 'succeeded',
  is_repeat: false,
  zero_retention: false,
  is_test: true,
  started_at: '2026-09-05T09:41:12.000-07:00',
  completed_at: '2026-09-05T09:41:13.500-07:00',
  erased: false,
  report: { custom_column_0: 'GIRAFFE-4412 static', custom_column_1: 'GIRAFFE-4412' },
};

const ERASED_JOB = {
  id: 'j-AaYGsf84-JkLrEF-CD',
  recipe_id: 72454389,
  title: '',
  status: 'failed',
  zero_retention: false,
  is_test: true,
  started_at: '2026-06-18T09:18:14.090-07:00',
  completed_at: '2026-06-18T09:18:14.685-07:00',
  erased: true,
  report: null,
};

const CALLED_JOB = {
  id: 'j-AbTDC8sK-AaQNDn-CD',
  recipe_id: 76902508,
  calling_job_id: 'j-AbTDC8f4-gYMMKH-CD',
  calling_recipe_id: 76887741,
  root_job_id: 'j-AbTDC8f4-gYMMKH-CD',
  root_recipe_id: 76887741,
  title: '',
  status: 'succeeded',
  started_at: '2026-09-04T08:19:22.982-07:00',
  completed_at: '2026-09-04T08:19:24.982-07:00',
  erased: false,
  report: {},
};

describe('parseReportColumns', () => {
  it('reads job_report_schema off the trigger node, string or object', () => {
    const tree = {
      keyword: 'trigger',
      job_report_schema: COLUMNS,
      job_report_config: { custom_column_0: 'GIRAFFE-4412 static' },
    };
    expect(parseReportColumns(tree)).toEqual(COLUMNS);
    expect(parseReportColumns(JSON.stringify(tree))).toEqual(COLUMNS);
  });

  it('treats a recipe without a job report as zero columns, not an error', () => {
    expect(parseReportColumns({ keyword: 'trigger' })).toEqual([]);
    expect(parseReportColumns('not json')).toEqual([]);
    expect(parseReportColumns(null)).toEqual([]);
  });

  it('keeps an unlabelled column as label null', () => {
    const parsed = parseReportColumns({
      job_report_schema: [{ name: 'custom_column_3' }, { name: 'not_a_column', label: 'x' }],
    });
    expect(parsed).toEqual([{ name: 'custom_column_3', label: null }]);
    expect(reportLabelMap(parsed)).toEqual({});
  });
});

describe('shapeSlimJob', () => {
  it('labels every report column and keeps the ones with no label', () => {
    const slim = shapeSlimJob(
      { ...KEPT_JOB, report: { ...KEPT_JOB.report, custom_column_4: 'unlabelled value' } },
      COLUMNS,
    );
    expect(slim.report).toEqual({
      'Marker code': 'GIRAFFE-4412 static',
      'Marker pill': 'GIRAFFE-4412',
      custom_column_4: 'unlabelled value',
    });
    expect(slim.erased).toBe(false);
    expect(slim.is_test).toBe(true);
    expect(slim.duration_ms).toBe(1500);
  });

  it('keeps columns past custom_column_2, which the old shape dropped', () => {
    const slim = shapeSlimJob(
      {
        ...KEPT_JOB,
        report: {
          custom_column_0: 'a',
          custom_column_1: 'b',
          custom_column_2: 'c',
          custom_column_3: 'd',
          custom_column_5: 'f',
        },
      },
      [],
    );
    expect(Object.keys(slim.report ?? {})).toEqual([
      'custom_column_0',
      'custom_column_1',
      'custom_column_2',
      'custom_column_3',
      'custom_column_5',
    ]);
  });

  it('preserves 0 and false report values', () => {
    const slim = shapeSlimJob(
      { ...KEPT_JOB, report: { custom_column_0: 0, custom_column_1: false } },
      COLUMNS,
    );
    expect(slim.report).toEqual({ 'Marker code': 0, 'Marker pill': false });
  });

  it('reports an erased job as unavailable, not empty', () => {
    const erased = shapeSlimJob(ERASED_JOB, COLUMNS);
    expect(erased.erased).toBe(true);
    expect(erased.title).toBeNull();
    expect(erased.report).toBeNull();
    // A kept job with an empty report is a different thing entirely.
    const empty = shapeSlimJob({ ...KEPT_JOB, report: {} }, COLUMNS);
    expect(empty.erased).toBe(false);
    expect(empty.title).toBe('');
    expect(empty.report).toEqual({});
  });

  it('surfaces the caller ids only when the job has them', () => {
    const called = shapeSlimJob(CALLED_JOB, []);
    expect(called.calling_recipe_id).toBe(76887741);
    expect(called.calling_job_id).toBe('j-AbTDC8f4-gYMMKH-CD');
    const top = shapeSlimJob(KEPT_JOB, []);
    expect('calling_recipe_id' in top).toBe(false);
    expect('calling_job_id' in top).toBe(false);
  });
});

describe('projectJobFields', () => {
  it('returns only the requested fields, labels included', () => {
    const projected = projectJobFields(shapeSlimJob(KEPT_JOB, COLUMNS), [
      'id',
      'started_at',
      'status',
      'report.Marker code',
    ]);
    expect(projected).toEqual({
      id: 'j-AbWgaWbC-WpahEG-CD',
      started_at: '2026-09-05T09:41:12.000-07:00',
      status: 'succeeded',
      report: { 'Marker code': 'GIRAFFE-4412 static' },
    });
  });

  it('reports erased data as null with erased:true, never as empty', () => {
    const projected = projectJobFields(shapeSlimJob(ERASED_JOB, COLUMNS), [
      'id',
      'title',
      'report.Marker code',
    ]);
    expect(projected).toEqual({
      id: 'j-AaYGsf84-JkLrEF-CD',
      title: null,
      report: null,
      erased: true,
    });
  });

  it('gives null for a column the recipe does not have', () => {
    const projected = projectJobFields(shapeSlimJob(KEPT_JOB, COLUMNS), ['report.No Such Column']);
    expect(projected).toEqual({ report: { 'No Such Column': null } });
  });

  it('validates field names and names the allowed set', () => {
    expect(validateJobFields(['id', 'report.Marker code']).ok).toBe(true);
    const bad = validateJobFields(['ID']);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Allowed:/);
    expect(validateJobFields(undefined)).toEqual({ ok: true, fields: undefined });
    expect(validateJobFields([]).ok).toBe(false);
  });
});

describe('normalizeMatchSpec', () => {
  it('defaults to a substring scan over id, title, error and report', () => {
    const spec = normalizeMatchSpec({ value: 'GIRAFFE' });
    expect(spec.ok).toBe(true);
    expect(spec.match).toEqual({
      mode: 'substring',
      fields: ['id', 'title', 'error', 'report'],
      value: 'GIRAFFE',
    });
  });

  it('accepts report.<label> fields and rejects unknown ones', () => {
    expect(normalizeMatchSpec({ value: 'x', fields: ['report.Marker code'] }).ok).toBe(true);
    expect(normalizeMatchSpec({ value: 'x', fields: ['status'] }).ok).toBe(false);
  });

  it('rejects an unusable regex before any page is fetched', () => {
    const spec = normalizeMatchSpec({ mode: 'regex', value: '([' });
    expect(spec.ok).toBe(false);
    expect(spec.error).toMatch(/regular expression/);
  });

  it('treats a missing match as no local scan at all', () => {
    expect(normalizeMatchSpec(undefined)).toEqual({ ok: true, match: null });
  });
});

describe('normalizeStartedBound', () => {
  it('widens a date-only bound to the whole day in UTC by default', () => {
    expect(normalizeStartedBound('2026-07-18', undefined, 'from').value).toBe(
      '2026-07-18T00:00:00+00:00',
    );
    expect(normalizeStartedBound('2026-07-18', undefined, 'to').value).toBe(
      '2026-07-18T23:59:59+00:00',
    );
  });

  it('applies a literal offset and an IANA zone', () => {
    expect(normalizeStartedBound('2026-07-18', '-07:00', 'from').value).toBe(
      '2026-07-18T00:00:00-07:00',
    );
    expect(normalizeStartedBound('2026-08-05T23:59', 'America/Los_Angeles', 'to').value).toBe(
      '2026-08-05T23:59:00-07:00',
    );
    expect(normalizeStartedBound('2026-01-05T12:00', 'America/Los_Angeles', 'from').value).toBe(
      '2026-01-05T12:00:00-08:00',
    );
  });

  it('passes an explicit offset or Z straight through', () => {
    expect(normalizeStartedBound('2026-07-18T00:00:00-07:00', 'UTC', 'from').value).toBe(
      '2026-07-18T00:00:00-07:00',
    );
    expect(normalizeStartedBound('2026-06-01T00:00:00Z', 'America/Los_Angeles', 'to').value).toBe(
      '2026-06-01T00:00:00Z',
    );
  });

  it('rejects a shape the endpoint would silently ignore', () => {
    expect(normalizeStartedBound('last tuesday', undefined, 'from').ok).toBe(false);
    expect(normalizeStartedBound('2026-07-18T00:00:00', 'Mars/Olympus', 'from').ok).toBe(false);
    expect(normalizeStartedBound(undefined, undefined, 'from')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('resolves timezone arguments to a fixed offset', () => {
    expect(resolveTimezoneOffset(undefined, '2026-07-18T00:00:00')).toBe('+00:00');
    expect(resolveTimezoneOffset('+0530', '2026-07-18T00:00:00')).toBe('+05:30');
    expect(resolveTimezoneOffset('Nope/Nowhere', '2026-07-18T00:00:00')).toBeNull();
  });
});

describe('buildCoverageSummary', () => {
  const base: JobScanCoverage = {
    search_mode: 'local',
    scanned: 500,
    matched: 0,
    erased_seen: 0,
    from_started_at: '2026-09-05T09:41:12.000-07:00',
    through_started_at: '2026-08-02T01:02:03.000-07:00',
    complete: false,
    next_cursor: 'j-Aaw3P6HX-or3ndJ-CD',
    retention_boundary_reached: false,
    stopped_reason: 'scan_budget',
    scan_budget: 500,
    limit: 25,
  };

  it('refuses to call an incomplete scan an absence of matches', () => {
    const summary = buildCoverageSummary(base);
    expect(summary).toMatch(/Scanned 500 job\(s\)/);
    expect(summary).toMatch(/INCOMPLETE/);
    expect(summary).toMatch(/NOT proof/);
    expect(summary).toMatch(/j-Aaw3P6HX-or3ndJ-CD/);
  });

  it('says so when the whole list was covered', () => {
    const summary = buildCoverageSummary({
      ...base,
      complete: true,
      matched: 2,
      stopped_reason: 'end_of_list',
      next_cursor: undefined,
    });
    expect(summary).toMatch(/Scan complete/);
    expect(summary).not.toMatch(/INCOMPLETE/);
  });

  it('explains the retention boundary rather than the budget', () => {
    const summary = buildCoverageSummary({
      ...base,
      complete: true,
      erased_seen: 3,
      retention_boundary_reached: true,
      stopped_reason: 'erased_boundary',
    });
    expect(summary).toMatch(/retention boundary/);
    expect(summary).toMatch(/everything older/);
  });
});
