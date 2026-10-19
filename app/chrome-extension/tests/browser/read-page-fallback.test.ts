/**
 * chrome_read_page falls back to interactive-elements-helper.js when the
 * accessibility tree is too sparse. The helper must actually be injected: the
 * accessibility helper already in the tab answers chrome_read_page_ping, so the
 * fallback has to ping with the interactive-elements helper's own name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';

const chromeAny = (globalThis as any).chrome;

describe('chrome_read_page interactive-elements fallback', () => {
  let injected: Set<string>;
  let originalSendMessage: unknown;
  let originalGet: unknown;
  let originalScripting: unknown;

  beforeEach(() => {
    injected = new Set();
    originalSendMessage = chromeAny.tabs.sendMessage;
    originalGet = chromeAny.tabs.get;
    originalScripting = chromeAny.scripting;
    chromeAny.tabs.get = vi.fn().mockResolvedValue({ id: 7, url: 'https://example.com/' });
    chromeAny.scripting = {
      executeScript: vi.fn(async (opts: { files: string[] }) => {
        for (const file of opts.files) injected.add(file);
        return [];
      }),
    };
    chromeAny.tabs.sendMessage = vi.fn(async (_tabId: number, message: { action: string }) => {
      const a11y = injected.has('inject-scripts/accessibility-tree-helper.js');
      const interactive = injected.has('inject-scripts/interactive-elements-helper.js');
      switch (message.action) {
        case 'chrome_read_page_ping':
          if (a11y) return { status: 'pong' };
          throw new Error('Receiving end does not exist.');
        case 'chrome_get_interactive_elements_ping':
          if (interactive) return { status: 'pong' };
          throw new Error('Receiving end does not exist.');
        case 'generateAccessibilityTree':
          // A sparse tree: no lines, no refs, so read_page takes the fallback.
          return { success: true, pageContent: '', refMap: [], stats: {}, viewport: {} };
        case 'getInteractiveElements':
          if (!interactive) return undefined;
          return {
            success: true,
            elements: [{ type: 'button', selector: '#go', text: 'Go', isInteractive: true }],
          };
        default:
          return undefined;
      }
    });
  });

  afterEach(() => {
    chromeAny.tabs.sendMessage = originalSendMessage;
    chromeAny.tabs.get = originalGet;
    chromeAny.scripting = originalScripting;
  });

  it('injects the interactive-elements helper and returns its elements', async () => {
    const result = await readPageTool.execute({ tabId: 7 });

    expect(result.isError).toBe(false);
    expect(injected.has('inject-scripts/interactive-elements-helper.js')).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.fallbackUsed).toBe(true);
    expect(payload.elements).toEqual([
      { type: 'button', selector: '#go', text: 'Go', isInteractive: true },
    ]);
    expect(payload).not.toHaveProperty('markedElements');
  });
});
