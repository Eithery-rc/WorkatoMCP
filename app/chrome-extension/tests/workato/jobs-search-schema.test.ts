/**
 * @fileoverview Schema contract tests for the four tools Delivery 3 changed:
 * workato_list_jobs, workato_job_trace, workato_search_recipes and
 * workato_recipe_step_search.
 *
 * The description is the only documentation an agent sees at call time, so the
 * assertions here cover the claims that were WRONG before (query semantics, a
 * name-substring recipe search) as well as the new parameters. Descriptions
 * also have to stay inside the served budget: the bridge appends a `profile`
 * property and the client caps a served description at 2 KB.
 */

import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'workatomcp-shared';

function schemaFor(name: string) {
  return TOOL_SCHEMAS.find((tool) => tool.name === name);
}

function props(name: string): Record<string, any> {
  const schema = schemaFor(name);
  return (schema?.inputSchema as { properties?: Record<string, any> })?.properties ?? {};
}

describe('workato_list_jobs schema', () => {
  it('offers every started_at preset Workato actually honours', () => {
    expect(props(TOOL_NAMES.WORKATO.LIST_JOBS).started_at.enum).toEqual([
      '1.hour',
      '24.hours',
      '7.days',
      '30.days',
      'all',
    ]);
  });

  it('exposes the custom date range with a timezone', () => {
    const p = props(TOOL_NAMES.WORKATO.LIST_JOBS);
    expect(p.started_from).toMatchObject({ type: 'string' });
    expect(p.started_to).toMatchObject({ type: 'string' });
    expect(p.timezone).toMatchObject({ type: 'string', default: 'UTC' });
    expect(p.started_from.description).toMatch(/started_at_from/);
    expect(p.started_to.description).toMatch(/started_at_to/);
  });

  it('describes the local scan with its own budget and modes', () => {
    const p = props(TOOL_NAMES.WORKATO.LIST_JOBS);
    expect(p.match.type).toBe('object');
    expect(p.match.properties.mode.enum).toEqual(['exact', 'substring', 'regex']);
    expect(p.match.required).toEqual(['value']);
    expect(p.scan_budget).toMatchObject({ type: 'number', default: 500 });
    expect(p.scan_budget.description).toMatch(/SCANNED/);
    expect(p.stop_on_erased).toMatchObject({ type: 'boolean', default: true });
  });

  it('corrects the query description: no error text, no erased job', () => {
    const p = props(TOOL_NAMES.WORKATO.LIST_JOBS);
    expect(p.query.description).toMatch(/SUBSTRING/);
    expect(p.query.description).toMatch(/job id/);
    expect(p.query.description).toMatch(/NOT match the error message/);
    // The pre-2026-09 wording promised full-text matching of the error message.
    expect(p.query.description).not.toMatch(/Full-text search against job title and error/);
  });

  it('says erased is unavailable data and the walk stops at the boundary', () => {
    const description = schemaFor(TOOL_NAMES.WORKATO.LIST_JOBS)?.description ?? '';
    expect(description).toMatch(/erased:true/);
    expect(description).toMatch(/unavailable, not empty/);
    expect(description).toMatch(/3 consecutive erased jobs/);
    expect(description).toMatch(/coverage/);
    expect(description).toMatch(/next_cursor/);
  });

  it('offers a field projection over the slim job', () => {
    const p = props(TOOL_NAMES.WORKATO.LIST_JOBS);
    expect(p.fields).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(p.fields.description).toMatch(/report\.<label>/);
    expect(p.report_labels).toMatchObject({ type: 'boolean', default: true });
  });
});

describe('workato_job_trace schema', () => {
  it('exposes nested path projection, the empty policy and array previews', () => {
    const p = props(TOOL_NAMES.WORKATO.JOB_TRACE);
    expect(p.paths).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(p.empty).toMatchObject({ type: 'string', enum: ['keep', 'drop'], default: 'keep' });
    expect(p.max_items).toMatchObject({ type: 'number', default: 20 });
    expect(p.fields).toMatchObject({ type: 'array', items: { type: 'string' } });
  });

  it('documents the empty policy as preserving 0, false and array indices', () => {
    const p = props(TOOL_NAMES.WORKATO.JOB_TRACE);
    expect(p.empty.description).toMatch(/0 and false are data/);
    expect(p.empty.description).toMatch(/never\s+filtered/);
    expect(p.paths.description).toMatch(/indices/);
  });
});

describe('workato_search_recipes schema', () => {
  it('stops calling text a name substring match', () => {
    const description = schemaFor(TOOL_NAMES.WORKATO.SEARCH_RECIPES)?.description ?? '';
    expect(description).toMatch(/FULL-TEXT/);
    expect(description).toMatch(/description AND its trigger\/action titles/);
    expect(description).not.toMatch(/name substring match across the workspace/);
    expect(props(TOOL_NAMES.WORKATO.SEARCH_RECIPES).text.description).not.toMatch(
      /^Name substring search/,
    );
  });

  it('offers the client-side match modes and the app/running filters', () => {
    const p = props(TOOL_NAMES.WORKATO.SEARCH_RECIPES);
    expect(p.match.enum).toEqual([
      'fulltext',
      'name_substring',
      'name_word',
      'name_exact',
      'name_regex',
    ]);
    expect(p.match.default).toBe('fulltext');
    expect(p.app).toBeDefined();
    expect(p.running).toMatchObject({ type: 'boolean' });
    expect(p.folder_id).toMatchObject({ type: 'number' });
    expect(p.running.description).toMatch(/[Cc]lient-side/);
  });

  it('bounds the page walk and reports coverage', () => {
    const p = props(TOOL_NAMES.WORKATO.SEARCH_RECIPES);
    expect(p.max_pages).toMatchObject({ type: 'number', default: 5 });
    expect(p.limit).toMatchObject({ type: 'number', default: 20 });
    expect(p.sort.enum).toContain('relevance');
    expect(schemaFor(TOOL_NAMES.WORKATO.SEARCH_RECIPES)?.description).toMatch(/coverage/);
  });
});

describe('workato_recipe_step_search schema', () => {
  it('exposes the folder and recipe scopes', () => {
    const p = props(TOOL_NAMES.WORKATO.RECIPE_STEP_SEARCH);
    expect(p.folder_ids).toMatchObject({ type: 'array', items: { type: 'number' } });
    expect(p.recipe_ids).toMatchObject({ type: 'array', items: { type: 'number' } });
    expect(p.folder_ids.description).toMatch(/non-recursive/);
    expect(p.recipe_ids.description).toMatch(/skip the list scan/);
  });

  it('exposes the input query and its preview bound', () => {
    const p = props(TOOL_NAMES.WORKATO.RECIPE_STEP_SEARCH);
    expect(p.input_query).toMatchObject({ type: 'string' });
    expect(p.input_match).toMatchObject({
      type: 'string',
      enum: ['substring', 'regex'],
      default: 'substring',
    });
    expect(p.preview_chars).toMatchObject({ type: 'number', default: 2000 });
  });

  it('promises coverage rather than a silent partial scan', () => {
    expect(schemaFor(TOOL_NAMES.WORKATO.RECIPE_STEP_SEARCH)?.description).toMatch(
      /`coverage` says whether the scan finished/,
    );
  });
});

describe('served description budget', () => {
  const changed = [
    TOOL_NAMES.WORKATO.LIST_JOBS,
    TOOL_NAMES.WORKATO.JOB_TRACE,
    TOOL_NAMES.WORKATO.SEARCH_RECIPES,
    TOOL_NAMES.WORKATO.RECIPE_STEP_SEARCH,
  ];

  it.each(changed)('keeps %s under 1500 description bytes', (name) => {
    const description = schemaFor(name)?.description ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(new TextEncoder().encode(description).length).toBeLessThanOrEqual(1500);
  });

  it.each(changed)('declares %s as an object schema with no new required param', (name) => {
    const schema = schemaFor(name);
    expect(schema?.inputSchema.type).toBe('object');
    const required = (schema?.inputSchema as { required?: string[] }).required ?? [];
    // Delivery 3 only ADDS optional parameters: an existing call must keep working.
    expect(required.every((key) => ['recipe_id', 'job_id', 'provider'].includes(key))).toBe(true);
  });
});
