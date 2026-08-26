/**
 * @fileoverview Tests for the Workflow App page checks — the widget index, the
 * structural rules, the diff guards, and the render verdict.
 *
 * The case that matters most is `checkAgainstPrevious` refusing the shape that
 * broke a live form: a divider deleted from a container's last row, leaving the
 * two widgets above it at row 0. The JSON stayed valid and read back perfectly;
 * the following containers lost their computed `top` and stacked at 0.
 */

import { describe, expect, it } from 'vitest';

import {
  buildWidgetIndex,
  checkAgainstPrevious,
  checkStructure,
  collectWidgetIds,
  hasErrors,
  judgeRender,
  layoutEntries,
} from '@/entrypoints/background/tools/workato-lcap/page-checks';

const widget = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  name: `${type} ${id}`,
  x: 0,
  width: 12,
  visible: true,
  ...extra,
});

/** The header container as it was BEFORE the divider was deleted. */
const headerBefore = widget('53a27648', 'container', {
  layout: [
    1,
    [widget('c646c1d5', 'text', { text: '**Time Journal Submission**' }), 0],
    [widget('a1c4e2b7', 'text', { text: 'subtitle' }), 0],
    [widget('49edbbc7', 'divider'), 1],
  ],
});

/** The same container AFTER the delete, with no renumbering. */
const headerAfter = widget('53a27648', 'container', {
  layout: [
    1,
    [widget('c646c1d5', 'text', { text: '**Time Journal Submission**' }), 0],
    [widget('a1c4e2b7', 'text', { text: 'subtitle' }), 0],
  ],
});

const pageWith = (header: unknown) => ({
  type: 'common',
  maxWidth: 'fixed',
  spacing: 'standard',
  background: { style: 'color', color: '#fafbfc' },
  variables: [{ id: 'aa00bb11', name: 'probeVar', dataType: 'string', defaultValue: '' }],
  handlers: { pageLoad: null },
  layout: [
    1,
    [header, 0],
    [
      widget('3e8a7cbc', 'container', {
        layout: [
          1,
          [widget('df1984ea', 'dropdown', { handlers: { change: null }, options: [] }), 0],
          [widget('8f3ef394', 'date', { x: 4, width: 4, handlers: { change: null } }), 0],
        ],
      }),
      1,
    ],
  ],
});

describe('layoutEntries', () => {
  it('reads [widget, row] pairs and skips the leading version marker', () => {
    const entries = layoutEntries([
      1,
      [widget('aaaaaaaa', 'text'), 0],
      [widget('bbbbbbbb', 'text'), 3],
    ]);
    expect(entries.map((e) => [e.widget.id, e.row])).toEqual([
      ['aaaaaaaa', 0],
      ['bbbbbbbb', 3],
    ]);
  });

  it('skips malformed entries rather than throwing', () => {
    expect(layoutEntries([1, ['not a widget', 0], [widget('aaaaaaaa', 'text')]])).toHaveLength(0);
  });
});

describe('buildWidgetIndex', () => {
  it('walks containers and records where each widget lives', () => {
    const index = buildWidgetIndex(pageWith(headerBefore));
    // Level order: every widget of a layout, then the children of its containers.
    expect(index.map((w) => w.id)).toEqual([
      '53a27648',
      '3e8a7cbc',
      'c646c1d5',
      'a1c4e2b7',
      '49edbbc7',
      'df1984ea',
      '8f3ef394',
    ]);
    const nested = index.find((w) => w.id === 'df1984ea')!;
    expect(nested.container).toBe('3e8a7cbc');
    expect(nested.row).toBe(0);
    const container = index.find((w) => w.id === '53a27648')!;
    expect(container.container).toBe('root');
    expect(container.children).toBe(3);
  });

  it('flags bindings and conditional visibility without carrying the tree', () => {
    const page = pageWith(
      widget('53a27648', 'container', {
        layout: [
          1,
          [
            widget('082764d7', 'table', {
              appFunctionOptions: { recipeMeta: { id: '76887741' }, input: {} },
              handlers: { activeRow: { type: 'set-value' } },
            }),
            0,
          ],
          [
            widget('14736441', 'button', { handlers: { click: null }, visible: [1, [13, 'pill']] }),
            1,
          ],
        ],
      }),
    );
    const index = buildWidgetIndex(page);
    const table = index.find((w) => w.id === '082764d7')!;
    expect(table.app_function).toBe('76887741');
    expect(table.handlers).toEqual(['activeRow']);

    const button = index.find((w) => w.id === '14736441')!;
    expect(button.conditional_visible).toBe(true);
    // handlers.click is null — a declared-but-unwired slot is not "wired".
    expect(button.handlers).toBeUndefined();
  });
});

describe('checkStructure', () => {
  it('accepts a real page', () => {
    expect(checkStructure(pageWith(headerBefore))).toEqual([]);
  });

  it('rejects a tree with no layout', () => {
    const issues = checkStructure({ type: 'common' });
    expect(issues[0].code).toBe('layout-missing');
  });

  it('rejects a layout that does not start with the constant 1', () => {
    const issues = checkStructure({ layout: [2, [widget('aaaaaaaa', 'text'), 0]] });
    expect(issues.map((i) => i.code)).toContain('layout-version-marker');
  });

  it('rejects a widget id that is not 8 lowercase hex', () => {
    const issues = checkStructure({ layout: [1, [widget('MyWidget', 'text'), 0]] });
    expect(issues.map((i) => i.code)).toContain('widget-id-shape');
  });

  it('rejects duplicate widget ids — two pills would resolve to one widget', () => {
    const issues = checkStructure({
      layout: [1, [widget('aaaaaaaa', 'text'), 0], [widget('aaaaaaaa', 'divider'), 1]],
    });
    expect(issues.map((i) => i.code)).toContain('widget-id-duplicate');
  });

  describe('visible expressions', () => {
    const withVisible = (visible: unknown) => ({
      layout: [1, [widget('aaaaaaaa', 'text', { visible }), 0]],
    });

    it('accepts the confirmed two-condition AND form', () => {
      const issues = checkStructure(
        withVisible([
          1,
          [8, `#{_dp('{"source":"widget","id":"df1984ea","path":["value"]}')}`, 'Last Month'],
          [13, `#{_dp('{"source":"widget","id":"df1984ea","path":["value"]}')}`],
        ]),
      );
      expect(issues).toEqual([]);
    });

    it('rejects an unknown opcode', () => {
      const issues = checkStructure(withVisible([1, [99, 'pill', 'x']]));
      expect(issues.map((i) => i.code)).toContain('visible-opcode-unknown');
    });

    it('rejects a binary opcode given no right operand', () => {
      const issues = checkStructure(withVisible([1, [7, 'pill']]));
      expect(issues.map((i) => i.code)).toContain('visible-arity');
    });

    it('rejects a unary opcode given a right operand', () => {
      const issues = checkStructure(withVisible([1, [13, 'pill', 'x']]));
      expect(issues.map((i) => i.code)).toContain('visible-arity');
    });

    it('rejects a combinator other than 1, since no OR form has ever been seen', () => {
      const issues = checkStructure(withVisible([2, [13, 'pill']]));
      expect(issues.map((i) => i.code)).toContain('visible-combinator');
    });

    it('leaves a plain boolean alone', () => {
      expect(checkStructure(withVisible(true))).toEqual([]);
      expect(checkStructure(withVisible(false))).toEqual([]);
    });
  });
});

describe('checkAgainstPrevious', () => {
  it('refuses the deleted-divider regression by default', () => {
    const issues = checkAgainstPrevious(pageWith(headerBefore), pageWith(headerAfter));
    expect(hasErrors(issues)).toBe(true);
    expect(issues.map((i) => i.code)).toContain('widget-removed');
    expect(issues.find((i) => i.code === 'widget-removed')!.message).toContain('49edbbc7');
  });

  it('still refuses it when the removal itself is authorised, because the rows collapsed', () => {
    const issues = checkAgainstPrevious(pageWith(headerBefore), pageWith(headerAfter), {
      allowWidgetRemoval: true,
    });
    expect(hasErrors(issues)).toBe(true);
    const collapse = issues.find((i) => i.code === 'row-collapse')!;
    expect(collapse.container).toBe('53a27648');
    expect(collapse.message).toContain('1 to 0');
  });

  it('accepts the removal once the caller opts into the collapse explicitly', () => {
    const issues = checkAgainstPrevious(pageWith(headerBefore), pageWith(headerAfter), {
      allowWidgetRemoval: true,
      allowRowCollapse: true,
    });
    expect(hasErrors(issues)).toBe(false);
  });

  it('accepts a removal that renumbers the remaining rows', () => {
    const renumbered = widget('53a27648', 'container', {
      layout: [
        1,
        [widget('c646c1d5', 'text'), 0],
        // The subtitle takes the divider's old row, so the extent is unchanged.
        [widget('a1c4e2b7', 'text'), 1],
      ],
    });
    const issues = checkAgainstPrevious(pageWith(headerBefore), pageWith(renumbered), {
      allowWidgetRemoval: true,
    });
    expect(hasErrors(issues)).toBe(false);
  });

  it('refuses when widgets that had distinct rows are merged onto one', () => {
    const merged = widget('53a27648', 'container', {
      layout: [
        1,
        [widget('c646c1d5', 'text'), 0],
        [widget('a1c4e2b7', 'text'), 0],
        [widget('49edbbc7', 'divider'), 0],
      ],
    });
    const issues = checkAgainstPrevious(pageWith(headerBefore), pageWith(merged));
    expect(issues.map((i) => i.code)).toContain('row-merge');
  });

  it('leaves side-by-side widgets that always shared a row alone', () => {
    const before = pageWith(headerBefore);
    const after = JSON.parse(JSON.stringify(before));
    expect(checkAgainstPrevious(before, after)).toEqual([]);
  });

  it('reports widgets that vanished with their whole container', () => {
    const before = pageWith(headerBefore);
    const after = { ...before, layout: [1, [headerBefore, 0]] };
    const issues = checkAgainstPrevious(before, after);
    const removed = issues.filter((i) => i.code === 'widget-removed');
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.some((i) => i.message.includes('df1984ea'))).toBe(true);
  });
});

describe('collectWidgetIds', () => {
  it('includes nested widgets', () => {
    expect(collectWidgetIds(pageWith(headerBefore))).toContain('8f3ef394');
  });
});

describe('judgeRender', () => {
  it('passes a page whose containers each carry a top', () => {
    const verdict = judgeRender([
      { text: 'header', style: 'left: 0%; top: 0px; width: 100%;', y: 0, has_top: true },
      { text: 'filters', style: 'left: 0%; top: 208px; width: 100%;', y: 208, has_top: true },
    ]);
    expect(verdict.status).toBe('passed');
    expect(verdict.issues).toEqual([]);
  });

  it('fails a container with no top — the stacking bug as it renders', () => {
    const verdict = judgeRender([
      { text: 'header', style: 'left: 0%; top: 0px; width: 100%;', y: 0, has_top: true },
      { text: 'filters', style: 'left: 0%; width: 100%;', y: 0, has_top: false },
      { text: 'preview', style: 'left: 0%; width: 100%;', y: 0, has_top: false },
    ]);
    expect(verdict.status).toBe('failed');
    expect(verdict.issues.some((i) => i.includes('no `top`'))).toBe(true);
    expect(verdict.issues.some((i) => i.includes('y=0'))).toBe(true);
  });

  it('fails two containers that share a y even when both have a top', () => {
    const verdict = judgeRender([
      { text: 'a', style: 'top: 40px;', y: 40, has_top: true },
      { text: 'b', style: 'top: 40px;', y: 40, has_top: true },
    ]);
    expect(verdict.status).toBe('failed');
  });
});
