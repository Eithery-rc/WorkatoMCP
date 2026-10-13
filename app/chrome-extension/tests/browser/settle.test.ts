import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendPageReport,
  assertNoOpenDialog,
  DialogOpenError,
  openDialog,
  runWithSettle,
  settleTab,
} from '@/entrypoints/background/tools/browser/settle';
import {
  clearDialog,
  handleDebuggerEvent,
} from '@/entrypoints/background/tools/browser/dialog-tracker';

const chromeAny = globalThis.chrome as any;

/** The CDP event handler dialog-tracker registers on chrome.debugger.onEvent. */
function debuggerEventListener(): (source: any, method: string, params: any) => void {
  return handleDebuggerEvent;
}

function lastListener(event: any) {
  const calls = event.addListener.mock.calls;
  return calls[calls.length - 1][0];
}

describe('dialog tracking', () => {
  it('refuses input while Chrome reports a dialog, and forgets it once closed', () => {
    const fire = debuggerEventListener();
    fire({ tabId: 5 }, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Delete?' });

    expect(openDialog(5)).toEqual({ type: 'confirm', message: 'Delete?' });
    expect(() => assertNoOpenDialog(5)).toThrow(DialogOpenError);
    expect(() => assertNoOpenDialog(5)).toThrow(/chrome_handle_dialog/);

    fire({ tabId: 5 }, 'Page.javascriptDialogClosed', {});
    expect(openDialog(5)).toBeNull();
    expect(() => assertNoOpenDialog(5)).not.toThrow();
  });
});

describe('appendPageReport', () => {
  const page = { url: 'https://x/', title: 'X', navigated: true, settled_ms: 12 };

  it('adds a page field to a JSON reply and a line to a plain one', () => {
    const json = appendPageReport(
      { content: [{ type: 'text', text: '{"success":true}' }], isError: false },
      page,
    );
    expect(JSON.parse((json.content[0] as any).text)).toEqual({ success: true, page });

    const plain = appendPageReport(
      { content: [{ type: 'text', text: 'clicked' }], isError: false },
      page,
    );
    expect((plain.content[0] as any).text).toBe('clicked\npage: navigated to https://x/ (X)');
  });

  it('leaves errors and a missing report alone', () => {
    const error = { content: [{ type: 'text', text: 'boom' }], isError: true } as any;
    expect(appendPageReport(error, page)).toBe(error);
    const ok = { content: [{ type: 'text', text: 'ok' }], isError: false } as any;
    expect(appendPageReport(ok, null)).toBe(ok);
  });
});

describe('runWithSettle', () => {
  const tabId = 77;
  let originalScripting: any;
  let originalWebNavigation: any;

  beforeEach(() => {
    originalScripting = chromeAny.scripting;
    originalWebNavigation = chromeAny.webNavigation;
    chromeAny.debugger.getTargets = vi.fn().mockResolvedValue([]);
  });

  afterEach(() => {
    chromeAny.scripting = originalScripting;
    chromeAny.webNavigation = originalWebNavigation;
    clearDialog(tabId);
    vi.restoreAllMocks();
  });

  it('with settle:false only runs the action', async () => {
    const out = await runWithSettle(tabId, async () => 'done', { settle: false });
    expect(out).toEqual({ result: 'done', page: null });
  });

  it('waits for a navigation the action started and reports the tab it opened', async () => {
    let url = 'https://a/';
    let status = 'complete';
    chromeAny.tabs.get = vi.fn(async () => ({ id: tabId, url, title: url, status, active: true }));
    chromeAny.scripting = {
      executeScript: vi.fn().mockResolvedValue([{ result: { timed_out: false } }]),
    };

    const out = await runWithSettle(tabId, async () => {
      // The click starts a navigation and opens a popup.
      lastListener(chromeAny.tabs.onUpdated)(tabId, { status: 'loading' });
      lastListener(chromeAny.tabs.onCreated)({
        id: 900,
        openerTabId: tabId,
        pendingUrl: 'https://popup/',
      });
      status = 'loading';
      setTimeout(() => {
        url = 'https://b/';
        status = 'complete';
        lastListener(chromeAny.tabs.onUpdated)(tabId, { status: 'complete' });
      }, 50);
      return 'clicked';
    });

    expect(out.result).toBe('clicked');
    expect(out.page).toMatchObject({
      url: 'https://b/',
      navigated: true,
      new_tabs: [{ tabId: 900, url: 'https://popup/' }],
    });
    expect(out.page?.timed_out).toBeUndefined();
  });

  /** Every webNavigation event the watch listens to, each with a mock addListener. */
  function mockWebNavigation() {
    const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
    chromeAny.webNavigation = {
      onBeforeNavigate: event(),
      onCommitted: event(),
      onCompleted: event(),
      onErrorOccurred: event(),
    };
    const fire =
      (name: string) =>
      (details: Record<string, unknown> = {}) =>
        lastListener(chromeAny.webNavigation[name])({ tabId, frameId: 0, ...details });
    return {
      before: fire('onBeforeNavigate'),
      committed: fire('onCommitted'),
      completed: fire('onCompleted'),
      error: fire('onErrorOccurred'),
    };
  }

  /** A tab whose url and status the test changes as the action runs. */
  function mockTab(initial: { url: string; status: string }) {
    const state = { ...initial };
    chromeAny.tabs.get = vi.fn(async () => ({
      id: tabId,
      url: state.url,
      title: state.url,
      status: state.status,
      active: true,
    }));
    chromeAny.scripting = {
      executeScript: vi.fn().mockResolvedValue([{ result: { timed_out: false } }]),
    };
    return state;
  }

  it('reports no pending navigation for a fast load, a hash change, a download or a refresh', async () => {
    const nav = mockWebNavigation();

    // A normal load: starts, commits, completes.
    let tab = mockTab({ url: 'https://a/', status: 'complete' });
    let out = await runWithSettle(tabId, async () => {
      nav.before({ url: 'https://b/' });
      tab.status = 'loading';
      nav.committed({ url: 'https://b/' });
      tab.url = 'https://b/';
      tab.status = 'complete';
      nav.completed({ url: 'https://b/' });
    });
    expect(out.page).toMatchObject({ url: 'https://b/', navigated: true });
    expect(out.page?.pending_url).toBeUndefined();

    // A hash change: no new document, no navigation events.
    tab = mockTab({ url: 'https://a/', status: 'complete' });
    out = await runWithSettle(tabId, async () => {
      tab.url = 'https://a/#section';
    });
    expect(out.page?.pending_url).toBeUndefined();

    // A navigation that turned into a download: aborted, the page stays.
    tab = mockTab({ url: 'https://a/', status: 'complete' });
    out = await runWithSettle(
      tabId,
      async () => {
        nav.before({ url: 'https://a/export.csv' });
        nav.error({ url: 'https://a/export.csv', error: 'net::ERR_ABORTED' });
      },
      { expectNavigation: true, settleTimeoutMs: 500 },
    );
    expect(out.page).toMatchObject({ url: 'https://a/', navigated: false });
    expect(out.page?.pending_url).toBeUndefined();

    // A refresh: the same url loads again.
    tab = mockTab({ url: 'https://a/', status: 'complete' });
    out = await runWithSettle(tabId, async () => {
      nav.before({ url: 'https://a/' });
      tab.status = 'loading';
      nav.committed({ url: 'https://a/' });
      tab.status = 'complete';
      nav.completed({ url: 'https://a/' });
    });
    expect(out.page).toMatchObject({ url: 'https://a/', navigated: true });
    expect(out.page?.pending_url).toBeUndefined();
  });

  it('names a navigation whose server has not answered instead of reporting the old page', async () => {
    mockWebNavigation();
    let status = 'complete';
    chromeAny.tabs.get = vi.fn(async () => ({
      id: tabId,
      url: 'https://a/doc.pdf',
      title: 'doc',
      status,
      active: true,
    }));
    chromeAny.scripting = {
      executeScript: vi.fn().mockResolvedValue([{ result: { timed_out: false } }]),
    };

    const out = await runWithSettle(
      tabId,
      async () => {
        // The navigation starts; the server then takes longer than the wait.
        lastListener(chromeAny.webNavigation.onBeforeNavigate)({
          tabId,
          frameId: 0,
          url: 'https://a/slow',
        });
        status = 'loading';
        return 'navigated';
      },
      { expectNavigation: true, settleTimeoutMs: 300 },
    );

    expect(out.page).toMatchObject({
      url: 'https://a/doc.pdf',
      navigated: false,
      pending_url: 'https://a/slow',
      loading: true,
      timed_out: true,
    });
  });

  it('settleTab does not call a tab still waiting on its server navigated', async () => {
    chromeAny.tabs.get = vi.fn(async () => ({
      id: tabId,
      url: 'about:blank',
      pendingUrl: 'https://a/slow.pdf',
      status: 'loading',
    }));
    const page = await settleTab(tabId, { settleTimeoutMs: 200 });
    expect(page).toMatchObject({
      navigated: false,
      pending_url: 'https://a/slow.pdf',
      timed_out: true,
    });
  });

  it('reports a dialog the action opened instead of hanging with it', async () => {
    chromeAny.tabs.get = vi.fn(async () => ({
      id: tabId,
      url: 'https://a/',
      status: 'complete',
      active: true,
    }));
    // A page blocked by confirm() never answers script injection.
    chromeAny.scripting = { executeScript: vi.fn(() => new Promise(() => undefined)) };
    const fire = debuggerEventListener();
    chromeAny.debugger.sendCommand = vi.fn(async (_target: any, method: string) => {
      if (method === 'Page.enable') {
        fire({ tabId }, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Sure?' });
      }
      return {};
    });

    const hanging = runWithSettle(tabId, () => new Promise<string>(() => undefined));
    await expect(hanging).rejects.toMatchObject({
      name: 'DialogOpenError',
      openedByAction: true,
      dialog: { type: 'confirm', message: 'Sure?' },
    });
  }, 10_000);
});
