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

import { findWorkatoTab, isWorkatoAppHost, WORKATO_URL_PATTERNS } from '../workato/tab-dispatch';

/**
 * Resolve the tab every workato_* tool should target.
 *
 * Resolution order (unified across all tool families — spec: "never the
 * active tab"):
 *   1. Explicit `tabId` — validated to still exist.
 *   2. A Workato app tab in `windowId`, when provided.
 *   3. Any open Workato app tab (same algorithm as findWorkatoTab, which the
 *      workato_* read tools already use).
 *   4. Error — never fall back to whatever tab happens to be focused. The
 *      previous active-tab fallback made writes fail (or worse, target the
 *      wrong page) whenever the user was in another app while the agent
 *      worked.
 */
export async function resolveTabId(args: { tabId?: number; windowId?: number }): Promise<number> {
  if (typeof args.tabId === 'number') {
    try {
      const t = await chrome.tabs.get(args.tabId);
      if (t && typeof t.id === 'number') return t.id;
    } catch {
      /* fall through to Workato-tab discovery */
    }
  }

  if (typeof args.windowId === 'number') {
    const tabs = await chrome.tabs.query({
      url: WORKATO_URL_PATTERNS,
      windowId: args.windowId,
    });
    const appTab = tabs.find(
      (t) =>
        typeof t.id === 'number' &&
        typeof t.url === 'string' &&
        isWorkatoAppHost(new URL(t.url).host),
    );
    if (appTab && typeof appTab.id === 'number') return appTab.id;
    /* no Workato tab in that window — fall through to global discovery */
  }

  const info = await findWorkatoTab();
  return info.tabId;
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
 * Returns an array of {number, label} or [] on error.
 *
 * Real Workato DOM structure (verified live):
 *   W-RECIPE-STEP class="recipe-action-step__step"
 *     DIV.recipe-step.recipe-step-draggable...
 *       SPAN.recipe-step__number
 *         BUTTON.recipe-step__number-button  textContent="3"
 *       DIV.recipe-step__title-container       (action description text)
 *
 * We anchor on .recipe-step__number-button for the number and pull the
 * description from .recipe-step__title-container. The previous heuristic
 * tried generic class patterns (description/title/action-name) that don't
 * exist in the current Workato build, so all fields came back empty.
 */
export const LIST_STEPS_SNIPPET = `
(() => {
  try {
    const cards = Array.from(document.querySelectorAll('w-recipe-step, [class*="recipe-action-step__step"], .recipe-step'));
    const seenCards = new Set();
    const out = [];
    for (const card of cards) {
      // Each W-RECIPE-STEP wraps a single .recipe-step card; if the iterator
      // hits both, dedupe by the inner card element.
      const inner = card.matches && card.matches('.recipe-step') ? card : card.querySelector('.recipe-step');
      if (!inner || seenCards.has(inner)) continue;
      seenCards.add(inner);
      const btn = inner.querySelector('.recipe-step__number-button');
      if (!btn) continue;
      const txt = (btn.textContent || '').trim();
      if (!/^\\d+$/.test(txt)) continue;
      const n = parseInt(txt, 10);
      if (!Number.isFinite(n) || n < 1) continue;
      const titleEl = inner.querySelector('.recipe-step__title-container');
      const label = titleEl ? (titleEl.textContent || '').replace(/\\s+/g, ' ').trim() : '';
      out.push({ number: n, label: label });
    }
    out.sort((a, b) => a.number - b.number);
    // De-dupe by step number (keep first occurrence).
    const seenN = new Set();
    const final = [];
    for (const s of out) {
      if (seenN.has(s.number)) continue;
      seenN.add(s.number);
      final.push(s);
    }
    return final;
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
