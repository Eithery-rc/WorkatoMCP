/**
 * Read-only page queries: find text (chrome_search_page) and list elements
 * (chrome_find_elements) without pulling the whole page into the context.
 *
 * Both run one self-contained function in the page (ISOLATED world) and return
 * only the matches. They never activate the tab, and a stale tabId is an error
 * rather than a quiet switch to the active tab.
 *
 * The in-page functions are plain synchronous `function`s with no object
 * spread/rest: the bundle targets es2015, and a transpiler helper at module
 * scope would not exist in the page (see scripts/check-bundle.mjs).
 */

import { riskyRegexReason } from '../workato/recipe-grep';
import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor, getTabOrThrow } from '../base-browser';

const DEFAULT_CONTEXT_CHARS = 80;
const MAX_CONTEXT_CHARS = 500;
const DEFAULT_SEARCH_RESULTS = 20;
const MAX_SEARCH_RESULTS = 200;
const DEFAULT_FIND_RESULTS = 30;
const MAX_FIND_RESULTS = 500;
const DEFAULT_ATTRIBUTES = ['id', 'name', 'class', 'href', 'value', 'type', 'role', 'aria-label'];

interface SearchPageParams {
  query?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  contextChars?: number;
  cssScope?: string;
  maxResults?: number;
  tabId?: number;
}

interface FindElementsParams {
  selector?: string;
  attributes?: string[];
  includeText?: boolean;
  maxResults?: number;
  tabId?: number;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

function jsonResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false };
}

/** The named tab (stale id = error), else the active tab of the last-focused window. */
async function resolveTab(tabId?: number): Promise<chrome.tabs.Tab> {
  if (typeof tabId === 'number') return getTabOrThrow(tabId);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active || typeof active.id !== 'number') throw new Error('No active tab found');
  return active;
}

async function runQueryInTab<A extends unknown[], R>(
  tabId: number,
  func: (...args: A) => R,
  args: A,
): Promise<R> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: func as any,
    args: args as any,
    world: 'ISOLATED',
  } as any);
  return (injection as any)?.result as R;
}

// ---------------------------------------------------------------------------
// In-page functions (serialized into the tab)
// ---------------------------------------------------------------------------

interface SearchInPageResult {
  ok: boolean;
  error?: string;
  total_matches?: number;
  matches?: Array<{ text: string; context_before: string; context_after: string; element: string }>;
  truncated?: boolean;
  scanned_chars?: number;
  scan_truncated?: boolean;
}

export function searchPageInPage(
  query: string,
  isRegex: boolean,
  caseSensitive: boolean,
  contextChars: number,
  cssScope: string | null,
  maxResults: number,
): SearchInPageResult {
  const MAX_SCAN_CHARS = 2000000;
  const MAX_COUNTED = 10000;
  // The page's main thread is the user's: a slow pattern must not freeze it.
  const MAX_MATCH_MS = 1000;
  const SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, svg: 1 } as Record<string, number>;

  let pattern: RegExp;
  try {
    const source = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(source, caseSensitive ? 'g' : 'gi');
  } catch (e) {
    return {
      ok: false,
      error: 'Invalid regular expression: ' + (e instanceof Error ? e.message : String(e)),
    };
  }

  const roots: Array<Element | ShadowRoot> = [];
  if (cssScope) {
    try {
      const scoped = document.querySelectorAll(cssScope);
      for (let s = 0; s < scoped.length; s++) roots.push(scoped[s]);
    } catch (e) {
      return {
        ok: false,
        error: 'Invalid cssScope selector: ' + (e instanceof Error ? e.message : String(e)),
      };
    }
    if (roots.length === 0) {
      return { ok: true, total_matches: 0, matches: [], truncated: false, scanned_chars: 0 };
    }
  } else if (document.body) {
    roots.push(document.body);
  }

  // One flat string of the visible text, with a map from string offset to the
  // element that holds it.
  let text = '';
  const owners: Element[] = [];
  const starts: number[] = [];
  const visibleCache = new Map<Element, boolean>();
  let scanTruncated = false;

  function isVisible(el: Element): boolean {
    const cached = visibleCache.get(el);
    if (cached !== undefined) return cached;
    let visible = true;
    const anyEl = el as any;
    if (typeof anyEl.checkVisibility === 'function') {
      visible = anyEl.checkVisibility({ visibilityProperty: true, opacityProperty: false });
    } else {
      const style = window.getComputedStyle(el);
      visible = style.display !== 'none' && style.visibility !== 'hidden';
    }
    visibleCache.set(el, visible);
    return visible;
  }

  function collect(root: Node): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.currentNode;
    while (node) {
      if (text.length >= MAX_SCAN_CHARS) {
        scanTruncated = true;
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (SKIP[el.tagName]) {
          node = walker.nextSibling() || nextOutside(walker);
          continue;
        }
        if ((el as any).shadowRoot) collect((el as any).shadowRoot);
        if (el.tagName === 'IFRAME') {
          try {
            const doc = (el as HTMLIFrameElement).contentDocument;
            if (doc && doc.body) collect(doc.body);
          } catch (e) {
            // Cross-origin frame: not readable from here.
          }
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        const value = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (value && parent && isVisible(parent)) {
          if (text.length > 0) text += ' ';
          starts.push(text.length);
          owners.push(parent);
          text += value;
        }
      }
      node = walker.nextNode();
    }
  }

  function nextOutside(walker: TreeWalker): Node | null {
    while (walker.parentNode()) {
      const sibling = walker.nextSibling();
      if (sibling) return sibling;
    }
    return null;
  }

  function ownerAt(offset: number): Element | null {
    let lo = 0;
    let hi = starts.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= offset) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found >= 0 ? owners[found] : null;
  }

  function describe(el: Element | null): string {
    const parts: string[] = [];
    let current: Element | null = el;
    for (let depth = 0; current && depth < 3; depth++) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += '#' + current.id;
      const classes = (typeof current.className === 'string' ? current.className : '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);
      if (classes.length) part += '.' + classes.join('.');
      parts.unshift(part);
      if (current.id) break;
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  for (let r = 0; r < roots.length; r++) collect(roots[r]);

  const matches: SearchInPageResult['matches'] = [];
  let total = 0;
  let match: RegExpExecArray | null;
  pattern.lastIndex = 0;
  const matchStarted = Date.now();
  while ((match = pattern.exec(text)) !== null) {
    if (Date.now() - matchStarted > MAX_MATCH_MS) {
      scanTruncated = true;
      break;
    }
    if (match[0].length === 0) {
      pattern.lastIndex++;
      continue;
    }
    total++;
    if (matches.length < maxResults) {
      const at = match.index;
      matches.push({
        text: match[0].slice(0, 500),
        context_before: text.slice(Math.max(0, at - contextChars), at),
        context_after: text.slice(at + match[0].length, at + match[0].length + contextChars),
        element: describe(ownerAt(at)),
      });
    }
    if (total >= MAX_COUNTED) break;
  }

  return {
    ok: true,
    total_matches: total,
    matches: matches,
    truncated: total > matches.length,
    scanned_chars: text.length,
    scan_truncated: scanTruncated,
  };
}

interface FindInPageResult {
  ok: boolean;
  error?: string;
  total?: number;
  items?: Array<{ tag: string; attrs: Record<string, string>; text?: string; visible: boolean }>;
  truncated?: boolean;
}

export function findElementsInPage(
  selector: string,
  attributes: string[],
  includeText: boolean,
  maxResults: number,
): FindInPageResult {
  const found: Element[] = [];
  const seen = new Set<Element>();

  function queryRoot(root: Document | ShadowRoot): void {
    const list = root.querySelectorAll(selector);
    for (let i = 0; i < list.length; i++) {
      if (!seen.has(list[i])) {
        seen.add(list[i]);
        found.push(list[i]);
      }
    }
    // Open shadow roots and same-origin iframes below this root.
    const all = root.querySelectorAll('*');
    for (let j = 0; j < all.length; j++) {
      const el = all[j] as any;
      if (el.shadowRoot) queryRoot(el.shadowRoot);
      if (el.tagName === 'IFRAME') {
        try {
          const doc = el.contentDocument;
          if (doc) queryRoot(doc);
        } catch (e) {
          // Cross-origin frame.
        }
      }
    }
  }

  try {
    queryRoot(document);
  } catch (e) {
    return {
      ok: false,
      error: 'Invalid selector: ' + (e instanceof Error ? e.message : String(e)),
    };
  }

  const items: FindInPageResult['items'] = [];
  for (let k = 0; k < found.length && items.length < maxResults; k++) {
    const node = found[k] as any;
    const attrs: Record<string, string> = {};
    for (let a = 0; a < attributes.length; a++) {
      const name = attributes[a];
      let value: string | null = null;
      if (name === 'value' && 'value' in node && typeof node.value === 'string') {
        value =
          String(node.getAttribute('type') || '').toLowerCase() === 'password' ? '***' : node.value;
      } else if (node.getAttribute) {
        value = node.getAttribute(name);
      }
      if (value !== null && value !== undefined && value !== '')
        attrs[name] = String(value).slice(0, 500);
    }
    let visible = true;
    if (typeof node.checkVisibility === 'function') {
      visible = node.checkVisibility({ visibilityProperty: true });
    }
    const item: { tag: string; attrs: Record<string, string>; text?: string; visible: boolean } = {
      tag: String(node.tagName || '').toLowerCase(),
      attrs: attrs,
      visible: visible,
    };
    if (includeText) {
      const raw = String(node.innerText || node.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (raw) item.text = raw.length > 200 ? raw.slice(0, 200) + '...' : raw;
    }
    items.push(item);
  }

  return { ok: true, total: found.length, items: items, truncated: found.length > items.length };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

class SearchPageTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SEARCH_PAGE;

  async execute(args: SearchPageParams): Promise<ToolResult> {
    const query = typeof args?.query === 'string' ? args.query : '';
    if (!query) return createErrorResponse('query is required (the text or pattern to find).');
    if (args.regex === true) {
      // Same guard as workato_recipe_grep: a catastrophic pattern would freeze
      // the page's main thread, which on a leased tab is a live client page.
      const risky = riskyRegexReason(query);
      if (risky) return createErrorResponse(`Refused regex: ${risky}. Simplify the pattern.`);
    }
    try {
      const tab = await resolveTab(args.tabId);
      const result = await runQueryInTab(tab.id!, searchPageInPage, [
        query,
        args.regex === true,
        args.caseSensitive === true,
        clampInt(args.contextChars, DEFAULT_CONTEXT_CHARS, 0, MAX_CONTEXT_CHARS),
        typeof args.cssScope === 'string' && args.cssScope.trim() ? args.cssScope : null,
        clampInt(args.maxResults, DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS),
      ]);
      if (!result) return createErrorResponse('The page returned no result (restricted page?).');
      if (!result.ok) return createErrorResponse(result.error || 'Search failed.');
      const { ok: _ok, ...payload } = result;
      return jsonResult({ tabId: tab.id, url: tab.url, query, ...payload });
    } catch (error) {
      return createErrorResponse(
        `chrome_search_page failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

class FindElementsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.FIND_ELEMENTS;

  async execute(args: FindElementsParams): Promise<ToolResult> {
    const selector = typeof args?.selector === 'string' ? args.selector.trim() : '';
    if (!selector) return createErrorResponse('selector is required (a CSS selector).');
    const attributes =
      Array.isArray(args.attributes) && args.attributes.length > 0
        ? args.attributes.filter((a): a is string => typeof a === 'string' && a.length > 0)
        : DEFAULT_ATTRIBUTES;
    try {
      const tab = await resolveTab(args.tabId);
      const result = await runQueryInTab(tab.id!, findElementsInPage, [
        selector,
        attributes,
        args.includeText !== false,
        clampInt(args.maxResults, DEFAULT_FIND_RESULTS, 1, MAX_FIND_RESULTS),
      ]);
      if (!result) return createErrorResponse('The page returned no result (restricted page?).');
      if (!result.ok) return createErrorResponse(result.error || 'Query failed.');
      const { ok: _ok, ...payload } = result;
      return jsonResult({ tabId: tab.id, url: tab.url, selector, ...payload });
    } catch (error) {
      return createErrorResponse(
        `chrome_find_elements failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const searchPageTool = new SearchPageTool();
export const findElementsTool = new FindElementsTool();
