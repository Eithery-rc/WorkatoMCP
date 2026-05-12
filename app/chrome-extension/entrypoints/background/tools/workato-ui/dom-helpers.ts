/**
 * Shared CDP/DOM helpers for the workato_ui_* tool family.
 *
 * Conventions:
 *   - All callers must have already called ensureAttached(tabId).
 *   - findAxNode* helpers do a single Accessibility.getFullAXTree round-trip
 *     each. For multi-step macros we re-fetch the tree rather than caching,
 *     because Workato's Angular re-renders frequently after clicks.
 *   - clickByAxNode resolves backendDOMNodeId → DOM.resolveNode → callFunctionOn
 *     with `.click()`, the same pattern used by snapshot/handlers.ts.
 */

import { ensureAttached, sendCommand } from '../browser/snapshot/debugger-session';
import type { AXNode } from '../browser/snapshot/types';

// ---------------------------------------------------------------------------
// AX tree utilities
// ---------------------------------------------------------------------------

export function axRole(node: AXNode): string {
  return typeof node.role === 'string' ? node.role : (node.role?.value ?? '');
}

export function axName(node: AXNode): string {
  return typeof node.name === 'string' ? node.name : (node.name?.value ?? '').toString();
}

export async function getAxTree(tabId: number): Promise<AXNode[]> {
  await ensureAttached(tabId);
  const result = await sendCommand<{ nodes: AXNode[] }>(tabId, 'Accessibility.getFullAXTree');
  return (result && result.nodes) || [];
}

export interface AxMatchOptions {
  role?: string;
  /** Exact (case-insensitive) name match. */
  nameEquals?: string;
  /** Case-insensitive substring match on name. */
  nameContains?: string;
}

/**
 * Find the first AX node matching role + name predicate. Returns the raw
 * AXNode (with backendDOMNodeId) or null.
 */
export function findAxNode(nodes: AXNode[], opts: AxMatchOptions): AXNode | null {
  const matches = findAllAxNodes(nodes, opts);
  return matches.length > 0 ? matches[0] : null;
}

export function findAllAxNodes(nodes: AXNode[], opts: AxMatchOptions): AXNode[] {
  const out: AXNode[] = [];
  const roleLower = opts.role ? opts.role.toLowerCase() : null;
  const eqLower = opts.nameEquals ? opts.nameEquals.toLowerCase() : null;
  const cntLower = opts.nameContains ? opts.nameContains.toLowerCase() : null;
  for (const n of nodes) {
    if (n.ignored) continue;
    if (typeof n.backendDOMNodeId !== 'number') continue;
    const r = axRole(n).toLowerCase();
    const nm = axName(n).toLowerCase();
    if (roleLower && r !== roleLower) continue;
    if (eqLower !== null && nm !== eqLower) continue;
    if (cntLower !== null && !nm.includes(cntLower)) continue;
    out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a predicate every `intervalMs` until it returns truthy or `timeoutMs`
 * elapses. Returns whatever the predicate returned (or null on timeout).
 */
export async function pollUntil<T>(
  predicate: () => Promise<T | null | undefined | false>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T | null> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const intervalMs = opts.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result as T;
    } catch {
      /* swallow and retry */
    }
    await sleep(intervalMs);
  }
  return null;
}

// ---------------------------------------------------------------------------
// CDP helpers
// ---------------------------------------------------------------------------

export async function resolveBackendNodeToObjectId(
  tabId: number,
  backendNodeId: number,
): Promise<string> {
  const resolved = await sendCommand<{ object: { objectId: string } }>(tabId, 'DOM.resolveNode', {
    backendNodeId,
  });
  if (!resolved?.object?.objectId) {
    throw new Error(`could not resolve backendNodeId=${backendNodeId} to an objectId`);
  }
  return resolved.object.objectId;
}

/**
 * Click the DOM element behind an AX node. Throws on any exception detail.
 */
export async function clickByAxNode(tabId: number, node: AXNode): Promise<void> {
  if (typeof node.backendDOMNodeId !== 'number') {
    throw new Error('AX node has no backendDOMNodeId');
  }
  try {
    await sendCommand(tabId, 'DOM.scrollIntoViewIfNeeded', {
      backendNodeId: node.backendDOMNodeId,
    });
  } catch {
    /* best effort */
  }
  const objectId = await resolveBackendNodeToObjectId(tabId, node.backendDOMNodeId);
  const callResult = await sendCommand<{
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>(tabId, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration:
      'function(){ if (typeof this.click !== "function") throw new Error("target is not clickable"); this.click(); }',
    awaitPromise: false,
  });
  if (callResult?.exceptionDetails) {
    const detail =
      callResult.exceptionDetails.exception?.description ??
      callResult.exceptionDetails.text ??
      'unknown JS exception';
    throw new Error(detail);
  }
}

/**
 * Evaluate an expression in the page MAIN world and return its serialized
 * value. Wraps Runtime.evaluate with returnByValue + awaitPromise.
 */
export async function evaluateInPage<T = unknown>(
  tabId: number,
  expression: string,
  opts: { awaitPromise?: boolean } = {},
): Promise<T> {
  const res = await sendCommand<{
    result?: { value?: T };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: opts.awaitPromise ?? false,
  });
  if (res?.exceptionDetails) {
    const detail =
      res.exceptionDetails.exception?.description ??
      res.exceptionDetails.text ??
      'unknown JS exception';
    throw new Error(detail);
  }
  return res?.result?.value as T;
}

/**
 * Call a function on a resolved JS object (objectId), with structured args.
 * Returns the serialized return value.
 */
export async function callFunctionOnObject<T = unknown>(
  tabId: number,
  objectId: string,
  functionDeclaration: string,
  argValues: unknown[] = [],
): Promise<T> {
  const res = await sendCommand<{
    result?: { value?: T };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>(tabId, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration,
    arguments: argValues.map((v) => ({ value: v })),
    returnByValue: true,
    awaitPromise: false,
  });
  if (res?.exceptionDetails) {
    const detail =
      res.exceptionDetails.exception?.description ??
      res.exceptionDetails.text ??
      'unknown JS exception';
    throw new Error(detail);
  }
  return res?.result?.value as T;
}

// ---------------------------------------------------------------------------
// Tab resolution
// ---------------------------------------------------------------------------

import { ERROR_MESSAGES } from '@/common/constants';

export async function resolveTabId(args: { tabId?: number; windowId?: number }): Promise<number> {
  if (typeof args.tabId === 'number') {
    try {
      const t = await chrome.tabs.get(args.tabId);
      if (t && typeof t.id === 'number') return t.id;
    } catch {
      /* fall through */
    }
  }
  const tabs = await chrome.tabs.query(
    typeof args.windowId === 'number'
      ? { active: true, windowId: args.windowId }
      : { active: true, currentWindow: true },
  );
  const t = tabs && tabs[0];
  if (!t || typeof t.id !== 'number') {
    throw new Error(ERROR_MESSAGES.TAB_NOT_FOUND);
  }
  return t.id;
}

export async function getTabUrl(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  return tab.url ?? '';
}

// ---------------------------------------------------------------------------
// Workato DOM snippets
// ---------------------------------------------------------------------------

/**
 * Snippet that walks the recipe canvas DOM and returns step metadata.
 * Returns an array of {number, app, action, hasConnection?} or [] on error.
 *
 * We try multiple selectors because Workato's component names have drifted
 * over time. The numbered bubble (button with name = "1", "2", ...) is the
 * most reliable anchor.
 */
export const LIST_STEPS_SNIPPET = `
(() => {
  try {
    // Step bubbles render as buttons whose visible text content is the step
    // number. Workato wraps them in w-recipe-step / w-step elements, but
    // the safest anchor is the button itself.
    const buttons = Array.from(document.querySelectorAll('button'));
    const numbered = buttons
      .map((btn) => {
        const txt = (btn.textContent || '').trim();
        // Step bubbles have only a number as their visible label (e.g. "1", "2").
        if (!/^\\d+$/.test(txt)) return null;
        const n = parseInt(txt, 10);
        if (!Number.isFinite(n) || n < 1) return null;
        // Climb up to the step container — try a few likely tag names.
        let container = btn.closest('w-recipe-step, w-step, [class*="recipe-step"], [class*="step-card"]');
        if (!container) {
          // Fallback: walk up until we find something that looks like a step row.
          let p = btn.parentElement;
          let depth = 0;
          while (p && depth < 8) {
            if (p.querySelectorAll && p.querySelectorAll('img, [class*="provider"]').length > 0) {
              container = p;
              break;
            }
            p = p.parentElement;
            depth++;
          }
        }
        let app = '';
        let action = '';
        if (container) {
          // Look for image alt text (provider icon) as the app label.
          const img = container.querySelector('img[alt]');
          if (img && img.getAttribute('alt')) app = img.getAttribute('alt').trim();
          // Workato often renders the action description as the first
          // visible text node after the bubble. Pull a short string.
          const descNodes = container.querySelectorAll('[class*="description"], [class*="title"], [class*="action-name"]');
          for (const dn of descNodes) {
            const t = (dn.textContent || '').trim();
            if (t && t !== txt) {
              if (!action) action = t;
              if (!app && /\\bin\\s+/.test(t)) {
                // pattern: "Send message in Slack"
                const m = t.match(/\\bin\\s+(.+)$/);
                if (m) app = m[1].trim();
              }
            }
          }
          if (!action) {
            // Last-ditch: concatenated text minus the step number.
            const all = (container.textContent || '').replace(txt, '').trim();
            action = all.split(/\\s{2,}|\\n/)[0].trim().slice(0, 80);
          }
        }
        return { number: n, app, action };
      })
      .filter(Boolean);
    // De-dupe by step number (keep first occurrence).
    const seen = new Set();
    const out = [];
    for (const s of numbered) {
      if (seen.has(s.number)) continue;
      seen.add(s.number);
      out.push(s);
    }
    out.sort((a, b) => a.number - b.number);
    return out;
  } catch (e) {
    return { __error: String(e && e.message || e) };
  }
})()
`;

/**
 * Snippet that checks if the recipe has unsaved changes. Returns:
 *   - dirtyCount: number of .ng-dirty descendants
 *   - unsavedFlag: whether any element advertises an "unsaved" class
 *   - validationErrors: brief list of any visible validation/error text
 */
export const DIRTY_STATE_SNIPPET = `
(() => {
  const dirtyCount = document.querySelectorAll('.ng-dirty').length;
  const unsavedNodes = Array.from(document.querySelectorAll('[class*="unsaved"]'));
  const unsavedFlag = unsavedNodes.length > 0;
  const errEls = Array.from(document.querySelectorAll('.ng-invalid, [class*="validation-error"], [class*="invalid"]'));
  const validationErrors = errEls
    .slice(0, 5)
    .map((el) => (el.textContent || '').trim())
    .filter((t) => t.length > 0 && t.length < 200);
  return { dirtyCount, unsavedFlag, validationErrors };
})()
`;
