import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'workatomcp-shared';

class WindowTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS;
  async execute(args?: { filter?: string }): Promise<ToolResult> {
    try {
      const filter =
        typeof args?.filter === 'string' && args.filter.trim().length > 0
          ? args.filter.trim().toLowerCase()
          : null;
      const windows = await chrome.windows.getAll({ populate: true });
      let tabCount = 0;

      const structuredWindows = windows
        .map((window) => {
          const tabs =
            window.tabs
              ?.filter(
                (tab) =>
                  !filter ||
                  (tab.url ?? '').toLowerCase().includes(filter) ||
                  (tab.title ?? '').toLowerCase().includes(filter),
              )
              .map((tab) => {
                tabCount++;
                return {
                  tabId: tab.id || 0,
                  url: tab.url || '',
                  title: tab.title || '',
                  active: tab.active || false,
                };
              }) || [];

          return {
            windowId: window.id || 0,
            tabs: tabs,
          };
        })
        // With a filter, drop windows that have no matching tabs — returning
        // 25 unrelated personal tabs to find one Workato tab is both token
        // waste and a privacy leak.
        .filter((w) => !filter || w.tabs.length > 0);

      const result = {
        windowCount: structuredWindows.length,
        tabCount: tabCount,
        ...(filter ? { filter } : {}),
        windows: structuredWindows,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in WindowTool.execute:', error);
      return createErrorResponse(
        `Error getting windows and tabs information: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const windowTool = new WindowTool();
