/**
 * Layout facts for the snapshot formatter, from one DOMSnapshot.captureSnapshot.
 *
 * The accessibility tree says nothing about role-less clickable divs, which is
 * how Workato renders popover and menu items. browser-use's answer is the
 * computed cursor: the outermost element of a cursor:pointer area is a click
 * target. Only the `cursor` style is requested, which keeps the capture cheap
 * even on large pages; a slow or failed capture just falls back to the
 * role-only heuristic.
 */

import { sendCommand } from './debugger-session';
import type { DomInfo } from './types';

const DOM_SNAPSHOT_TIMEOUT_MS = 4000;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`DOMSnapshot timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function captureDomInfo(tabId: number): Promise<DomInfo | null> {
  try {
    const snap = await withTimeout(
      sendCommand<any>(tabId, 'DOMSnapshot.captureSnapshot', {
        computedStyles: ['cursor'],
        includeDOMRects: false,
        includePaintOrder: false,
      }),
      DOM_SNAPSHOT_TIMEOUT_MS,
    );
    return buildDomInfo(snap);
  } catch (e) {
    console.warn('[snapshot] DOMSnapshot unavailable, using role-only interactivity:', e);
    return null;
  }
}

/** Pure: DOMSnapshot.captureSnapshot result -> DomInfo. Exported for tests. */
export function buildDomInfo(snap: any): DomInfo {
  const strings: string[] = Array.isArray(snap?.strings) ? snap.strings : [];
  const info: DomInfo = {
    pointerRoots: new Set<number>(),
    pointerText: new Set<number>(),
    passwordInputs: new Set<number>(),
  };
  for (const doc of snap?.documents ?? []) {
    const nodes = doc?.nodes ?? {};
    const parent: number[] = nodes.parentIndex ?? [];
    const type: number[] = nodes.nodeType ?? [];
    const nameIdx: number[] = nodes.nodeName ?? [];
    const backend: number[] = nodes.backendNodeId ?? [];
    const attrs: number[][] = nodes.attributes ?? [];
    const layout = doc?.layout ?? {};
    const layoutNode: number[] = layout.nodeIndex ?? [];
    const styles: number[][] = layout.styles ?? [];

    const cursor = new Map<number, string>();
    layoutNode.forEach((nodeIndex, li) => {
      const s = styles[li];
      if (s && s.length && typeof s[0] === 'number' && s[0] >= 0) {
        cursor.set(nodeIndex, strings[s[0]] ?? '');
      }
    });

    const ancestorCursor = (i: number): string | undefined => {
      let p = parent[i];
      let guard = 0;
      while (p !== undefined && p >= 0 && guard++ < 2000) {
        if (type[p] === ELEMENT_NODE && cursor.has(p)) return cursor.get(p);
        p = parent[p];
      }
      return undefined;
    };

    for (let i = 0; i < type.length; i++) {
      const name = strings[nameIdx[i]] ?? '';
      if (type[i] === ELEMENT_NODE) {
        if (name === 'INPUT') {
          const a = attrs[i] ?? [];
          for (let k = 0; k + 1 < a.length; k += 2) {
            if (
              (strings[a[k]] ?? '').toLowerCase() === 'type' &&
              (strings[a[k + 1]] ?? '').toLowerCase() === 'password'
            ) {
              info.passwordInputs.add(backend[i]);
            }
          }
        }
        if (cursor.get(i) === 'pointer' && name !== 'HTML' && name !== 'BODY') {
          if (ancestorCursor(i) !== 'pointer') info.pointerRoots.add(backend[i]);
        }
      } else if (type[i] === TEXT_NODE) {
        const p = parent[i];
        if (p !== undefined && p >= 0 && cursor.get(p) === 'pointer')
          info.pointerText.add(backend[i]);
      }
    }
  }
  return info;
}
