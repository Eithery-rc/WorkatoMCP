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
  let truncated = false;
  let truncatedCount = 0;

  const visited = new Set<string>();

  const walk = (node: AXNode, depth: number): void => {
    if (!node || visited.has(node.nodeId)) return;
    visited.add(node.nodeId);

    const ignored = node.ignored === true;
    const roleRaw = node.role?.value ?? '';
    const name = (node.name?.value ?? '').toString();
    const trimmedName = truncateName(name.replace(/\s+/g, ' ').trim());

    // Decide whether to render this node.
    const skipForReadability =
      !ignored && SKIP_RENDER_ROLES.has(roleRaw) && !isInteractive(roleRaw); // interactive roles never get skipped by this rule
    const skipEmpty =
      !isInteractive(roleRaw) && trimmedName.length === 0 && !SKIP_RENDER_ROLES.has(roleRaw)
        ? // also drop empty non-interactive nodes (per plan)
          true
        : false;

    const renderable = !ignored && !skipForReadability && !skipEmpty && roleRaw !== '';

    if (renderable) {
      if (lines.join('\n').length > MAX_OUTPUT_CHARS) {
        truncated = true;
        truncatedCount += 1;
      } else {
        const indent = '  '.repeat(depth);
        if (isInteractive(roleRaw) && typeof node.backendDOMNodeId === 'number') {
          uidCounter += 1;
          uidMap.set(uidCounter, node.backendDOMNodeId);
          lines.push(`${indent}${roleRaw} "${trimmedName}" [uid=${uidCounter}]`);
        } else {
          lines.push(`${indent}${roleRaw} "${trimmedName}"`);
        }
        nodesRendered += 1;
      }
    }

    if (node.childIds) {
      // Children render at depth+1 if this node was rendered, otherwise carry depth
      // so skipped wrappers don't artificially indent the visible tree.
      const childDepth = renderable ? depth + 1 : depth;
      for (const cid of node.childIds) {
        const child = byId.get(cid);
        if (child) walk(child, childDepth);
      }
    }
  };

  for (const root of startNodes) {
    walk(root, 0);
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
