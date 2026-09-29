/**
 * chrome_snapshot_fill_form and chrome_act: several uid actions in one call.
 *
 * Every model round trip costs seconds, so a form or a short click path is
 * worth sending at once. chrome_act runs its actions in order and stops at the
 * first failure, and after any action whose page report shows a navigation, a
 * new tab or a dialog: the remaining uids would target a page that changed.
 */

import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { TOOL_NAMES } from 'workatomcp-shared';
import { BaseBrowserToolExecutor } from '../../base-browser';
import {
  appendPageReport,
  assertNoOpenDialog,
  DialogOpenError,
  formatPageReport,
  runWithSettle,
  type PageReport,
} from '../settle';
import { captureSnapshot } from './capture';
import { clickUid, fillUid, hoverUid, pressKey, waitForTexts } from './element-actions';
import {
  resolveTabId,
  runActing,
  snapshotText,
  type SettleArgs,
  type TabTargetArgs,
} from './handlers';

const MAX_ACTIONS = 30;
const MAX_FIELDS = 50;
const DEFAULT_WAIT_FOR_MS = 5000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// -----------------------------------------------------------------------------
// chrome_snapshot_fill_form
// -----------------------------------------------------------------------------

interface FillFormArgs extends TabTargetArgs, SettleArgs {
  fields?: Array<{ uid: number; value: string }>;
}

class SnapshotFillFormToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SNAPSHOT_FILL_FORM;

  async execute(args: FillFormArgs): Promise<ToolResult> {
    const fields = Array.isArray(args?.fields) ? args.fields : [];
    if (!fields.length) {
      return createErrorResponse(
        ERROR_MESSAGES.INVALID_PARAMETERS + ': fields [{uid, value}] is required',
      );
    }
    if (fields.length > MAX_FIELDS) {
      return createErrorResponse(`${this.name}: at most ${MAX_FIELDS} fields per call`);
    }
    try {
      const tabId = await resolveTabId(args);
      return runActing(this.name, tabId, args, async () => {
        const lines: string[] = [];
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          try {
            lines.push(`${i + 1}. ${await fillUid(tabId, Number(f?.uid), f?.value)}`);
          } catch (e) {
            lines.push(`${i + 1}. uid=${f?.uid}: FAILED: ${errorText(e)}`);
            throw new Error(
              `${lines.join('\n')}\nstopped at field ${i + 1} of ${fields.length}; the fields before it were filled`,
            );
          }
        }
        return lines.join('\n');
      });
    } catch (error) {
      return createErrorResponse(`${this.name} failed: ${errorText(error)}`);
    }
  }
}

// -----------------------------------------------------------------------------
// chrome_act
// -----------------------------------------------------------------------------

interface ActStep {
  action?: string;
  uid?: number;
  value?: string;
  key?: string;
  text?: string;
  timeoutMs?: number;
}

interface ActArgs extends TabTargetArgs {
  actions?: ActStep[];
  includeSnapshot?: boolean;
}

async function runStep(tabId: number, step: ActStep): Promise<string> {
  switch (step.action) {
    case 'click':
      return clickUid(tabId, Number(step.uid), false);
    case 'double_click':
      return clickUid(tabId, Number(step.uid), true);
    case 'fill':
      return fillUid(tabId, Number(step.uid), step.value);
    case 'hover':
      return hoverUid(tabId, Number(step.uid));
    case 'press_key':
      return pressKey(tabId, step.key);
    case 'wait_for': {
      if (!step.text) throw new Error('wait_for needs text');
      const timeout =
        typeof step.timeoutMs === 'number' && step.timeoutMs > 0
          ? Math.min(step.timeoutMs, 60_000)
          : DEFAULT_WAIT_FOR_MS;
      const hit = await waitForTexts(tabId, [String(step.text)], undefined, timeout);
      return `found ${hit.role} "${hit.name}"`;
    }
    default:
      throw new Error(`unknown action "${step.action}"`);
  }
}

function stopReason(page: PageReport | null): string | null {
  if (!page) return null;
  if (page.dialog) return 'a JS dialog opened (answer it with chrome_handle_dialog)';
  if (page.navigated) return 'the page navigated';
  if (page.new_tabs?.length) return 'a new tab opened';
  return null;
}

function describeStep(i: number, step: ActStep): string {
  const target =
    step.uid !== undefined
      ? ` uid=${step.uid}`
      : step.key
        ? ` ${step.key}`
        : step.text
          ? ` "${step.text}"`
          : '';
  return `${i + 1}. ${step.action}${target}`;
}

class ActToolImpl extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.ACT;

  async execute(args: ActArgs): Promise<ToolResult> {
    const actions = Array.isArray(args?.actions) ? args.actions : [];
    if (!actions.length) {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': actions is required');
    }
    if (actions.length > MAX_ACTIONS) {
      return createErrorResponse(`${this.name}: at most ${MAX_ACTIONS} actions per call`);
    }
    let tabId: number;
    try {
      tabId = await resolveTabId(args);
    } catch (error) {
      return createErrorResponse(`${this.name} failed: ${errorText(error)}`);
    }

    const lines: string[] = [];
    let lastPage: PageReport | null = null;
    let failed = false;
    let stopped: string | null = null;
    let ran = 0;
    for (let i = 0; i < actions.length; i++) {
      const step = actions[i] ?? {};
      try {
        assertNoOpenDialog(tabId);
        const { result, page } = await runWithSettle(tabId, () => runStep(tabId, step));
        lines.push(`${describeStep(i, step)}: ${result}`);
        lastPage = page;
        ran = i + 1;
        const reason = stopReason(page);
        if (reason && i < actions.length - 1) {
          stopped = `stopped after action ${i + 1}: ${reason}; ${actions.length - i - 1} action(s) not run`;
          break;
        }
      } catch (error) {
        ran = i + 1;
        if (error instanceof DialogOpenError && error.openedByAction) {
          lines.push(`${describeStep(i, step)}: ran; ${error.message}`);
          if (i < actions.length - 1)
            stopped = `stopped: ${actions.length - i - 1} action(s) not run`;
          break;
        }
        failed = true;
        lines.push(`${describeStep(i, step)}: FAILED: ${errorText(error)}`);
        if (i < actions.length - 1)
          stopped = `stopped at action ${i + 1}; ${actions.length - i - 1} action(s) not run`;
        break;
      }
    }

    let text = lines.join('\n');
    if (stopped) text += `\n${stopped}`;
    let reply: ToolResult = { content: [{ type: 'text', text }], isError: false };
    if (!failed) reply = appendPageReport(reply, lastPage);
    else if (lastPage)
      reply = {
        content: [{ type: 'text', text: `${text}\n${formatPageReport(lastPage)}` }],
        isError: true,
      };
    else reply = { content: [{ type: 'text', text }], isError: true };

    if (args.includeSnapshot && ran > 0) {
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
          content: [{ type: 'text', text: `${first.text}\n(snapshot failed: ${errorText(e)})` }],
        };
      }
    }
    return reply;
  }
}

export const SnapshotFillFormTool = new SnapshotFillFormToolImpl();
export const ActTool = new ActToolImpl();
