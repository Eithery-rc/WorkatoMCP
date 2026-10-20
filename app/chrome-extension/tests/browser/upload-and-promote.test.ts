import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_NAMES, TOOL_SCHEMAS } from '@mokuhub/mokutab-shared';

const resolveElement = vi.fn();
const snapshotSendCommand = vi.fn();

vi.mock('@/entrypoints/background/tools/browser/snapshot/element-actions', () => ({
  resolveElement: (...args: unknown[]) => resolveElement(...args),
}));
vi.mock('@/entrypoints/background/tools/browser/snapshot/debugger-session', () => ({
  sendCommand: (...args: unknown[]) => snapshotSendCommand(...args),
}));

import { fileUploadTool } from '@/entrypoints/background/tools/browser/file-upload';
import {
  buildScreenshotContent,
  screenshotTool,
} from '@/entrypoints/background/tools/browser/screenshot';
import { openAgentTab } from '@/entrypoints/background/agent-tabs';

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((block) => block.text ?? '').join('\n');
}

describe('chrome_upload_file by uid', () => {
  beforeEach(() => {
    resolveElement.mockReset();
    snapshotSendCommand.mockReset();
    (chrome.tabs.get as any) = vi.fn().mockResolvedValue({ id: 3, windowId: 1, active: true });
  });

  it('serves uid next to selector, neither required', () => {
    const schema = TOOL_SCHEMAS.find((tool) => tool.name === TOOL_NAMES.BROWSER.FILE_UPLOAD);
    const props = schema?.inputSchema.properties as Record<string, any>;
    expect(props.uid).toMatchObject({ type: 'number' });
    expect(schema?.inputSchema.required).toEqual([]);
  });

  it('refuses a call with neither selector nor uid', async () => {
    const result = await fileUploadTool.execute({ tabId: 3, filePath: 'C:/x.pdf' } as any);
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/selector or uid/);
  });

  it('sets the files on the snapshot element through the snapshot session', async () => {
    resolveElement.mockResolvedValue({ uid: 12, backendNodeId: 99, objectId: 'obj-12' });
    snapshotSendCommand.mockImplementation(async (_tab: number, method: string) => {
      if (method === 'DOM.describeNode') return { node: { nodeName: 'INPUT' } };
      if (method === 'Runtime.callFunctionOn') return { result: { value: 'file' } };
      return {};
    });

    const result = await fileUploadTool.execute({ tabId: 3, uid: 12, filePath: 'C:/x.pdf' });

    expect(result.isError).toBe(false);
    expect(resolveElement).toHaveBeenCalledWith(3, 12);
    expect(snapshotSendCommand).toHaveBeenCalledWith(3, 'DOM.setFileInputFiles', {
      objectId: 'obj-12',
      files: ['C:/x.pdf'],
    });
    expect(JSON.parse(text(result))).toMatchObject({ success: true, uid: 12, fileCount: 1 });
  });

  it('refuses a uid that is not a file input and sets nothing', async () => {
    resolveElement.mockResolvedValue({ uid: 7, backendNodeId: 70, objectId: 'obj-7' });
    snapshotSendCommand.mockImplementation(async (_tab: number, method: string) => {
      if (method === 'DOM.describeNode') return { node: { nodeName: 'INPUT' } };
      if (method === 'Runtime.callFunctionOn') return { result: { value: 'text' } };
      return {};
    });

    const result = await fileUploadTool.execute({ tabId: 3, uid: 7, filePath: 'C:/x.pdf' });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/not a file input/);
    const methods = snapshotSendCommand.mock.calls.map((call) => call[1]);
    expect(methods).not.toContain('DOM.setFileInputFiles');
  });
});

describe('chrome_screenshot of a hidden tab', () => {
  beforeEach(() => {
    (chrome as any).windows = {
      create: vi.fn().mockResolvedValue({ id: 900, tabs: [{ id: 901 }] }),
      get: vi.fn().mockResolvedValue({ id: 900, state: 'normal' }),
    };
    (chrome as any).storage.session = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    };
    (chrome.tabs.create as any) = vi.fn().mockResolvedValue({ id: 902 });
  });

  it('keeps refusing a full-page capture of a hidden tab outside the agents window', async () => {
    await openAgentTab({});
    (chrome.windows.create as any).mockClear();
    (chrome.tabs.get as any) = vi
      .fn()
      .mockResolvedValue({ id: 5, windowId: 1, active: false, url: 'https://example.com' });

    const result = await screenshotTool.execute({ name: 's', tabId: 5, fullPage: true });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/is not the visible tab/);
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('moves a hidden agents-window tab to its own window for a full-page capture', async () => {
    const opened = await openAgentTab({});
    (chrome.windows.create as any).mockReset().mockResolvedValue({ id: 950 });
    const hidden = {
      id: 902,
      windowId: opened.windowId,
      active: false,
      url: 'https://example.com',
    };
    // The tool's own lookup, then promoteToOwnWindow's, then the moved tab.
    (chrome.tabs.get as any) = vi
      .fn()
      .mockResolvedValueOnce(hidden)
      .mockResolvedValueOnce(hidden)
      .mockResolvedValue({ ...hidden, windowId: 950, active: true });

    const result = await screenshotTool.execute({ name: 's', tabId: 902, fullPage: true });

    expect(chrome.windows.create).toHaveBeenCalledWith({ tabId: 902, focused: false });
    // The capture itself needs a real page; the visibility refusal must be gone.
    expect(text(result)).not.toMatch(/is not the visible tab/);
  });

  it('reports the move in the metadata', () => {
    const content = buildScreenshotContent({ name: 's', tabId: 902, movedToWindow: 950 });
    expect(JSON.parse((content[0] as { text: string }).text)).toMatchObject({
      moved_to_window: 950,
    });
  });
});
