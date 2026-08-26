import { describe, expect, test } from '@jest/globals';

import {
  buildDatapillPayload,
  handleWorkatoDatapillCall,
  isWorkatoDatapillTool,
  normalizePathInput,
  renderDatapill,
} from './workato-datapill';

const parse = (result: any): any => JSON.parse(result.content[0].text);

describe('renderDatapill', () => {
  test('serializes compactly — the byte-exact match Workato needs', () => {
    const payload = { pill_type: 'output', provider: 'p', line: 'L', path: ['a', 'b'] };
    expect(renderDatapill(payload)).toBe(
      `#{_dp('{"pill_type":"output","provider":"p","line":"L","path":["a","b"]}')}`,
    );
    expect(renderDatapill(payload)).not.toContain(', ');
    expect(renderDatapill(payload)).not.toContain('": ');
  });

  test('formula mode drops the #{} wrapper', () => {
    const out = renderDatapill({ source: 'widget', id: 'df1984ea', path: ['value'] }, 'formula');
    expect(out).toBe(`_dp('{"source":"widget","id":"df1984ea","path":["value"]}')`);
    expect(out.startsWith('#{')).toBe(false);
  });

  test('escapes a single quote so the literal stays closed', () => {
    const out = renderDatapill({ path: ["it's"] } as any);
    expect(out).toContain("\\'");
    expect(out.endsWith("')}")).toBe(true);
  });
});

describe('normalizePathInput', () => {
  test('expands the array accessors', () => {
    expect(normalizePathInput('rows[]', 'path')).toEqual([
      'rows',
      { path_element_type: 'current_item' },
    ]);
    expect(normalizePathInput('records#size', 'path')).toEqual([
      'records',
      { path_element_type: 'size' },
    ]);
    expect(normalizePathInput('output.rows[].employee', 'path')).toEqual([
      'output',
      'rows',
      { path_element_type: 'current_item' },
      'employee',
    ]);
  });

  test('passes explicit accessor objects through untouched', () => {
    expect(normalizePathInput(['rows', { path_element_type: 'size' }], 'path')).toEqual([
      'rows',
      { path_element_type: 'size' },
    ]);
  });

  test('rejects an unusable path', () => {
    expect(() => normalizePathInput(42, 'path')).toThrow(/dotted string or an array/);
    expect(() => normalizePathInput([true], 'path')).toThrow(/strings, numbers, or objects/);
  });
});

describe('buildDatapillPayload', () => {
  test('recipe dialect from explicit parts', () => {
    expect(
      buildDatapillPayload({ provider: 'salesforce', line: '9ad56b78', path: 'records[].Id' }),
    ).toEqual({
      pill_type: 'output',
      provider: 'salesforce',
      line: '9ad56b78',
      path: ['records', { path_element_type: 'current_item' }, 'Id'],
    });
  });

  test('recipe dialect from shorthand, matching the mutator tools', () => {
    expect(buildDatapillPayload({ shorthand: 'py_eval.84767f5e.output.rows#size' })).toEqual({
      pill_type: 'output',
      provider: 'py_eval',
      line: '84767f5e',
      path: ['output', 'rows', { path_element_type: 'size' }],
    });
  });

  test('job_context carries no step address', () => {
    expect(buildDatapillPayload({ pill_type: 'job_context', path: 'job_id' })).toEqual({
      pill_type: 'job_context',
      path: ['job_id'],
    });
  });

  test('widget dialect, inferred from widget_id, defaulting to value', () => {
    expect(buildDatapillPayload({ widget_id: 'df1984ea' })).toEqual({
      source: 'widget',
      id: 'df1984ea',
      path: ['value'],
    });
  });

  test('page-variable dialect uses source page-variable, not widget', () => {
    expect(buildDatapillPayload({ variable_id: '135a4f74' })).toEqual({
      source: 'page-variable',
      id: '135a4f74',
      path: ['value'],
    });
    // The exact literal the builder writes when a page variable is dropped in.
    expect(renderDatapill(buildDatapillPayload({ variable_id: '135a4f74' }))).toBe(
      `#{_dp('{"source":"page-variable","id":"135a4f74","path":["value"]}')}`,
    );
    expect(buildDatapillPayload({ kind: 'variable', variable_id: 'AB12CD34' }).id).toBe('ab12cd34');
  });

  test('refuses the mistakes that produce a silently empty pill', () => {
    expect(() => buildDatapillPayload({ kind: 'widget', widget_id: 'Range type' })).toThrow(
      /8-hex-character id/,
    );
    expect(() => buildDatapillPayload({ kind: 'variable', variable_id: 'nope' })).toThrow(
      /variable_id must be/,
    );
    expect(() => buildDatapillPayload({ provider: 'salesforce', path: 'x' })).toThrow(
      /line is required/,
    );
    expect(() => buildDatapillPayload({ line: '9ad56b78', path: 'x' })).toThrow(
      /provider is required/,
    );
    expect(() => buildDatapillPayload({ provider: 'p', line: 'L' })).toThrow(
      /dotted string or an array/,
    );
    expect(() => buildDatapillPayload({ kind: 'nonsense' })).toThrow(
      /must be "recipe", "widget" or "variable"/,
    );
  });
});

describe('handleWorkatoDatapillCall', () => {
  test('returns the literal plus the payload it encodes', () => {
    const result = handleWorkatoDatapillCall('workato_datapill', {
      provider: 'workato_recipe_function',
      line: 'a1b2c3d4',
      path: 'parameters.RangeType',
    });
    expect(result.isError).toBe(false);
    const body = parse(result);
    expect(body.datapill).toBe(
      `#{_dp('{"pill_type":"output","provider":"workato_recipe_function","line":"a1b2c3d4","path":["parameters","RangeType"]}')}`,
    );
    expect(body.mode).toBe('interpolated');
    expect(body.payload.path).toEqual(['parameters', 'RangeType']);
  });

  test('formula mode is reflected in the hint', () => {
    const body = parse(
      handleWorkatoDatapillCall('workato_datapill', {
        widget_id: 'df1984ea',
        mode: 'formula',
      }),
    );
    expect(body.datapill.startsWith("_dp('")).toBe(true);
    expect(body.hint).toMatch(/formula-mode/);
  });

  test('rejects an unknown mode and reports build errors', () => {
    const badMode = handleWorkatoDatapillCall('workato_datapill', {
      widget_id: 'df1984ea',
      mode: 'x',
    });
    expect(badMode.isError).toBe(true);
    expect((badMode.content[0] as any).text).toMatch(/mode must be/);

    const bad = handleWorkatoDatapillCall('workato_datapill', { provider: 'p' });
    expect(bad.isError).toBe(true);

    expect(handleWorkatoDatapillCall('other_tool', {}).isError).toBe(true);
  });

  test('isWorkatoDatapillTool matches only its own tool', () => {
    expect(isWorkatoDatapillTool('workato_datapill')).toBe(true);
    expect(isWorkatoDatapillTool('workato_recipe_map_datapill')).toBe(false);
  });
});
