/**
 * Pure formatter: a flat CDP Accessibility.AXNode list becomes an indented
 * text tree in which every element worth acting on carries [uid=N] and its
 * state (value, checked, expanded, selected, disabled, focused, required,
 * invalid, level, url, select options).
 *
 * The uid itself comes from the caller (assignUid), which keeps it stable per
 * DOM node across snapshots; this module only decides WHICH nodes get one.
 *
 * What is actionable:
 *   - the interactive ARIA roles below (roles borrowed from chrome-devtools-mcp);
 *   - with layout facts (DomInfo from DOMSnapshot): the root element of a
 *     cursor:pointer area (a clickable div with no role, e.g. Workato's
 *     body-level popover items), and text inside a cursor:pointer element;
 *   - without layout facts: a StaticText that is not the label of an
 *     interactive parent (the older heuristic, noisier but role-free).
 * Nothing inside an element that already has a uid gets another one, except
 * form controls (a checkbox inside a clickable row stays addressable).
 */

import type { AXNode, DomInfo } from './types';

const INTERACTIVE_ROLES = new Set<string>([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'slider',
  'spinbutton',
  'option',
  'listbox',
  'treeitem',
  'PopUpButton',
]);

/** Controls that stay addressable even inside another uid'd element. */
const FORM_CONTROL_ROLES = new Set<string>([
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'listbox',
  'PopUpButton',
]);

const VALUE_ROLES = new Set<string>([
  'textbox',
  'searchbox',
  'combobox',
  'spinbutton',
  'slider',
  'PopUpButton',
]);

const CHECKABLE_ROLES = new Set<string>([
  'checkbox',
  'radio',
  'switch',
  'menuitemcheckbox',
  'menuitemradio',
]);

const OPTION_ROLES = new Set<string>(['option', 'MenuListOption']);

const SKIP_RENDER_ROLES = new Set<string>(['generic', 'none', 'presentation', 'InlineTextBox']);

const MAX_NAME_LEN = 80;
const MAX_VALUE_LEN = 80;
const MAX_URL_LEN = 120;
const OPTIONS_PREVIEW = 4;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function normalizeRole(role: AXNode['role']): string {
  if (typeof role === 'string') return role;
  return role?.value ?? '';
}

function normalizeName(name: AXNode['name']): string {
  if (typeof name === 'string') return name;
  return (name?.value ?? '').toString();
}

function normalizeValue(value: AXNode['value']): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  const v = value.value;
  return v === undefined || v === null ? '' : String(v);
}

function propMap(node: AXNode): Map<string, any> {
  const m = new Map<string, any>();
  for (const p of node.properties ?? []) m.set(p.name, p.value?.value);
  return m;
}

export interface FormatOptions {
  /** Stable uid for a node of this tree's frame. */
  assignUid: (backendNodeId: number) => number;
  /** Layout facts; null falls back to the role-only heuristic. */
  dom?: DomInfo | null;
  /** Indent every line by this many levels (frames nested under a header). */
  indentBase?: number;
}

export interface FormatResult {
  text: string;
  /** uids in this rendering, in document order. */
  uids: number[];
  /** backendNodeIds rendered with a uid, keyed by uid. */
  uidToBackendNodeId: Map<number, number>;
  /** backendNodeIds seen in this tree (to detect a frame already rendered). */
  backendNodeIds: Set<number>;
}

/** State words for one node, e.g. ` value="a@b" checked=false focused required`. */
function stateSuffix(
  node: AXNode,
  role: string,
  props: Map<string, any>,
  dom?: DomInfo | null,
): string {
  const out: string[] = [];
  const backendId = node.backendDOMNodeId;
  if (VALUE_ROLES.has(role)) {
    const raw = clean(normalizeValue(node.value));
    const isPassword =
      (typeof backendId === 'number' && dom?.passwordInputs.has(backendId)) || /^[•●*]+$/.test(raw);
    if (isPassword) {
      if (raw) out.push('value=(hidden)');
    } else if (raw) {
      out.push(`value="${truncate(raw, MAX_VALUE_LEN)}"`);
    }
  }
  if (props.has('checked')) {
    const c = String(props.get('checked'));
    if (c === 'true') out.push('checked');
    else if (c === 'mixed') out.push('checked=mixed');
    else if (CHECKABLE_ROLES.has(role)) out.push('checked=false');
  }
  if (props.has('pressed') && String(props.get('pressed')) === 'true') out.push('pressed');
  if (props.has('expanded'))
    out.push(String(props.get('expanded')) === 'true' ? 'expanded' : 'collapsed');
  if (props.get('selected') === true || props.get('selected') === 'true') out.push('selected');
  if (props.get('disabled') === true || props.get('disabled') === 'true') out.push('disabled');
  if (props.get('focused') === true || props.get('focused') === 'true') out.push('focused');
  if (props.get('required') === true || props.get('required') === 'true') out.push('required');
  const invalid = props.get('invalid');
  if (invalid !== undefined && String(invalid) !== 'false') out.push('invalid');
  if (role === 'heading' && props.has('level')) out.push(`level=${props.get('level')}`);
  if (role === 'link' && props.has('url')) {
    const url = String(props.get('url') ?? '');
    if (url) out.push(`url=${truncate(url, MAX_URL_LEN)}`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

/**
 * Format one frame's AX tree. Stable uids come from opts.assignUid.
 */
export function formatAxTree(nodes: AXNode[], opts: FormatOptions): FormatResult {
  const uids: number[] = [];
  const uidToBackendNodeId = new Map<number, number>();
  const backendNodeIds = new Set<number>();
  if (!nodes || nodes.length === 0) {
    return { text: '(empty accessibility tree)', uids, uidToBackendNodeId, backendNodeIds };
  }
  const dom = opts.dom ?? null;

  const byId = new Map<string, AXNode>();
  const childToParent = new Map<string, string>();
  for (const n of nodes) {
    byId.set(n.nodeId, n);
    if (typeof n.backendDOMNodeId === 'number') backendNodeIds.add(n.backendDOMNodeId);
  }
  for (const n of nodes) {
    for (const c of n.childIds ?? []) childToParent.set(c, n.nodeId);
  }
  const roots = nodes.filter((n) => !childToParent.has(n.nodeId));
  const startNodes = roots.length > 0 ? roots : [nodes[0]];

  /** Visible text under a node, for naming a clickable div that has no accessible name. */
  const collectText = (node: AXNode, budget: { left: number }, seen: Set<string>): string[] => {
    const parts: string[] = [];
    const stack = [...(node.childIds ?? [])];
    while (stack.length && budget.left > 0) {
      const id = stack.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const child = byId.get(id);
      if (!child || child.ignored) continue;
      if (normalizeRole(child.role) === 'StaticText') {
        const t = clean(normalizeName(child.name));
        if (t) {
          parts.push(t);
          budget.left -= t.length;
        }
      }
      stack.unshift(...(child.childIds ?? []));
    }
    return parts;
  };

  /** Option names under a select/listbox/combobox. */
  const collectOptions = (node: AXNode): string[] => {
    const out: string[] = [];
    const stack = [...(node.childIds ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const id = stack.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const child = byId.get(id);
      if (!child) continue;
      if (OPTION_ROLES.has(normalizeRole(child.role))) {
        out.push(clean(normalizeName(child.name)));
        continue;
      }
      stack.unshift(...(child.childIds ?? []));
    }
    return out;
  };

  const lines: string[] = [];
  const visited = new Set<string>();
  const base = opts.indentBase ?? 0;

  const walk = (
    node: AXNode,
    depth: number,
    parentRole: string,
    insideUid: boolean,
    textClaimed: boolean,
  ): void => {
    if (!node || visited.has(node.nodeId)) return;
    visited.add(node.nodeId);

    const ignored = node.ignored === true;
    const role = normalizeRole(node.role);
    let name = truncate(clean(normalizeName(node.name)), MAX_NAME_LEN);
    const backendId = node.backendDOMNodeId;
    const hasBackend = typeof backendId === 'number';

    let actionable = false;
    let pointerRoot = false;
    if (!ignored && hasBackend) {
      if (INTERACTIVE_ROLES.has(role)) {
        actionable = !insideUid || FORM_CONTROL_ROLES.has(role);
      } else if (dom) {
        if (!insideUid && role !== 'StaticText' && dom.pointerRoots.has(backendId as number)) {
          actionable = true;
          pointerRoot = true;
        } else if (
          role === 'StaticText' &&
          !insideUid &&
          name.length > 0 &&
          dom.pointerText.has(backendId as number)
        ) {
          actionable = true;
        }
      } else if (
        role === 'StaticText' &&
        !INTERACTIVE_ROLES.has(parentRole) &&
        !insideUid &&
        name.length > 0
      ) {
        // No layout facts: freestanding text may be a role-less menu item.
        actionable = true;
      }
    }

    // A clickable div with no name is named by the text inside it.
    let claimsText = false;
    if (pointerRoot && name.length === 0) {
      name = truncate(
        collectText(node, { left: MAX_NAME_LEN * 2 }, new Set()).join(' '),
        MAX_NAME_LEN,
      );
      claimsText = name.length > 0;
    }
    if (pointerRoot && name.length === 0) actionable = false;

    const skipForReadability = !ignored && SKIP_RENDER_ROLES.has(role) && !actionable;
    const skipEmpty = !actionable && name.length === 0 && !SKIP_RENDER_ROLES.has(role);
    // Text already used as the name of a clickable ancestor is not repeated.
    const skipClaimed = textClaimed && role === 'StaticText' && !actionable;
    const renderable = !ignored && !skipForReadability && !skipEmpty && !skipClaimed && role !== '';

    if (renderable) {
      const indent = '  '.repeat(base + depth);
      const props = propMap(node);
      let line = `${indent}${role} "${name}"`;
      if (actionable && hasBackend) {
        const uid = opts.assignUid(backendId as number);
        uids.push(uid);
        uidToBackendNodeId.set(uid, backendId as number);
        line += ` [uid=${uid}]`;
      }
      line += stateSuffix(node, role, props, dom);
      if (role === 'combobox' || role === 'listbox' || role === 'PopUpButton') {
        const options = collectOptions(node);
        if (options.length) {
          const preview = options
            .slice(0, OPTIONS_PREVIEW)
            .map((o) => `"${truncate(o, 40)}"`)
            .join(', ');
          line += ` options(${options.length}): ${preview}${options.length > OPTIONS_PREVIEW ? ', …' : ''}`;
        }
      }
      lines.push(line);
    }

    const childDepth = renderable ? depth + 1 : depth;
    const childParentRole = renderable ? role : parentRole;
    // Only buttons, links and clickable divs swallow what is inside them;
    // nested tree items, menu items and options stay addressable.
    const childInsideUid =
      insideUid || (actionable && (role === 'button' || role === 'link' || pointerRoot));
    const childClaimed = textClaimed || claimsText;
    for (const cid of node.childIds ?? []) {
      const child = byId.get(cid);
      if (child) walk(child, childDepth, childParentRole, childInsideUid, childClaimed);
    }
  };

  for (const root of startNodes) walk(root, 0, '', false, false);

  let text = lines.join('\n');
  if (text.trim().length === 0) {
    text = '(no renderable elements found; the page may still be loading)';
  }
  return { text, uids, uidToBackendNodeId, backendNodeIds };
}
