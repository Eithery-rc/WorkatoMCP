/**
 * Snapshot+UID tool family.
 *
 * Five tools that drive a tab via the Chrome Debugger Protocol (CDP):
 *   - chrome_snapshot           — capture a11y tree, return tagged text
 *   - chrome_snapshot_click     — click by UID
 *   - chrome_snapshot_fill      — focus + clear + type by UID
 *   - chrome_snapshot_hover     — hover by UID
 *   - chrome_snapshot_wait_for  — poll until role/text appears, return fresh snapshot
 *
 * Each handler:
 *   - resolves the target tab via tryGetTab / getActiveTabOrThrowInWindow
 *   - calls ensureAttached() so the CDP session is alive + idle timer reset
 *   - returns a plain text ToolResult
 *
 * Modeled on app/chrome-extension/entrypoints/background/tools/browser/
 * interaction.ts (ClickTool/FillTool template).
 */

import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../../base-browser';
import { ensureAttached, sendCommand } from './debugger-session';
import { formatAxTree } from './ax-tree-formatter';
import { storeSnapshot, resolveUid } from './uid-store';
import type { AXNode } from './types';

interface TabTargetArgs {
  tabId?: number;
  windowId?: number;
}

type SnapshotArgs = TabTargetArgs;
interface SnapshotClickArgs extends TabTargetArgs {
  uid: number;
}
interface SnapshotFillArgs extends TabTargetArgs {
  uid: number;
  value: string;
}
interface SnapshotHoverArgs extends TabTargetArgs {
  uid: number;
}
interface SnapshotWaitForArgs extends TabTargetArgs {
  text?: string;
  role?: string;
  timeoutMs?: number;
}

function newSnapshotId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1e6).toString(36);
  return `snap_${ts}_${rand}`;
}

function detectMac(): boolean {
  try {
    const uaPlatform = (navigator as any)?.userAgentData?.platform;
    if (typeof uaPlatform === 'string' && uaPlatform.length > 0) {
      return uaPlatform.toLowerCase().includes('mac');
    }
    return (navigator.platform ?? '').toLowerCase().includes('mac');
  } catch {
    return false;
  }
}

/**
 * Resolve target tab from args. Throws on missing.
 */
async function resolveTabId(args: TabTargetArgs): Promise<number> {
  const explicit = typeof args.tabId === 'number' ? await safeGetTab(args.tabId) : null;
  if (explicit && typeof explicit.id === 'number') return explicit.id;
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

async function safeGetTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

/**
 * Capture an a11y tree for the tab and store the UID map.
 * Returns the formatted text and snapshotId.
 */
async function captureSnapshot(tabId: number): Promise<{
  snapshotId: string;
  text: string;
  uidCount: number;
}> {
  await ensureAttached(tabId);
  const result = await sendCommand<{ nodes: AXNode[] }>(tabId, 'Accessibility.getFullAXTree');
  const nodes: AXNode[] = (result && result.nodes) || [];
  const { text, uidMap } = formatAxTree(nodes);
  const snapshotId = newSnapshotId();
  storeSnapshot(tabId, {
    snapshotId,
    uidToBackendNodeId: uidMap,
    capturedAt: Date.now(),
  });
  return { snapshotId, text, uidCount: uidMap.size };
}

// -----------------------------------------------------------------------------
// chrome_snapshot
// -----------------------------------------------------------------------------

class SnapshotToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SNAPSHOT;

  async execute(args: SnapshotArgs): Promise<ToolResult> {
    console.log(`[snapshot] capture requested:`, args);
    try {
      const tabId = await resolveTabId(args ?? {});
      const { snapshotId, text, uidCount } = await captureSnapshot(tabId);
      const header = `Snapshot ${snapshotId} — ${uidCount} interactive elements\n\n`;
      return {
        content: [{ type: 'text', text: header + text }],
        isError: false,
      };
    } catch (error) {
      console.error('[snapshot] capture failed:', error);
      return createErrorResponse(
        `chrome_snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// -----------------------------------------------------------------------------
// chrome_snapshot_click
// -----------------------------------------------------------------------------

class SnapshotClickToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SNAPSHOT_CLICK;

  async execute(args: SnapshotClickArgs): Promise<ToolResult> {
    console.log(`[snapshot] click requested:`, args);
    try {
      if (typeof args?.uid !== 'number') {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': uid (number) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);
      const backendNodeId = resolveUid(tabId, args.uid);

      // Best-effort scroll into view; ignore failures.
      try {
        await sendCommand(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId });
      } catch (e) {
        console.warn('[snapshot] scrollIntoViewIfNeeded failed (continuing):', e);
      }

      // Resolve to JS object, then call .click() on it.
      const resolved = await sendCommand<{ object: { objectId: string } }>(
        tabId,
        'DOM.resolveNode',
        { backendNodeId },
      );
      const objectId = resolved?.object?.objectId;
      if (!objectId) {
        return createErrorResponse(
          `chrome_snapshot_click: could not resolve uid=${args.uid} to a JS object`,
        );
      }
      const callResult = await sendCommand<{
        result?: { type?: string };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      }>(tabId, 'Runtime.callFunctionOn', {
        objectId,
        functionDeclaration:
          'function(){ if (typeof this.click !== "function") throw new Error("target is not clickable (not an HTMLElement)"); this.click(); }',
        awaitPromise: false,
      });
      if (callResult?.exceptionDetails) {
        const detail =
          callResult.exceptionDetails.exception?.description ??
          callResult.exceptionDetails.text ??
          'unknown JS exception';
        return createErrorResponse(`chrome_snapshot_click failed at uid=${args.uid}: ${detail}`);
      }

      return {
        content: [{ type: 'text', text: `clicked uid=${args.uid}` }],
        isError: false,
      };
    } catch (error) {
      console.error('[snapshot] click failed:', error);
      return createErrorResponse(
        `chrome_snapshot_click failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// -----------------------------------------------------------------------------
// chrome_snapshot_fill
// -----------------------------------------------------------------------------

class SnapshotFillToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SNAPSHOT_FILL;

  async execute(args: SnapshotFillArgs): Promise<ToolResult> {
    console.log(`[snapshot] fill requested:`, args);
    try {
      if (typeof args?.uid !== 'number') {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': uid (number) is required',
        );
      }
      if (args.value === undefined || args.value === null) {
        return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': value is required');
      }

      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);
      const backendNodeId = resolveUid(tabId, args.uid);
      const value = String(args.value);

      // Resolve so we can introspect the target element and do contenteditable
      // fallback via a single round-trip.
      const resolved = await sendCommand<{ object: { objectId: string } }>(
        tabId,
        'DOM.resolveNode',
        { backendNodeId },
      );
      const objectId = resolved?.object?.objectId;
      if (!objectId) {
        return createErrorResponse(
          `chrome_snapshot_fill: could not resolve uid=${args.uid} to a JS object`,
        );
      }

      // Inspect kind: 'input' (INPUT/TEXTAREA), 'contenteditable', or 'unsupported'.
      const kindResult = await sendCommand<{
        result?: { value?: 'input' | 'contenteditable' | 'unsupported' };
        exceptionDetails?: { text?: string };
      }>(tabId, 'Runtime.callFunctionOn', {
        objectId,
        functionDeclaration:
          'function(){ if (!(this instanceof Element)) return "unsupported"; const tn = this.tagName; if (tn === "INPUT" || tn === "TEXTAREA") return "input"; if (this.isContentEditable) return "contenteditable"; return "unsupported"; }',
        returnByValue: true,
        awaitPromise: false,
      });
      const kind = kindResult?.result?.value ?? 'unsupported';
      if (kind === 'unsupported') {
        return createErrorResponse(
          `chrome_snapshot_fill: uid=${args.uid} is not a fillable element (not INPUT/TEXTAREA/contenteditable)`,
        );
      }

      await sendCommand(tabId, 'DOM.focus', { backendNodeId });

      if (kind === 'contenteditable') {
        // `Input.insertText` is a no-op for contenteditable in modern Chrome.
        // Use execCommand for the clear+insert path — fires the same input/beforeinput
        // events that frameworks like ProseMirror, Lexical, CodeMirror watch for.
        const editResult = await sendCommand<{ exceptionDetails?: { text?: string } }>(
          tabId,
          'Runtime.callFunctionOn',
          {
            objectId,
            functionDeclaration:
              'function(v){ this.focus(); const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents(this); sel.removeAllRanges(); sel.addRange(range); document.execCommand("insertText", false, v); }',
            arguments: [{ value }],
            awaitPromise: false,
          },
        );
        if (editResult?.exceptionDetails) {
          return createErrorResponse(
            `chrome_snapshot_fill (contenteditable): ${editResult.exceptionDetails.text ?? 'unknown error'}`,
          );
        }
      } else {
        // INPUT / TEXTAREA: select-all via key event then insertText.
        // The `text` field must be set on keyDown for Chrome to act on Ctrl/Cmd+A
        // (the text-editing subsystem ignores synthetic modifier+key without it).
        const isMac = detectMac();
        const modifiers = isMac ? 4 /* Meta */ : 2; /* Ctrl */
        await sendCommand(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyDown',
          modifiers,
          key: 'a',
          code: 'KeyA',
          text: '\x01',
          windowsVirtualKeyCode: 65,
          nativeVirtualKeyCode: 65,
        });
        await sendCommand(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          modifiers,
          key: 'a',
          code: 'KeyA',
          windowsVirtualKeyCode: 65,
          nativeVirtualKeyCode: 65,
        });
        await sendCommand(tabId, 'Input.insertText', { text: value });
      }

      return {
        content: [{ type: 'text', text: `filled uid=${args.uid}` }],
        isError: false,
      };
    } catch (error) {
      console.error('[snapshot] fill failed:', error);
      return createErrorResponse(
        `chrome_snapshot_fill failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// -----------------------------------------------------------------------------
// chrome_snapshot_hover
// -----------------------------------------------------------------------------

class SnapshotHoverToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SNAPSHOT_HOVER;

  async execute(args: SnapshotHoverArgs): Promise<ToolResult> {
    console.log(`[snapshot] hover requested:`, args);
    try {
      if (typeof args?.uid !== 'number') {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': uid (number) is required',
        );
      }
      const tabId = await resolveTabId(args);
      await ensureAttached(tabId);
      const backendNodeId = resolveUid(tabId, args.uid);

      // scrollIntoViewIfNeeded returns when the CDP command is issued, not when
      // a smooth-scroll animation settles. For elements in smoothly-scrolled
      // containers, getContentQuads below may still return empty quads — the
      // model can retry hover after a short wait_for.
      try {
        await sendCommand(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId });
      } catch (e) {
        console.warn('[snapshot] scrollIntoViewIfNeeded failed (continuing):', e);
      }

      const quadsResp = await sendCommand<{ quads: number[][] }>(tabId, 'DOM.getContentQuads', {
        backendNodeId,
      });
      const quads = quadsResp?.quads;
      if (!quads || quads.length === 0 || !Array.isArray(quads[0]) || quads[0].length < 8) {
        return createErrorResponse(
          `chrome_snapshot_hover: element uid=${args.uid} has no visible content quads`,
        );
      }
      // Quad is [x1,y1,x2,y2,x3,y3,x4,y4]; pick center.
      const q = quads[0];
      const cx = (q[0] + q[2] + q[4] + q[6]) / 4;
      const cy = (q[1] + q[3] + q[5] + q[7]) / 4;

      await sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: cx,
        y: cy,
        button: 'none',
      });

      return {
        content: [{ type: 'text', text: `hovered uid=${args.uid}` }],
        isError: false,
      };
    } catch (error) {
      console.error('[snapshot] hover failed:', error);
      return createErrorResponse(
        `chrome_snapshot_hover failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// -----------------------------------------------------------------------------
// chrome_snapshot_wait_for
// -----------------------------------------------------------------------------

class SnapshotWaitForToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SNAPSHOT_WAIT_FOR;

  async execute(args: SnapshotWaitForArgs): Promise<ToolResult> {
    console.log(`[snapshot] wait_for requested:`, args);
    try {
      const text = args?.text;
      const role = args?.role;
      if (!text && !role) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': provide text and/or role to wait for',
        );
      }
      const timeoutMs =
        typeof args?.timeoutMs === 'number' && args.timeoutMs > 0
          ? Math.min(args.timeoutMs, 120_000)
          : 10_000;
      const pollIntervalMs = 250;

      const tabId = await resolveTabId(args);

      const start = Date.now();
      let lastError: unknown = null;
      let matched = false;

      while (Date.now() - start < timeoutMs) {
        try {
          await ensureAttached(tabId);
          const result = await sendCommand<{ nodes: AXNode[] }>(
            tabId,
            'Accessibility.getFullAXTree',
          );
          const nodes: AXNode[] = (result && result.nodes) || [];
          if (matches(nodes, role, text)) {
            matched = true;
            break;
          }
        } catch (e) {
          lastError = e;
        }
        await sleep(pollIntervalMs);
      }

      if (!matched) {
        const reason = lastError
          ? ` (last error: ${lastError instanceof Error ? lastError.message : String(lastError)})`
          : '';
        return createErrorResponse(
          `chrome_snapshot_wait_for: timed out after ${timeoutMs}ms waiting for ` +
            `${role ? `role="${role}"` : ''}${role && text ? ' + ' : ''}` +
            `${text ? `text~"${text}"` : ''}${reason}`,
        );
      }

      // Capture a fresh snapshot so the model gets new UIDs.
      const { snapshotId, text: treeText, uidCount } = await captureSnapshot(tabId);
      const header = `Matched after ${Date.now() - start}ms. Snapshot ${snapshotId} — ${uidCount} interactive elements\n\n`;
      return {
        content: [{ type: 'text', text: header + treeText }],
        isError: false,
      };
    } catch (error) {
      console.error('[snapshot] wait_for failed:', error);
      return createErrorResponse(
        `chrome_snapshot_wait_for failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function axRole(node: AXNode): string {
  return typeof node.role === 'string' ? node.role : (node.role?.value ?? '');
}

function axName(node: AXNode): string {
  return typeof node.name === 'string' ? node.name : (node.name?.value ?? '').toString();
}

function matches(nodes: AXNode[], role?: string, text?: string): boolean {
  const roleLower = role ? role.toLowerCase() : null;
  const textLower = text ? text.toLowerCase() : null;
  for (const n of nodes) {
    if (n.ignored) continue;
    const nodeRole = axRole(n).toLowerCase();
    const nodeName = axName(n).toLowerCase();
    if (roleLower && textLower) {
      if (nodeRole === roleLower && nodeName.includes(textLower)) return true;
    } else if (roleLower) {
      if (nodeRole === roleLower) return true;
    } else if (textLower) {
      if (nodeName.includes(textLower)) return true;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

// Per plan, export under PascalCase names. These are RUNTIME INSTANCES (not
// classes) so that tools/index.ts can read `.name` to register them in the
// tool map. Deviation note in report.
export const SnapshotTool = new SnapshotToolImpl();
export const SnapshotClickTool = new SnapshotClickToolImpl();
export const SnapshotFillTool = new SnapshotFillToolImpl();
export const SnapshotHoverTool = new SnapshotHoverToolImpl();
export const SnapshotWaitForTool = new SnapshotWaitForToolImpl();
