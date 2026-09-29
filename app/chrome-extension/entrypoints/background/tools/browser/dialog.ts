import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'workatomcp-shared';
import { cdpSessionManager } from '@/utils/cdp-session-manager';
import { clearDialog, getDialog } from './dialog-tracker';

/** How long to let Chrome report a dialog that was already open before answering it. */
const DIALOG_REPORT_WAIT_MS = 1500;
const HANDLE_TIMEOUT_MS = 5000;

interface HandleDialogParams {
  action: 'accept' | 'dismiss';
  promptText?: string;
  tabId?: number;
}

/**
 * Handle JavaScript dialogs (alert/confirm/prompt) via CDP Page.handleJavaScriptDialog
 */
class HandleDialogTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.HANDLE_DIALOG;

  async execute(args: HandleDialogParams): Promise<ToolResult> {
    const { action, promptText } = args || ({} as HandleDialogParams);
    if (!action || (action !== 'accept' && action !== 'dismiss')) {
      return createErrorResponse('action must be "accept" or "dismiss"');
    }

    try {
      const explicit = await this.tryGetTab(args.tabId);
      const [activeTab] = explicit
        ? [explicit]
        : await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return createErrorResponse('No active tab found');
      const tabId = activeTab.id!;

      // Use shared CDP session manager for safe attach/detach with refcount.
      // Page.enable also makes Chrome report a dialog that was already showing,
      // so the tracker knows what is being answered.
      let answered: { type: string; message: string } | null = null;
      await cdpSessionManager.withSession(tabId, 'dialog', async () => {
        // Never await Page.enable here: its renderer half cannot answer while a
        // dialog blocks the page, so awaiting it hangs exactly when we need it.
        // The browser half registers at once and reports the open dialog.
        cdpSessionManager.sendCommand(tabId, 'Page.enable').catch(() => undefined);
        const until = Date.now() + DIALOG_REPORT_WAIT_MS;
        while (Date.now() < until && !getDialog(tabId)?.confirmed) {
          await new Promise((r) => setTimeout(r, 50));
        }
        const tracked = getDialog(tabId);
        if (tracked) answered = { type: tracked.type, message: tracked.message };
        try {
          await Promise.race([
            cdpSessionManager.sendCommand(tabId, 'Page.handleJavaScriptDialog', {
              accept: action === 'accept',
              promptText: action === 'accept' ? promptText : undefined,
            }),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Chrome did not answer the dialog request in time.')),
                HANDLE_TIMEOUT_MS,
              ),
            ),
          ]);
        } catch (e) {
          const text = e instanceof Error ? e.message : String(e);
          if (/no dialog/i.test(text)) {
            const suspected = getDialog(tabId);
            clearDialog(tabId);
            if (suspected && !suspected.confirmed) {
              throw new Error(
                `Tab ${tabId} looks blocked by a JS dialog that opened before this extension was watching the tab, ` +
                  'and Chrome only lets the client that saw it open answer it. Ask the user to click it, ' +
                  'or reload the tab with chrome_navigate(refresh:true) (unsaved page state is lost).',
              );
            }
            throw new Error(`No JS dialog is open on tab ${tabId}; nothing to ${action}.`);
          }
          throw e;
        }
      });
      clearDialog(tabId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              action,
              promptText: promptText || null,
              tabId,
              dialog: answered,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return createErrorResponse(
        `Failed to handle dialog: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const handleDialogTool = new HandleDialogTool();
