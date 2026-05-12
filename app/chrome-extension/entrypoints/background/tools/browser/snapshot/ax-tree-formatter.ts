/**
 * Pure formatter that converts a flat CDP Accessibility.AXNode list into:
 *   - a human-readable indented text representation
 *   - a uid → backendDOMNodeId map for interactive nodes
 *
 * Interactive role set borrowed from chrome-devtools-mcp's snapshot tool —
 * these are the roles a model would actually want to click/fill/hover.
 */

import type { AXNode } from './types';

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
  'option',
]);

// StaticText is "interactive-by-context" when its parent is NOT itself
// interactive — i.e., it's a freestanding text node rather than a label
// inside a <button>/<link>. Workato renders menu items (Clone/Delete) and
// other custom-popover content as plain divs at body-level with no ARIA
// role, so the only reliable signal is "this StaticText isn't a button label."
//
// Trade-off: a few decorative labels (e.g. recipe canvas "TRIGGER"/"ACTIONS")
// also get UIDs. Click-side exceptionDetails check throws loudly when the
// underlying DOM node isn't an HTMLElement or has no click handler, so the
// cost is noise in snapshots, not silent wrong-success.

const SKIP_RENDER_ROLES = new Set<string>(['generic', 'none', 'presentation', 'InlineTextBox']);

const MAX_NAME_LEN = 80;
const MAX_OUTPUT_CHARS = 50_000;

function truncateName(s: string): string {
  if (s.length <= MAX_NAME_LEN) return s;
  return s.slice(0, MAX_NAME_LEN - 1) + '…';
}

function isInteractive(role: string): boolean {
  return INTERACTIVE_ROLES.has(role);
}

function normalizeRole(role: AXNode['role']): string {
  if (typeof role === 'string') return role;
  return role?.value ?? '';
}

function normalizeName(name: AXNode['name']): string {
  if (typeof name === 'string') return name;
  return (name?.value ?? '').toString();
}

export interface FormatResult {
  text: string;
  uidMap: Map<number, number>;
}

export function formatAxTree(nodes: AXNode[]): FormatResult {
  const uidMap = new Map<number, number>();
  if (!nodes || nodes.length === 0) {
    return { text: '(empty accessibility tree)', uidMap };
  }

  // Build id → node, and child → parent mapping so we can find a root.
  const byId = new Map<string, AXNode>();
  const childToParent = new Map<string, string>();
  for (const n of nodes) {
    byId.set(n.nodeId, n);
  }
  for (const n of nodes) {
    if (n.childIds) {
      for (const c of n.childIds) {
        childToParent.set(c, n.nodeId);
      }
    }
  }

  // Root candidates: nodes with no parent reference.
  const roots: AXNode[] = nodes.filter((n) => !childToParent.has(n.nodeId));
  // Fall back to the first node if no root is identifiable.
  const startNodes = roots.length > 0 ? roots : [nodes[0]];

  let uidCounter = 0;
  let nodesRendered = 0;
  const lines: string[] = [];
  let totalChars = 0;
  let truncated = false;
  let truncatedCount = 0;

  const visited = new Set<string>();

  const walk = (node: AXNode, depth: number, parentRole: string): void => {
    if (!node || visited.has(node.nodeId)) return;
    visited.add(node.nodeId);

    const ignored = node.ignored === true;
    const roleRaw = normalizeRole(node.role);
    const trimmedName = truncateName(normalizeName(node.name).replace(/\s+/g, ' ').trim());

    // See INTERACTIVE_CONTAINER_ROLES comment above for the heuristic & trade-off.
    const interactiveByContext =
      roleRaw === 'StaticText' &&
      !INTERACTIVE_ROLES.has(parentRole) &&
      trimmedName.length > 0 &&
      typeof node.backendDOMNodeId === 'number';

    const isInteractiveNode = isInteractive(roleRaw) || interactiveByContext;

    // Decide whether to render this node.
    const skipForReadability = !ignored && SKIP_RENDER_ROLES.has(roleRaw) && !isInteractiveNode;
    const skipEmpty =
      !isInteractiveNode && trimmedName.length === 0 && !SKIP_RENDER_ROLES.has(roleRaw);

    const renderable = !ignored && !skipForReadability && !skipEmpty && roleRaw !== '';

    if (renderable) {
      if (totalChars > MAX_OUTPUT_CHARS) {
        truncated = true;
        truncatedCount += 1;
      } else {
        const indent = '  '.repeat(depth);
        let line: string;
        if (isInteractiveNode && typeof node.backendDOMNodeId === 'number') {
          uidCounter += 1;
          uidMap.set(uidCounter, node.backendDOMNodeId);
          line = `${indent}${roleRaw} "${trimmedName}" [uid=${uidCounter}]`;
        } else {
          line = `${indent}${roleRaw} "${trimmedName}"`;
        }
        lines.push(line);
        totalChars += line.length + 1; // +1 for the joining '\n'
        nodesRendered += 1;
      }
    }

    if (node.childIds) {
      // Children render at depth+1 if this node was rendered, otherwise carry depth
      // so skipped wrappers don't artificially indent the visible tree.
      const childDepth = renderable ? depth + 1 : depth;
      const childParentRole = renderable ? roleRaw : parentRole;
      for (const cid of node.childIds) {
        const child = byId.get(cid);
        if (child) walk(child, childDepth, childParentRole);
      }
    }
  };

  for (const root of startNodes) {
    walk(root, 0, '');
  }

  let text = lines.join('\n');
  if (truncated) {
    text += `\n[…truncated, ${truncatedCount} more nodes — narrow tab or interact with what's visible]`;
  }
  // Guard against a totally empty render (e.g. all nodes ignored)
  if (text.trim().length === 0) {
    text =
      nodesRendered === 0 ? '(no renderable elements found — page may still be loading)' : text;
  }

  return { text, uidMap };
}
