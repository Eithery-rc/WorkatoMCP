/**
 * Snapshot+UID tool family.
 *
 *   - chrome_snapshot           capture the accessibility tree with stable uids and element state
 *   - chrome_snapshot_click     real mouse click by uid (covered/disabled/select/file handled)
 *   - chrome_snapshot_fill      set a value by uid, per element kind, read back
 *   - chrome_snapshot_hover     hover by uid
 *   - chrome_snapshot_wait_for  poll until a role/text appears, then return a fresh snapshot
 *
 * The acting tools refuse while a JS dialog is open, run inside runWithSettle
 * (wait for what the action caused, then report the page), and can append a
 * snapshot taken after settling. The element logic lives in element-actions.ts
 * so chrome_act and chrome_snapshot_fill_form share it.
 */

import { getDialog } from '../dialog-tracker';
import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor, getTabOrThrow } from '../../base-browser';
import { appendPageReport, assertNoOpenDialog, DialogOpenError, runWithSettle } from '../settle';
import { captureSnapshot } from './capture';
import { clickUid, fillUid, hoverUid, waitForTexts } from './element-actions';
import { getTabUids } from './uid-store';

export interface TabTargetArgs {
  tabId?: number;
  windowId?: number;
}

export interface SettleArgs {
  settle?: boolean;
  settleTimeoutMs?: number;
  includeSnapshot?: boolean;
}

type SnapshotArgs = TabTargetArgs;
interface SnapshotClickArgs extends TabTargetArgs, SettleArgs {
  uid: number;
  double?: boolean;
}
interface SnapshotFillArgs extends TabTargetArgs, SettleArgs {
  uid: number;
  value: string;
}
interface SnapshotHoverArgs extends TabTargetArgs, SettleArgs {
  uid: number;
}
interface SnapshotWaitForArgs extends TabTargetArgs {
  text?: string | string[];
  role?: string;
  timeoutMs?: number;
}

/** Resolve the target tab: a given tabId must exist; otherwise the active tab. */
export async function resolveTabId(args: TabTargetArgs): Promise<number> {
  // A given tabId that no longer exists is an error, never the active tab.
  if (typeof args.tabId === 'number') {
    const explicit = await getTabOrThrow(args.tabId);
    if (typeof explicit.id === 'number') return explicit.id;
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

export function snapshotText(snap: { text: string; uidCount: number; seq: number }): string {
  return `Snapshot ${snap.seq}: ${snap.uidCount} elements with uids\n\n${snap.text}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run an acting tool: refuse while a dialog is open, settle, report the page,
 * optionally append a fresh snapshot. `run` returns the one-line result.
 */
export async function runActing(
  toolName: string,
  tabId: number,
  args: SettleArgs,
  run: () => Promise<string>,
): Promise<ToolResult> {
  try {
    assertNoOpenDialog(tabId);
    const { result, page } = await runWithSettle(tabId, run, {
      settle: args.settle,
      settleTimeoutMs: args.settleTimeoutMs,
    });
    let reply: ToolResult = appendPageReport(
      { content: [{ type: 'text', text: result }], isError: false },
      page,
    );
    if (args.includeSnapshot) {
      try {
        const snap = await captureSnapshot(tabId);
        const first = reply.content[0] as { type: 'text'; text: string };
        reply = {
          ...reply,
          content: [{ type: 'text', text: `${first.text}\n\n${snapshotText(snap)}` }],
        };
      } catch (e) {
        const first = reply.content[0] as { type: 'text'; text: string };
        reply = {
          ...reply,
          content: [
            {
              type: 'text',
              text: `${first.text}\n(snapshot after the action failed: ${errorText(e)})`,
            },
          ],
        };
      }
    }
    return reply;
  } catch (error) {
    if (error instanceof DialogOpenError && error.openedByAction) {
      // The action ran; the page now waits on the dialog. Not a failure to retry.
      return { content: [{ type: 'text', text: error.message }], isError: false };
    }
    return createErrorResponse(`${toolName} failed: ${errorText(error)}`);
  }
}

// -----------------------------------------------------------------------------
// chrome_snapshot
// -----------------------------------------------------------------------------

class SnapshotToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SNAPSHOT;

  async execute(args: SnapshotArgs): Promise<ToolResult> {
    try {
      const tabId = await resolveTabId(args ?? {});
      // A page blocked by a JS dialog cannot be read; say so instead of hanging.
      const dialog = getDialog(tabId);
      if (dialog?.confirmed) {
        return {
          content: [
            {
              type: 'text',
              text:
                `A JS ${dialog.type} dialog is open on tab ${tabId}: "${dialog.message}". ` +
                'The page cannot be read until it is answered: call chrome_handle_dialog (accept or dismiss).',
            },
          ],
          isError: false,
        };
      }
      const snap = await captureSnapshot(tabId);
      return { content: [{ type: 'text', text: snapshotText(snap) }], isError: false };
    } catch (error) {
      console.error('[snapshot] capture failed:', error);
      return createErrorResponse(`chrome_snapshot failed: ${errorText(error)}`);
    }
  }
}

// -----------------------------------------------------------------------------
// chrome_snapshot_click
// -----------------------------------------------------------------------------

class SnapshotClickToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SNAPSHOT_CLICK;

  async execute(args: SnapshotClickArgs): Promise<ToolResult> {
    if (typeof args?.uid !== 'number') {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': uid (number) is required');
    }
    try {
      const tabId = await resolveTabId(args);
      return runActing(this.name, tabId, args, () =>
        clickUid(tabId, args.uid, args.double === true),
      );
    } catch (error) {
      return createErrorResponse(`${this.name} failed: ${errorText(error)}`);
    }
  }
}

// -----------------------------------------------------------------------------
// chrome_snapshot_fill
// -----------------------------------------------------------------------------

class SnapshotFillToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SNAPSHOT_FILL;

  async execute(args: SnapshotFillArgs): Promise<ToolResult> {
    if (typeof args?.uid !== 'number') {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': uid (number) is required');
    }
    if (args.value === undefined || args.value === null) {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': value is required');
    }
    try {
      const tabId = await resolveTabId(args);
      return runActing(this.name, tabId, args, () => fillUid(tabId, args.uid, args.value));
    } catch (error) {
      return createErrorResponse(`${this.name} failed: ${errorText(error)}`);
    }
  }
}

// -----------------------------------------------------------------------------
// chrome_snapshot_hover
// -----------------------------------------------------------------------------

class SnapshotHoverToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SNAPSHOT_HOVER;

  async execute(args: SnapshotHoverArgs): Promise<ToolResult> {
    if (typeof args?.uid !== 'number') {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': uid (number) is required');
    }
    try {
      const tabId = await resolveTabId(args);
      return runActing(this.name, tabId, args, () => hoverUid(tabId, args.uid));
    } catch (error) {
      return createErrorResponse(`${this.name} failed: ${errorText(error)}`);
    }
  }
}

// -----------------------------------------------------------------------------
// chrome_snapshot_wait_for
// -----------------------------------------------------------------------------

class SnapshotWaitForToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SNAPSHOT_WAIT_FOR;

  async execute(args: SnapshotWaitForArgs): Promise<ToolResult> {
    try {
      const texts = (Array.isArray(args?.text) ? args.text : args?.text ? [args.text] : [])
        .map((t) => String(t))
        .filter((t) => t.length > 0);
      const role = args?.role;
      if (!texts.length && !role) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS + ': provide text and/or role to wait for',
        );
      }
      const timeoutMs =
        typeof args?.timeoutMs === 'number' && args.timeoutMs > 0
          ? Math.min(args.timeoutMs, 120_000)
          : 10_000;
      const tabId = await resolveTabId(args);
      const start = Date.now();
      const hit = await waitForTexts(tabId, texts, role, timeoutMs);
      const snap = await captureSnapshot(tabId);
      let found = `found ${hit.role} "${hit.name}" after ${Date.now() - start}ms`;
      if (typeof hit.backendNodeId === 'number') {
        const state = await getTabUids(tabId);
        for (const [uid, ref] of state.byUid) {
          if (ref.backendNodeId === hit.backendNodeId) {
            found += ` uid=${uid}`;
            break;
          }
        }
      }
      return {
        content: [{ type: 'text', text: `${found}\n\n${snapshotText(snap)}` }],
        isError: false,
      };
    } catch (error) {
      console.error('[snapshot] wait_for failed:', error);
      return createErrorResponse(`chrome_snapshot_wait_for failed: ${errorText(error)}`);
    }
  }
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

// RUNTIME INSTANCES (not classes) so that tools/index.ts can read `.name` to
// register them in the tool map.
export const SnapshotTool = new SnapshotToolImpl();
export const SnapshotClickTool = new SnapshotClickToolImpl();
export const SnapshotFillTool = new SnapshotFillToolImpl();
export const SnapshotHoverTool = new SnapshotHoverToolImpl();
export const SnapshotWaitForTool = new SnapshotWaitForToolImpl();
