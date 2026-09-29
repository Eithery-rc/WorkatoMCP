import { TOOL_NAMES } from 'workatomcp-shared';

type OwnerTag = string;

interface TabSessionState {
  refCount: number;
  owners: Set<OwnerTag>;
  attachedByUs: boolean;
}

const DEBUGGER_PROTOCOL_VERSION = '1.3';

/** Default ceiling for one CDP command: a page that never answers must not hold a tool forever. */
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
/**
 * Commands that legitimately run long (user scripts, traces, big captures).
 * They get the bridge-call ceiling instead of the short default.
 */
const LONG_COMMAND_TIMEOUT_MS = 115_000;
const LONG_METHODS = new Set([
  'Runtime.evaluate',
  'Runtime.callFunctionOn',
  'Runtime.awaitPromise',
  'Tracing.end',
  'Page.captureScreenshot',
  'Network.getResponseBody',
  'DOMSnapshot.captureSnapshot',
  'Accessibility.getFullAXTree',
]);

export interface SendCommandOptions {
  /** Reject when Chrome has not answered within this many ms. */
  timeoutMs?: number;
}

function commandTimeout(method: string, params: any, options?: SendCommandOptions): number {
  if (typeof options?.timeoutMs === 'number' && options.timeoutMs > 0) return options.timeoutMs;
  const base = LONG_METHODS.has(method) ? LONG_COMMAND_TIMEOUT_MS : DEFAULT_COMMAND_TIMEOUT_MS;
  // A command that carries its own CDP timeout (Runtime.evaluate) gets a little more than that.
  const own = typeof params?.timeout === 'number' ? params.timeout + 5_000 : 0;
  return Math.max(base, own);
}

class CDPSessionManager {
  private sessions = new Map<number, TabSessionState>();

  constructor() {
    // The browser ends a session on its own when the user clicks Cancel on the
    // "being debugged" bar, DevTools takes over, or the target goes away. Our
    // own detach() does not fire this. Without it the tab would stay "attached
    // by us" forever and every later command would fail.
    try {
      chrome.debugger.onDetach.addListener((source) => {
        if (typeof source.tabId !== 'number') return;
        this.sessions.delete(source.tabId);
        this.tabOps.delete(source.tabId);
      });
    } catch {
      /* debugger API unavailable (tests) */
    }
  }

  private getState(tabId: number): TabSessionState | undefined {
    return this.sessions.get(tabId);
  }

  private setState(tabId: number, state: TabSessionState) {
    this.sessions.set(tabId, state);
  }

  /**
   * Attach and detach for one tab run one at a time. Without this, two first
   * attaches both saw "not attached" (the second failed with "Another debugger
   * is already attached"), the adopt branch reset the refcount from a stale
   * read, and an attach during a detach bumped a state that was then deleted.
   */
  private tabOps = new Map<number, Promise<unknown>>();

  private serialize<T>(tabId: number, op: () => Promise<T>): Promise<T> {
    const previous = this.tabOps.get(tabId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(op);
    const tail = run.catch(() => undefined);
    this.tabOps.set(tabId, tail);
    tail.then(() => {
      if (this.tabOps.get(tabId) === tail) this.tabOps.delete(tabId);
    });
    return run;
  }

  attach(tabId: number, owner: OwnerTag = 'unknown'): Promise<void> {
    return this.serialize(tabId, async () => {
      const state = this.getState(tabId);
      if (state && state.attachedByUs) {
        state.refCount += 1;
        state.owners.add(owner);
        return;
      }

      // Check existing attachments
      const targets = await chrome.debugger.getTargets();
      const existing = targets.find((t) => t.tabId === tabId && t.attached);
      if (existing) {
        if (existing.extensionId === chrome.runtime.id) {
          // Attached by us but not tracked (service-worker restart): adopt it.
          const current = this.getState(tabId);
          this.setState(tabId, {
            refCount: (current?.refCount ?? 0) + 1,
            owners: new Set([...(current?.owners || []), owner]),
            attachedByUs: true,
          });
          return;
        }
        // Another client (DevTools/other extension) is attached
        throw new Error(
          `Debugger is already attached to tab ${tabId} by another client (e.g., DevTools/extension)`,
        );
      }

      // Attach freshly
      await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
      this.setState(tabId, { refCount: 1, owners: new Set([owner]), attachedByUs: true });
    });
  }

  detach(tabId: number, owner: OwnerTag = 'unknown'): Promise<void> {
    return this.serialize(tabId, async () => {
      const state = this.getState(tabId);
      if (!state) return; // Nothing to do

      // Update ownership/refcount
      if (state.owners.has(owner)) state.owners.delete(owner);
      state.refCount = Math.max(0, state.refCount - 1);

      if (state.refCount > 0) {
        // Still in use by other owners
        return;
      }

      // We are the last owner
      this.sessions.delete(tabId);
      try {
        if (state.attachedByUs) {
          await chrome.debugger.detach({ tabId });
        }
      } catch (e) {
        // Best-effort detach; ignore
      }
    });
  }

  /**
   * Convenience wrapper: ensures attach before fn, and balanced detach after.
   */
  async withSession<T>(tabId: number, owner: OwnerTag, fn: () => Promise<T>): Promise<T> {
    await this.attach(tabId, owner);
    try {
      return await fn();
    } finally {
      await this.detach(tabId, owner);
    }
  }

  /**
   * Send a CDP command. Requires that this manager has attached to the tab.
   * If not attached by us, will attempt a one-shot attach around the call.
   */
  async sendCommand<T = any>(
    tabId: number,
    method: string,
    params?: object,
    options?: SendCommandOptions,
  ): Promise<T> {
    const timeoutMs = commandTimeout(method, params, options);
    const state = this.getState(tabId);
    if (state && state.attachedByUs) {
      return this.sendWithTimeout<T>(tabId, method, params, timeoutMs);
    }
    // Fallback: temporary session
    return await this.withSession<T>(tabId, `send:${method}`, async () => {
      return this.sendWithTimeout<T>(tabId, method, params, timeoutMs);
    });
  }

  private sendWithTimeout<T>(
    tabId: number,
    method: string,
    params: object | undefined,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `CDP ${method} on tab ${tabId} got no answer within ${timeoutMs} ms ` +
              '(the page may be blocked by a JS dialog or hung).',
          ),
        );
      }, timeoutMs);
      Promise.resolve(chrome.debugger.sendCommand({ tabId }, method, params)).then(
        (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}

export const cdpSessionManager = new CDPSessionManager();
