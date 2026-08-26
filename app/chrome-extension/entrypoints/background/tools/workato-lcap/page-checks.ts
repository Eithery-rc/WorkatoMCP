/**
 * Pure checks over a Workflow App (LCAP) page tree.
 *
 * Everything here is browser-free so it can be unit-tested directly, and so
 * `workato_lcap_page_save` and `workato_lcap_page_validate` run the SAME check
 * bodies rather than two drifting copies.
 *
 * The failure this module exists for: a page's `layout` is
 * `[1, [widget, N], [widget, N], ...]` where N is a row index, and the renderer
 * turns rows into absolute `top:` pixels. Delete a widget without renumbering
 * and a container's row extent can collapse; every container after it then
 * loses its computed `top` and they all stack at 0. The PUT returns ok, the GET
 * reads back exactly what was written, and the page's text still lists every
 * section in order. Only the rendered geometry shows it — which is why the save
 * tool pairs these static checks with a post-save render probe.
 *
 * Format reference: skills/workato-recipes/workflow-apps.md.
 */

export type IssueSeverity = 'error' | 'warning';

export interface LcapIssue {
  /** Machine-readable check name, e.g. 'row-collapse'. */
  code: string;
  severity: IssueSeverity;
  /** Widget this is about, when it is about one widget. */
  widget_id?: string;
  /** Layout the widget lives in: a container's id, or 'root' for page level. */
  container?: string;
  message: string;
}

export interface WidgetIndexEntry {
  id: string;
  type: string;
  name?: string;
  x?: number;
  width?: number;
  /** Row position inside its layout. */
  row: number;
  /** Owning layout: a container id, or 'root'. */
  container: string;
  /** Handler slots that are non-null, e.g. ['click']. */
  handlers?: string[];
  /** Bound app-function recipe id, when the widget has one. */
  app_function?: string;
  /** True when `visible` is an expression array rather than a bare boolean. */
  conditional_visible?: boolean;
  /** Child count, containers only. */
  children?: number;
}

/** Conditional-visibility opcodes, confirmed one by one against the builder. */
export const VISIBLE_OPCODES: Record<number, { operator: string; arity: 'binary' | 'unary' }> = {
  1: { operator: 'Contains', arity: 'binary' },
  2: { operator: "Doesn't contain", arity: 'binary' },
  3: { operator: 'Starts with', arity: 'binary' },
  4: { operator: "Doesn't start with", arity: 'binary' },
  5: { operator: 'Ends with', arity: 'binary' },
  6: { operator: "Doesn't end with", arity: 'binary' },
  7: { operator: 'Equals', arity: 'binary' },
  8: { operator: 'Does not equal', arity: 'binary' },
  9: { operator: 'Greater than', arity: 'binary' },
  10: { operator: 'Less than', arity: 'binary' },
  11: { operator: 'Is true', arity: 'unary' },
  12: { operator: 'Is not true', arity: 'unary' },
  13: { operator: 'Is present', arity: 'unary' },
  14: { operator: 'Is not present', arity: 'unary' },
};

/** The only combinator ever observed in a `visible` expression (AND). */
export const VISIBLE_COMBINATOR = 1;

/** Handler slots a widget can carry, by widget type. */
const HANDLER_SLOTS = ['click', 'change', 'activeRow'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** One `[widget, row]` pair out of a `layout` array. */
export interface LayoutEntry {
  widget: Record<string, unknown>;
  row: number;
  /** Position within the layout array, for error messages about malformed entries. */
  index: number;
}

/**
 * Read the `[1, [widget, N], ...]` entries out of a layout.
 *
 * Malformed entries are skipped here and reported separately by
 * `checkStructure`, so the index and diff walks never have to re-validate.
 */
export function layoutEntries(layout: unknown): LayoutEntry[] {
  if (!Array.isArray(layout)) return [];
  const out: LayoutEntry[] = [];
  for (let i = 1; i < layout.length; i++) {
    const entry = layout[i];
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const widget = entry[0];
    const row = entry[1];
    if (!isRecord(widget) || typeof row !== 'number') continue;
    out.push({ widget, row, index: i });
  }
  return out;
}

/** Walk every layout in a page, parents before children. */
function walkLayouts(
  content: unknown,
  visit: (containerId: string, entries: LayoutEntry[], layout: unknown) => void,
): void {
  const walk = (layout: unknown, containerId: string): void => {
    const entries = layoutEntries(layout);
    visit(containerId, entries, layout);
    for (const entry of entries) {
      if (entry.widget.type === 'container') {
        const id = typeof entry.widget.id === 'string' ? entry.widget.id : '<no id>';
        walk(entry.widget.layout, id);
      }
    }
  };
  walk(isRecord(content) ? content.layout : undefined, 'root');
}

/**
 * Flat index of every widget on the page.
 *
 * This is what `workato_lcap_page_get` returns instead of the tree: a real page
 * is 6 KB+ of JSON and almost every read only needs to know what is on the page
 * and which widget carries which binding.
 */
export function buildWidgetIndex(content: unknown): WidgetIndexEntry[] {
  const out: WidgetIndexEntry[] = [];
  walkLayouts(content, (containerId, entries) => {
    for (const { widget, row } of entries) {
      const entry: WidgetIndexEntry = {
        id: typeof widget.id === 'string' ? widget.id : '<no id>',
        type: typeof widget.type === 'string' ? widget.type : '<no type>',
        row,
        container: containerId,
      };
      if (typeof widget.name === 'string') entry.name = widget.name;
      if (typeof widget.x === 'number') entry.x = widget.x;
      if (typeof widget.width === 'number') entry.width = widget.width;

      const handlers = isRecord(widget.handlers)
        ? HANDLER_SLOTS.filter((slot) => (widget.handlers as Record<string, unknown>)[slot] != null)
        : [];
      if (handlers.length > 0) entry.handlers = handlers;

      const afo = widget.appFunctionOptions;
      if (isRecord(afo) && isRecord(afo.recipeMeta) && afo.recipeMeta.id != null) {
        entry.app_function = String(afo.recipeMeta.id);
      }
      if (Array.isArray(widget.visible)) entry.conditional_visible = true;
      if (widget.type === 'container') entry.children = layoutEntries(widget.layout).length;

      out.push(entry);
    }
  });
  return out;
}

/** Every widget id in the tree, in layout order (duplicates included). */
export function collectWidgetIds(content: unknown): string[] {
  return buildWidgetIndex(content).map((w) => w.id);
}

/**
 * Structural checks that do not need a previous version to compare against:
 * layout shape, widget ids, and `visible` expressions.
 */
export function checkStructure(content: unknown): LcapIssue[] {
  const issues: LcapIssue[] = [];

  if (!isRecord(content)) {
    return [
      {
        code: 'content-not-object',
        severity: 'error',
        message: 'Page content must be an object with a `layout` array.',
      },
    ];
  }
  if (!Array.isArray(content.layout)) {
    return [
      {
        code: 'layout-missing',
        severity: 'error',
        message:
          'Page content has no `layout` array. Expected [1, [widget, row], ...] — an empty page ' +
          'is `[1]`.',
      },
    ];
  }

  walkLayouts(content, (containerId, entries, layout) => {
    const raw = layout as unknown[];
    if (raw[0] !== 1) {
      issues.push({
        code: 'layout-version-marker',
        severity: 'error',
        container: containerId,
        message:
          `Layout of ${containerId} starts with ${JSON.stringify(raw[0])}; every layout ever ` +
          'observed starts with the constant 1.',
      });
    }
    for (let i = 1; i < raw.length; i++) {
      const entry = raw[i];
      const ok = Array.isArray(entry) && entry.length >= 2 && isRecord(entry[0]);
      if (!ok || typeof (entry as unknown[])[1] !== 'number') {
        issues.push({
          code: 'layout-entry-malformed',
          severity: 'error',
          container: containerId,
          message:
            `Layout entry ${i} of ${containerId} is not [widgetObject, rowNumber]: ` +
            `${JSON.stringify(entry).slice(0, 120)}`,
        });
      }
    }
    for (const { widget } of entries) {
      const id = widget.id;
      if (typeof id !== 'string' || !/^[0-9a-f]{8}$/.test(id)) {
        issues.push({
          code: 'widget-id-shape',
          severity: 'error',
          container: containerId,
          widget_id: typeof id === 'string' ? id : undefined,
          message:
            `Widget id ${JSON.stringify(id)} is not 8 lowercase hex characters. Ids are the ` +
            'address every datapill uses; mint a new one in that alphabet.',
        });
      }
      if (typeof widget.type !== 'string') {
        issues.push({
          code: 'widget-type-missing',
          severity: 'error',
          container: containerId,
          widget_id: typeof id === 'string' ? id : undefined,
          message: 'Widget has no `type`.',
        });
      }
      issues.push(...checkVisibleExpression(widget, containerId));
    }
  });

  const seen = new Set<string>();
  for (const id of collectWidgetIds(content)) {
    if (seen.has(id)) {
      issues.push({
        code: 'widget-id-duplicate',
        severity: 'error',
        widget_id: id,
        message:
          `Widget id ${id} appears more than once. Datapills address widgets by id, so a ` +
          'duplicate silently points at whichever one the renderer reaches first.',
      });
    }
    seen.add(id);
  }

  return issues;
}

/**
 * Validate one widget's `visible`.
 *
 * `true` (or `false`) is always fine. An expression array is
 * `[combinator, [opcode, lhs, rhs?], ...]`, where the opcode table and each
 * opcode's arity were confirmed against the builder — an unknown opcode or the
 * wrong arity is a value nobody has ever seen Workato write, so refuse rather
 * than ship a page whose widget may never appear.
 */
export function checkVisibleExpression(
  widget: Record<string, unknown>,
  containerId: string,
): LcapIssue[] {
  const visible = widget.visible;
  if (visible === undefined || typeof visible === 'boolean') return [];

  const widgetId = typeof widget.id === 'string' ? widget.id : undefined;
  const at = (code: string, message: string): LcapIssue => ({
    code,
    severity: 'error',
    container: containerId,
    widget_id: widgetId,
    message,
  });

  if (!Array.isArray(visible)) {
    return [
      at(
        'visible-shape',
        `\`visible\` must be true/false or an expression array, got ${typeof visible}.`,
      ),
    ];
  }
  const issues: LcapIssue[] = [];
  if (visible[0] !== VISIBLE_COMBINATOR) {
    issues.push(
      at(
        'visible-combinator',
        `\`visible\` starts with ${JSON.stringify(visible[0])}; the only combinator ever ` +
          'observed is 1 (AND). No OR form is known, so do not invent one.',
      ),
    );
  }
  for (let i = 1; i < visible.length; i++) {
    const condition = visible[i];
    if (!Array.isArray(condition) || condition.length < 2) {
      issues.push(
        at(
          'visible-condition-shape',
          `\`visible\` condition ${i} is not [opcode, lhs, rhs?]: ` +
            `${JSON.stringify(condition).slice(0, 120)}`,
        ),
      );
      continue;
    }
    const opcode = condition[0];
    const spec = typeof opcode === 'number' ? VISIBLE_OPCODES[opcode] : undefined;
    if (!spec) {
      issues.push(
        at(
          'visible-opcode-unknown',
          `\`visible\` condition ${i} uses opcode ${JSON.stringify(opcode)}. Known opcodes are ` +
            '1-14 (1 Contains … 14 Is not present).',
        ),
      );
      continue;
    }
    const wanted = spec.arity === 'binary' ? 3 : 2;
    if (condition.length !== wanted) {
      issues.push(
        at(
          'visible-arity',
          `\`visible\` condition ${i} is opcode ${opcode} (${spec.operator}, ${spec.arity}) and ` +
            `needs ${wanted} elements, got ${condition.length}.`,
        ),
      );
    }
    if (typeof condition[1] !== 'string') {
      issues.push(
        at(
          'visible-lhs',
          `\`visible\` condition ${i} has a non-string left operand. It should be a datapill ` +
            'string such as #{_dp(\'{"source":"widget","id":"df1984ea","path":["value"]}\')}.',
        ),
      );
    }
  }
  return issues;
}

/** The layout grid is 12 columns wide; widths that sum past it overlap. */
const GRID_COLUMNS = 12;

/** Where a widget sits in its layout: which row, and how many columns it takes. */
interface Placement {
  row: number;
  width: number;
}

/** Placement map for one layout: widget id -> {row, width}. */
function placementsByContainer(content: unknown): Map<string, Map<string, Placement>> {
  const out = new Map<string, Map<string, Placement>>();
  walkLayouts(content, (containerId, entries) => {
    const rows = out.get(containerId) ?? new Map<string, Placement>();
    for (const { widget, row } of entries) {
      if (typeof widget.id !== 'string') continue;
      const width = typeof widget.width === 'number' ? widget.width : GRID_COLUMNS;
      rows.set(widget.id, { row, width });
    }
    out.set(containerId, rows);
  });
  return out;
}

/** Total columns occupied by everything sitting on one row of a layout. */
function rowWidth(placements: Map<string, Placement>, row: number): number {
  let total = 0;
  for (const placement of placements.values()) {
    if (placement.row === row) total += placement.width;
  }
  return total;
}

export interface DiffCheckOptions {
  /** Permit widgets present in `prev` to be absent from `next`. */
  allowWidgetRemoval?: boolean;
  /** Permit a layout's row extent (max row) to shrink after a removal. */
  allowRowCollapse?: boolean;
}

/**
 * Compare the tree about to be saved against the one currently stored.
 *
 * Three guards, all learned from the same incident:
 *
 *  - **Widget ids must survive.** An id is the address datapills use, so a
 *    dropped widget silently empties every pill pointing at it.
 *  - **Rows must be renumbered after a removal.** Removing the widget that
 *    occupied a layout's last row collapses that layout's extent, and the
 *    containers after it lose their `top`. Refused by default because the
 *    symptom appears only in rendered geometry.
 *  - **A merged row must still fit the 12 column grid.** Moving widgets onto
 *    one row is ordinary layout work and is allowed; widths that sum past 12
 *    are not, because the widgets overlap and the height collapses.
 */
export function checkAgainstPrevious(
  prev: unknown,
  next: unknown,
  options: DiffCheckOptions = {},
): LcapIssue[] {
  const issues: LcapIssue[] = [];
  const prevRows = placementsByContainer(prev);
  const nextRows = placementsByContainer(next);
  const nextIds = new Set(collectWidgetIds(next));

  for (const [containerId, before] of prevRows) {
    const after = nextRows.get(containerId);
    if (!after) {
      // The whole container is gone; the id guard below reports its widgets.
      continue;
    }

    const removed = [...before.keys()].filter((id) => !nextIds.has(id));
    const retained = [...before.keys()].filter((id) => after.has(id));

    if (removed.length > 0 && !options.allowWidgetRemoval) {
      issues.push({
        code: 'widget-removed',
        severity: 'error',
        container: containerId,
        widget_id: removed[0],
        message:
          `Widget(s) ${removed.join(', ')} present in the stored page are missing from the tree ` +
          'being saved. Datapills address widgets by id, so anything pointing at them resolves ' +
          'to empty. Pass allow_widget_removal:true if the deletion is intended.',
      });
    }

    // Widgets that had distinct rows may end up sharing one: putting fields side
    // by side is ordinary layout work, and the live forms are built that way
    // (three 4-wide fields on one row). It only breaks when the row overflows the
    // 12 column grid, because the widgets then overlap, the layout's height
    // collapses, and everything after it can lose its computed `top`. So judge
    // the merged row by its width, not by the fact that a merge happened.
    const mergedRows = new Set<number>();
    for (const id of retained) {
      const rowBefore = before.get(id)?.row;
      const rowAfter = after.get(id)?.row;
      if (rowBefore === undefined || rowAfter === undefined) continue;
      const joined = retained.some(
        (other) =>
          other !== id &&
          before.get(other)?.row !== rowBefore &&
          after.get(other)?.row === rowAfter,
      );
      if (joined) mergedRows.add(rowAfter);
    }

    for (const row of [...mergedRows].sort((a, b) => a - b)) {
      const total = rowWidth(after, row);
      if (total <= GRID_COLUMNS) continue;
      issues.push({
        code: 'row-merge',
        severity: 'error',
        container: containerId,
        message:
          `In ${containerId}, row ${row} now carries ${total} columns of widgets after a merge, ` +
          `over the ${GRID_COLUMNS} column grid. They will overlap, which collapses the layout's ` +
          "height and can drop the computed `top` of everything after it. Give the row's widgets " +
          `widths summing to ${GRID_COLUMNS} or fewer, or keep them on separate rows.`,
      });
    }

    if (removed.length > 0) {
      const maxBefore = Math.max(-1, ...[...before.values()].map((p) => p.row));
      const maxAfter = Math.max(-1, ...[...after.values()].map((p) => p.row));
      if (maxAfter < maxBefore && !options.allowRowCollapse) {
        issues.push({
          code: 'row-collapse',
          severity: 'error',
          container: containerId,
          message:
            `Removing ${removed.join(', ')} shrinks ${containerId}'s row extent from ` +
            `${maxBefore} to ${maxAfter} without renumbering. This is the exact shape that ` +
            'broke a live form: the container lost its computed `top` and every container after ' +
            'it stacked at 0, while the JSON read back correctly. Renumber the remaining rows, ' +
            'or pass allow_row_collapse:true and check the render result.',
        });
      }
    }
  }

  // Ids that vanished along with their whole container.
  const prevIds = collectWidgetIds(prev);
  const orphaned = prevIds.filter((id) => !nextIds.has(id));
  if (orphaned.length > 0 && !options.allowWidgetRemoval) {
    const already = new Set(
      issues.filter((i) => i.code === 'widget-removed').map((i) => i.message),
    );
    const unreported = orphaned.filter((id) => ![...already].some((m) => m.includes(id)));
    if (unreported.length > 0) {
      issues.push({
        code: 'widget-removed',
        severity: 'error',
        widget_id: unreported[0],
        message:
          `Widget(s) ${unreported.join(', ')} present in the stored page are missing from the ` +
          'tree being saved. Pass allow_widget_removal:true if the deletion is intended.',
      });
    }
  }

  return issues;
}

/** Convenience: does this issue list block a save? */
export function hasErrors(issues: LcapIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** Human-readable refusal text for a blocked save. */
export function describeIssues(issues: LcapIssue[]): string {
  return issues
    .map((i) => {
      const where = [i.container, i.widget_id].filter(Boolean).join(' / ');
      return `  [${i.severity}] ${i.code}${where ? ` (${where})` : ''}: ${i.message}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Render probe results
// ---------------------------------------------------------------------------

export interface RenderedWidget {
  /** First line of the widget's text, for identifying it in a report. */
  text: string;
  style: string;
  /** Rounded bounding-box y. */
  y: number;
  /** True when the inline style carries a `top:`. */
  has_top: boolean;
}

export interface RenderCheckResult {
  status: 'passed' | 'failed';
  widget_count: number;
  issues: string[];
}

/**
 * Judge a rendered page.
 *
 * The two symptoms of the collapse, checked against the DOM because the JSON
 * is valid in this failure mode and therefore proves nothing: a top level
 * container with no `top:` in its inline style, and two containers sharing a
 * bounding-box y.
 */
export function judgeRender(widgets: RenderedWidget[]): RenderCheckResult {
  const issues: string[] = [];
  for (const w of widgets) {
    if (!w.has_top) {
      issues.push(
        `Top level widget "${w.text}" has no \`top\` in its inline style (${w.style}). It will ` +
          'render at 0 and overlap whatever is above it.',
      );
    }
  }
  const byY = new Map<number, RenderedWidget[]>();
  for (const w of widgets) {
    const bucket = byY.get(w.y) ?? [];
    bucket.push(w);
    byY.set(w.y, bucket);
  }
  for (const [y, bucket] of byY) {
    if (bucket.length > 1) {
      issues.push(
        `Top level widgets ${bucket.map((w) => `"${w.text}"`).join(', ')} all render at y=${y}. ` +
          'They are stacked on top of each other.',
      );
    }
  }
  return {
    status: issues.length === 0 ? 'passed' : 'failed',
    widget_count: widgets.length,
    issues,
  };
}
