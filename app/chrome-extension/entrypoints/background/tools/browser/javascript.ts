/**
 * JavaScript Tool - CDP Runtime.evaluate with fallback
 *
 * Execute JavaScript in the browser tab and return the result.
 * - Primary: CDP Runtime.evaluate (supports awaitPromise + returnByValue)
 * - Fallback: chrome.scripting.executeScript (when debugger is busy)
 * - With `uids`: CDP Runtime.callFunctionOn, the snapshot elements handed to
 *   the code as `elements` (no fallback: a uid only means something over CDP)
 *
 * - With `async_job`: the code starts in the page and the call returns a job id
 *   at once; `job_id` polls it later (CDP only)
 *
 * Features:
 * - Async code support (top-level await via async wrapper)
 * - Output sanitization (sensitive data redaction); `rawOutput`, set by the
 *   bridge for an explicit out_file, returns the value unredacted for the file
 * - Output truncation (configurable max bytes)
 * - Timeout handling
 * - Detailed error classification
 */

import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@mokuhub/mokutab-shared';
import { cdpSessionManager } from '@/utils/cdp-session-manager';
import { resolveElement } from './snapshot/element-actions';
import { sendCommand as snapshotSendCommand } from './snapshot/debugger-session';
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  formatRawOutput,
  sanitizeAndLimitOutput,
  sanitizeText,
  type SanitizedOutput,
} from '@/utils/output-sanitizer';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default execution budget. A timeout here does NOT cancel the page-side work:
 * fetches already in flight finish and their side effects land, so a too-eager
 * limit turns completed work into a reported failure — and a blind retry into a
 * double execution. 60s sits under the bridge's 120s per-call ceiling and
 * covers the multi-fetch scripts this tool is actually used for.
 */
const DEFAULT_TIMEOUT_MS = 60_000;
const CDP_SESSION_KEY = 'javascript';

// ============================================================================
// Types
// ============================================================================

type ExecutionEngine = 'cdp' | 'scripting';

type ErrorKind =
  | 'debugger_conflict'
  | 'timeout'
  | 'syntax_error'
  | 'runtime_error'
  | 'cdp_error'
  | 'scripting_error';

interface JavaScriptToolParams {
  code?: string;
  tabId?: number;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Snapshot uids, handed to the code as the array `elements`. */
  uids?: number[];
  /** Start the code as a page job and return its id instead of waiting. */
  async_job?: boolean;
  /** Poll a job started with async_job. */
  job_id?: string;
  /** How long a poll waits for the job to finish (default 0: one look). */
  wait_ms?: number;
  /**
   * Internal, set by the native-server when out_file is given explicitly, and
   * absent from the served schema: return the value unredacted, for the file.
   */
  rawOutput?: boolean;
}

interface ExecutionError {
  kind: ErrorKind;
  message: string;
  details?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
}

interface ExecutionMetrics {
  elapsedMs: number;
}

interface JavaScriptToolResult {
  success: boolean;
  tabId: number;
  engine: ExecutionEngine;
  job_id?: string;
  state?: JobState;
  message?: string;
  job_ms?: number;
  result?: string;
  truncated?: boolean;
  redacted?: boolean;
  warnings?: string[];
  error?: ExecutionError;
  metrics?: ExecutionMetrics;
}

interface ExecutionOptions {
  timeoutMs: number;
  maxOutputBytes: number;
  /** Unredacted output for a file (the bridge's explicit out_file). */
  raw: boolean;
}

/** Format a returned value: redacted for the model, or raw for a file. */
function limitOutput(value: unknown, options: ExecutionOptions): SanitizedOutput {
  return options.raw
    ? formatRawOutput(value)
    : sanitizeAndLimitOutput(value, { maxBytes: options.maxOutputBytes });
}

// Discriminated union for execution results
type ExecutionSuccess = {
  ok: true;
  engine: ExecutionEngine;
  output: string;
  truncated: boolean;
  redacted: boolean;
};

type ExecutionFailure = {
  ok: false;
  engine: ExecutionEngine;
  error: ExecutionError;
};

type ExecutionResult = ExecutionSuccess | ExecutionFailure;

// ============================================================================
// Timeout Error
// ============================================================================

class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Execution timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof Error && error.name === 'TimeoutError';
}

function isDebuggerConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Debugger is already attached|Another debugger is already attached|Cannot attach to this target/i.test(
    message,
  );
}

/**
 * Wrap user code in an async IIFE to support top-level await and return statements.
 */
function wrapUserCode(code: string): string {
  return `(async () => {\n${code}\n})()`;
}

// ============================================================================
// CDP Execution
// ============================================================================

interface CDPRemoteObject {
  type?: string;
  subtype?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
}

interface CDPExceptionDetails {
  text?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  exception?: {
    className?: string;
    description?: string;
    value?: string;
  };
}

interface CDPEvaluateResult {
  result?: CDPRemoteObject;
  exceptionDetails?: CDPExceptionDetails;
}

function extractReturnValue(remoteObject?: CDPRemoteObject): unknown {
  if (!remoteObject) return undefined;

  if ('value' in remoteObject) return remoteObject.value;
  if ('unserializableValue' in remoteObject) return remoteObject.unserializableValue;
  if (typeof remoteObject.description === 'string') return remoteObject.description;

  return undefined;
}

function parseExceptionDetails(details: CDPExceptionDetails): ExecutionError {
  const exceptionClassName = details.exception?.className ?? '';
  const exceptionDescription = details.exception?.description ?? '';
  const exceptionValue = details.exception?.value ?? '';
  const text = details.text ?? '';

  // Determine the raw error message
  const rawMessage =
    exceptionDescription || exceptionValue || text || 'JavaScript execution failed';

  // Sanitize the message
  const message = sanitizeText(rawMessage).text;

  // Classify the error kind
  const isSyntaxError = exceptionClassName === 'SyntaxError' || /SyntaxError/i.test(rawMessage);

  return {
    kind: isSyntaxError ? 'syntax_error' : 'runtime_error',
    message,
    details: {
      url: details.url,
      lineNumber: details.lineNumber,
      columnNumber: details.columnNumber,
    },
  };
}

async function executeViaCdp(
  tabId: number,
  code: string,
  options: ExecutionOptions,
): Promise<ExecutionResult> {
  try {
    const expression = wrapUserCode(code);

    const response = await withTimeout(
      cdpSessionManager.withSession(tabId, CDP_SESSION_KEY, async () => {
        return (await cdpSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
          // CDP built-in timeout (ms); outer withTimeout acts as a second guard.
          timeout: options.timeoutMs,
        })) as CDPEvaluateResult;
      }),
      // Outer timeout is slightly longer to give CDP a moment to return its own timeout response.
      options.timeoutMs + 1000,
    );

    // Check for exception
    if (response?.exceptionDetails) {
      return {
        ok: false,
        engine: 'cdp',
        error: parseExceptionDetails(response.exceptionDetails),
      };
    }

    // Extract and sanitize the result
    const value = extractReturnValue(response?.result);
    const sanitized = limitOutput(value, options);

    return {
      ok: true,
      engine: 'cdp',
      output: sanitized.text,
      truncated: sanitized.truncated,
      redacted: sanitized.redacted,
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      return {
        ok: false,
        engine: 'cdp',
        error: { kind: 'timeout', message: error.message },
      };
    }

    if (isDebuggerConflictError(error)) {
      const message = sanitizeText(error instanceof Error ? error.message : String(error)).text;
      return {
        ok: false,
        engine: 'cdp',
        error: { kind: 'debugger_conflict', message },
      };
    }

    const message = sanitizeText(error instanceof Error ? error.message : String(error)).text;
    return {
      ok: false,
      engine: 'cdp',
      error: { kind: 'cdp_error', message },
    };
  }
}

/**
 * Run the code with snapshot elements bound to `elements` (elements[i] is
 * uids[i]). The code runs as the body of an async function in the page's main
 * world, like the Runtime.evaluate path, so `return` and `await` work.
 */
async function executeWithElements(
  tabId: number,
  code: string,
  uids: number[],
  options: ExecutionOptions,
): Promise<ExecutionResult> {
  let elements: Array<{ objectId: string }>;
  try {
    elements = [];
    for (const uid of uids) elements.push(await resolveElement(tabId, Number(uid)));
  } catch (error) {
    const message = sanitizeText(error instanceof Error ? error.message : String(error)).text;
    return { ok: false, engine: 'cdp', error: { kind: 'runtime_error', message } };
  }
  try {
    const response = (await withTimeout(
      snapshotSendCommand(tabId, 'Runtime.callFunctionOn', {
        objectId: elements[0].objectId,
        functionDeclaration: `async function () {
const elements = Array.prototype.slice.call(arguments);
${code}
}`,
        arguments: elements.map((e) => ({ objectId: e.objectId })),
        returnByValue: true,
        awaitPromise: true,
      }),
      options.timeoutMs,
    )) as CDPEvaluateResult;
    if (response?.exceptionDetails) {
      return { ok: false, engine: 'cdp', error: parseExceptionDetails(response.exceptionDetails) };
    }
    const sanitized = limitOutput(extractReturnValue(response?.result), options);
    return {
      ok: true,
      engine: 'cdp',
      output: sanitized.text,
      truncated: sanitized.truncated,
      redacted: sanitized.redacted,
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      return { ok: false, engine: 'cdp', error: { kind: 'timeout', message: error.message } };
    }
    const message = sanitizeText(error instanceof Error ? error.message : String(error)).text;
    return { ok: false, engine: 'cdp', error: { kind: 'cdp_error', message } };
  }
}

// ============================================================================
// chrome.scripting.executeScript Fallback
// ============================================================================

interface ScriptingExecutionResult {
  ok: boolean;
  value?: unknown;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
  };
}

async function executeViaScripting(
  tabId: number,
  code: string,
  options: ExecutionOptions,
): Promise<ExecutionResult> {
  const innerExecute = async (): Promise<ExecutionResult> => {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async (userCode: string): Promise<ScriptingExecutionResult> => {
        try {
          // Use AsyncFunction constructor to support top-level await

          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          const fn = new AsyncFunction(userCode);
          const value = await fn();
          return { ok: true, value };
        } catch (err: unknown) {
          const error = err as Error;
          return {
            ok: false,
            error: {
              name: error?.name ?? undefined,
              message: error?.message ?? String(err),
              stack: error?.stack ?? undefined,
            },
          };
        }
      },
      args: [code],
    });

    // Extract the first result
    const firstFrame = results?.[0];
    const result = (firstFrame as { result?: ScriptingExecutionResult })?.result;

    if (!result || typeof result !== 'object') {
      return {
        ok: false,
        engine: 'scripting',
        error: { kind: 'scripting_error', message: 'No result returned from executeScript' },
      };
    }

    if (!result.ok) {
      const rawMessage = result.error?.message ?? 'JavaScript execution failed';
      const rawStack = result.error?.stack;

      const message = sanitizeText(rawMessage).text;
      const sanitizedStack = rawStack ? sanitizeText(rawStack).text : undefined;

      const isSyntaxError = result.error?.name === 'SyntaxError' || /SyntaxError/i.test(rawMessage);

      return {
        ok: false,
        engine: 'scripting',
        error: {
          kind: isSyntaxError ? 'syntax_error' : 'runtime_error',
          message: sanitizedStack ? `${message}\n${sanitizedStack}` : message,
        },
      };
    }

    // Sanitize the successful result
    const sanitized = limitOutput(result.value, options);

    return {
      ok: true,
      engine: 'scripting',
      output: sanitized.text,
      truncated: sanitized.truncated,
      redacted: sanitized.redacted,
    };
  };

  try {
    return await withTimeout(innerExecute(), options.timeoutMs);
  } catch (error) {
    if (isTimeoutError(error)) {
      return {
        ok: false,
        engine: 'scripting',
        error: { kind: 'timeout', message: error.message },
      };
    }

    const message = sanitizeText(error instanceof Error ? error.message : String(error)).text;
    return {
      ok: false,
      engine: 'scripting',
      error: { kind: 'scripting_error', message },
    };
  }
}

// ============================================================================
// Page jobs (async_job / job_id)
// ============================================================================

type JobState = 'running' | 'done' | 'error' | 'busy' | 'lost';

/** Page global holding the jobs this tool started in that document. */
const JOB_STORE = '__mokutabJobs';
/**
 * Budget for one look at the job store. A page whose main thread is blocked
 * (a sync XHR) cannot answer any evaluate, so a slower probe reports busy.
 */
const JOB_PROBE_TIMEOUT_MS = 2500;
/** A start the page does not accept in this long is reported busy (it stays queued). */
const JOB_START_TIMEOUT_MS = 10_000;
const JOB_POLL_INTERVAL_MS = 500;
const MAX_JOB_WAIT_MS = 100_000;
const MAX_TRACKED_JOBS = 500;
/**
 * A delivered result stays readable once more for this long: a reply that
 * never reached the agent (a failed out_file write, a bridge timeout) must not
 * lose a job that took a minute to run.
 */
const JOB_REREAD_WINDOW_MS = 60_000;
/** Finished jobs nobody polled, and unread late start failures, are dropped after this. */
const JOB_RETENTION_MS = 30 * 60_000;

interface JobRecord {
  tabId: number;
  startedAt: number;
  /** When the result was first handed out (the page keeps it for one re-read). */
  deliveredAt?: number;
}

/** Jobs started from this service worker. A restart loses it; the page store survives. */
const startedJobs = new Map<string, JobRecord>();
/** A probe still waiting on a blocked page, reused instead of queueing another. */
const inflightProbes = new Map<string, Promise<CDPEvaluateResult>>();
/** A start reported busy that failed once the page answered (a syntax error, CDP). */
const lateStartFailures = new Map<string, { error: ExecutionError; at: number }>();

interface PageJobEntry {
  state?: string;
  value?: unknown;
  error?: { name?: string; message?: string; stack?: string };
  started?: number;
  finished?: number;
  /** Page time of the first delivery; set by buildJobDeliveredExpression. */
  delivered?: number;
  /** Milliseconds since that delivery, computed by the probe in the page. */
  deliveredAgo?: number;
}

type JobOutcome =
  | { ok: true; state: 'running' | 'busy'; message?: string; jobMs?: number }
  | { ok: true; state: 'done'; output: SanitizedOutput; jobMs?: number; reread?: boolean }
  | { ok: false; state?: 'error' | 'lost'; error: ExecutionError; jobMs?: number };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve with the promise's outcome, or with `onTimeout` once ms pass first. */
function raceTimeout<T, U>(promise: Promise<T>, ms: number, onTimeout: U): Promise<T | U> {
  return new Promise<T | U>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function newJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function trackJob(jobId: string, tabId: number): void {
  startedJobs.set(jobId, { tabId, startedAt: Date.now() });
  while (startedJobs.size > MAX_TRACKED_JOBS) {
    const oldest = startedJobs.keys().next().value;
    if (oldest === undefined) break;
    startedJobs.delete(oldest);
  }
}

function pruneLateStartFailures(now: number): void {
  for (const [jobId, failure] of lateStartFailures) {
    if (now - failure.at > JOB_RETENTION_MS) lateStartFailures.delete(jobId);
  }
}

/**
 * The page side of a job start. The user code runs from a timer, so this
 * evaluate returns before any synchronous work in it (a sync XHR) blocks the
 * page. A syntax error in the code fails the whole expression, so it is
 * reported by the start call and nothing is registered. Each start also drops
 * jobs that finished long ago and were never polled, so a long-lived tab does
 * not keep their results forever.
 */
function buildJobStartExpression(jobId: string, code: string): string {
  return `(function () {
var key = ${JSON.stringify(JOB_STORE)};
if (!window[key]) Object.defineProperty(window, key, { value: {}, configurable: true, writable: true });
var store = window[key];
var id = ${JSON.stringify(jobId)};
var started = Date.now();
Object.keys(store).forEach(function (old) {
  var entry = store[old];
  if (entry && typeof entry.finished === 'number' && started - entry.finished > ${JOB_RETENTION_MS}) {
    delete store[old];
  }
});
store[id] = { state: 'running', started: started };
setTimeout(function () {
  var run;
  try {
    run = (async () => {
${code}
})();
  } catch (e) {
    run = Promise.reject(e);
  }
  Promise.resolve(run).then(function (value) {
    store[id] = { state: 'done', value: value, started: started, finished: Date.now() };
  }, function (err) {
    store[id] = {
      state: 'error',
      error: {
        name: err && err.name ? String(err.name) : undefined,
        message: err && err.message !== undefined ? String(err.message) : String(err),
        stack: err && err.stack ? String(err.stack) : undefined
      },
      started: started,
      finished: Date.now()
    };
  });
}, 0);
return id;
})()`;
}

function buildJobProbeExpression(jobId: string): string {
  return `(function () {
var store = window[${JSON.stringify(JOB_STORE)}];
var entry = store && store[${JSON.stringify(jobId)}];
if (!entry) return null;
if (typeof entry.delivered !== 'number') return entry;
return Object.assign({}, entry, { deliveredAgo: Date.now() - entry.delivered });
})()`;
}

/**
 * Mark a result as handed out. The page keeps it for one more read within the
 * re-read window, then drops it on its own.
 */
function buildJobDeliveredExpression(jobId: string): string {
  return `(function () {
var store = window[${JSON.stringify(JOB_STORE)}];
var id = ${JSON.stringify(jobId)};
var entry = store && store[id];
if (entry && typeof entry.delivered !== 'number') {
  entry.delivered = Date.now();
  setTimeout(function () {
    if (store[id] === entry) delete store[id];
  }, ${JOB_REREAD_WINDOW_MS});
}
return true;
})()`;
}

function buildJobForgetExpression(jobId: string): string {
  return `(function () {
var store = window[${JSON.stringify(JOB_STORE)}];
if (store) delete store[${JSON.stringify(jobId)}];
return true;
})()`;
}

function evaluateForJob(tabId: number, expression: string): Promise<CDPEvaluateResult> {
  return cdpSessionManager.withSession(tabId, CDP_SESSION_KEY, async () => {
    return (await cdpSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
    })) as CDPEvaluateResult;
  });
}

function jobCdpError(error: unknown): ExecutionError {
  const message = sanitizeText(error instanceof Error ? error.message : String(error)).text;
  if (isDebuggerConflictError(error)) {
    return {
      kind: 'debugger_conflict',
      message:
        `${message}. async_job and job_id need the CDP debugger (there is no scripting ` +
        'fallback for jobs): close DevTools on this tab and try again.',
    };
  }
  return { kind: 'cdp_error', message };
}

type StartOutcome =
  | { ok: true; jobId: string; state: 'running' | 'busy'; message: string }
  | { ok: false; error: ExecutionError };

async function startJob(tabId: number, code: string): Promise<StartOutcome> {
  const jobId = newJobId();
  pruneLateStartFailures(Date.now());
  // Tracked before sending: a start that is still queued behind a blocked page
  // must be pollable, never started a second time.
  trackJob(jobId, tabId);
  try {
    const sent = evaluateForJob(tabId, buildJobStartExpression(jobId, code));
    const response = await raceTimeout(sent, JOB_START_TIMEOUT_MS, 'late' as const);
    if (response === 'late') {
      // The start may still fail once the page answers; keep that for the poll.
      sent.then(
        (late) => {
          if (late?.exceptionDetails) {
            lateStartFailures.set(jobId, {
              error: parseExceptionDetails(late.exceptionDetails),
              at: Date.now(),
            });
          }
        },
        (error: unknown) =>
          lateStartFailures.set(jobId, { error: jobCdpError(error), at: Date.now() }),
      );
      return {
        ok: true,
        jobId,
        state: 'busy',
        message:
          `The page did not accept the start within ${JOB_START_TIMEOUT_MS} ms: its main thread ` +
          'is blocked. The start stays queued and runs once the page frees up. Poll this job_id; ' +
          'do not start the code again.',
      };
    }
    if (response?.exceptionDetails) {
      startedJobs.delete(jobId);
      return { ok: false, error: parseExceptionDetails(response.exceptionDetails) };
    }
    return {
      ok: true,
      jobId,
      state: 'running',
      message: 'Started. Poll it with chrome_javascript({job_id, wait_ms}) on the same tab.',
    };
  } catch (error) {
    startedJobs.delete(jobId);
    return { ok: false, error: jobCdpError(error) };
  }
}

type ProbeOutcome =
  | { kind: 'entry'; entry: PageJobEntry }
  | { kind: 'missing' }
  | { kind: 'busy' }
  | { kind: 'failed'; error: ExecutionError };

async function probeJob(tabId: number, jobId: string): Promise<ProbeOutcome> {
  let pending = inflightProbes.get(jobId);
  if (!pending) {
    const probe = evaluateForJob(tabId, buildJobProbeExpression(jobId));
    pending = probe;
    inflightProbes.set(jobId, probe);
    const clear = () => {
      if (inflightProbes.get(jobId) === probe) inflightProbes.delete(jobId);
    };
    probe.then(clear, clear);
  }
  let response: CDPEvaluateResult | 'busy';
  try {
    response = await raceTimeout(pending, JOB_PROBE_TIMEOUT_MS, 'busy' as const);
  } catch (error) {
    return { kind: 'failed', error: jobCdpError(error) };
  }
  if (response === 'busy') return { kind: 'busy' };
  if (response?.exceptionDetails) {
    return { kind: 'failed', error: parseExceptionDetails(response.exceptionDetails) };
  }
  const value = extractReturnValue(response?.result);
  if (!value || typeof value !== 'object') return { kind: 'missing' };
  return { kind: 'entry', entry: value as PageJobEntry };
}

/** Drop a job from the page and from the tracker for good (best effort). */
function forgetJob(tabId: number, jobId: string): void {
  startedJobs.delete(jobId);
  evaluateForJob(tabId, buildJobForgetExpression(jobId)).catch(() => undefined);
}

/**
 * Hand out a finished job. The first read leaves it in the page for one
 * re-read within JOB_REREAD_WINDOW_MS; that re-read, or a read after the
 * window, drops it. Returns false when the window has passed (nothing to hand out).
 */
function deliverJob(
  tabId: number,
  jobId: string,
  entry: PageJobEntry,
  record: JobRecord | undefined,
): { reread: boolean } | false {
  if (typeof entry.delivered === 'number') {
    forgetJob(tabId, jobId);
    const ago = typeof entry.deliveredAgo === 'number' ? entry.deliveredAgo : Infinity;
    return ago <= JOB_REREAD_WINDOW_MS ? { reread: true } : false;
  }
  if (record) record.deliveredAt = Date.now();
  evaluateForJob(tabId, buildJobDeliveredExpression(jobId)).catch(() => undefined);
  return { reread: false };
}

function alreadyDeliveredError(jobId: string, tabId: number): ExecutionError {
  return {
    kind: 'runtime_error',
    message:
      `Unknown job_id ${jobId} in tab ${tabId}: it was not started in this document, or its ` +
      `result was already delivered (a finished job can be read again for ${JOB_REREAD_WINDOW_MS / 1000} s ` +
      'after the first read, once, and is then dropped).',
  };
}

function jobDuration(entry: PageJobEntry): number | undefined {
  if (typeof entry.started !== 'number') return undefined;
  const end = typeof entry.finished === 'number' ? entry.finished : Date.now();
  return Math.max(0, end - entry.started);
}

async function pollJob(
  tabId: number,
  jobId: string,
  waitMs: number,
  options: ExecutionOptions,
): Promise<JobOutcome> {
  const record = startedJobs.get(jobId);
  if (record && record.tabId !== tabId) {
    return {
      ok: false,
      error: {
        kind: 'runtime_error',
        message: `Job ${jobId} was started in tab ${record.tabId}, not tab ${tabId}. Poll it there (same tabId or lease).`,
      },
    };
  }
  // One debugger session for the whole wait: the probes inside only add a
  // reference to it, so a long wait_ms does not attach and detach per probe.
  try {
    return await cdpSessionManager.withSession(tabId, CDP_SESSION_KEY, () =>
      pollJobLoop(tabId, jobId, waitMs, options, record),
    );
  } catch (error) {
    return { ok: false, error: jobCdpError(error) };
  }
}

async function pollJobLoop(
  tabId: number,
  jobId: string,
  waitMs: number,
  options: ExecutionOptions,
  record: JobRecord | undefined,
): Promise<JobOutcome> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const startFailure = lateStartFailures.get(jobId);
    if (startFailure) {
      lateStartFailures.delete(jobId);
      startedJobs.delete(jobId);
      return { ok: false, state: 'error', error: startFailure.error };
    }
    const probe = await probeJob(tabId, jobId);
    let last: JobOutcome;
    if (probe.kind === 'failed') return { ok: false, error: probe.error };
    if (probe.kind === 'missing') {
      // Delivered, then dropped by the page once the re-read window passed.
      if (record?.deliveredAt !== undefined) {
        startedJobs.delete(jobId);
        return { ok: false, error: alreadyDeliveredError(jobId, tabId) };
      }
      if (record) {
        startedJobs.delete(jobId);
        return {
          ok: false,
          state: 'lost',
          error: {
            kind: 'runtime_error',
            message:
              `Job ${jobId} is gone from the page: the tab navigated or reloaded after it started, ` +
              'so its outcome is unknown. Check the resulting state before running the code again.',
          },
        };
      }
      return { ok: false, error: alreadyDeliveredError(jobId, tabId) };
    }
    if (probe.kind === 'busy') {
      last = {
        ok: true,
        state: 'busy',
        message:
          `The page did not answer within ${JOB_PROBE_TIMEOUT_MS} ms: its main thread is blocked, ` +
          'most likely by this job (synchronous work such as a sync XHR). Poll again.',
      };
    } else {
      const entry = probe.entry;
      const jobMs = jobDuration(entry);
      if (entry.state === 'done' || entry.state === 'error') {
        const delivered = deliverJob(tabId, jobId, entry, record);
        if (!delivered) return { ok: false, error: alreadyDeliveredError(jobId, tabId) };
        if (entry.state === 'done') {
          const output = limitOutput(entry.value, options);
          return { ok: true, state: 'done', output, jobMs, reread: delivered.reread };
        }
        const rawMessage = entry.error?.message ?? 'JavaScript job failed';
        const message = sanitizeText(rawMessage).text;
        const stack = entry.error?.stack ? sanitizeText(entry.error.stack).text : undefined;
        const isSyntaxError = entry.error?.name === 'SyntaxError';
        return {
          ok: false,
          state: 'error',
          error: {
            kind: isSyntaxError ? 'syntax_error' : 'runtime_error',
            message: stack && !stack.includes(message) ? `${message}\n${stack}` : stack || message,
          },
          jobMs,
        };
      }
      last = { ok: true, state: 'running', jobMs };
    }
    if (Date.now() + JOB_POLL_INTERVAL_MS > deadline) return last;
    await delay(JOB_POLL_INTERVAL_MS);
  }
}

// ============================================================================
// Tool Implementation
// ============================================================================

class JavaScriptTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.JAVASCRIPT;

  async execute(args: JavaScriptToolParams): Promise<ToolResult> {
    const startTime = performance.now();

    try {
      // Validate required parameter
      const code = typeof args?.code === 'string' ? args.code.trim() : '';
      const jobId = typeof args?.job_id === 'string' ? args.job_id.trim() : '';
      const asyncJob = args?.async_job === true;
      const hasUids = Array.isArray(args?.uids) && args.uids.length > 0;
      if (jobId && code) {
        return createErrorResponse(
          'Pass code (to run it, or to start it with async_job) or job_id (to poll a job), not both.',
        );
      }
      if (!code && !jobId) {
        return createErrorResponse(
          'Parameter [code] is required (or job_id, to poll a job started with async_job)',
        );
      }
      if ((jobId || asyncJob) && hasUids) {
        return createErrorResponse('uids cannot be combined with async_job or job_id.');
      }

      // Resolve target tab
      const tab = await this.resolveTargetTab(args.tabId);
      if (!tab) {
        return createErrorResponse(
          typeof args.tabId === 'number' ? `Tab not found: ${args.tabId}` : 'No active tab found',
        );
      }

      if (!tab.id) {
        return createErrorResponse('Tab has no ID');
      }
      const tabId = tab.id;

      // Normalize options
      const options: ExecutionOptions = {
        timeoutMs: normalizePositiveInt(args.timeoutMs, DEFAULT_TIMEOUT_MS),
        maxOutputBytes: normalizePositiveInt(args.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES),
        raw: args.rawOutput === true,
      };

      if (jobId) {
        const waitMs =
          typeof args.wait_ms === 'number' && Number.isFinite(args.wait_ms)
            ? Math.min(Math.max(0, Math.floor(args.wait_ms)), MAX_JOB_WAIT_MS)
            : 0;
        const outcome = await pollJob(tabId, jobId, waitMs, options);
        return this.buildJobResponse(tabId, jobId, outcome, startTime);
      }

      if (asyncJob) {
        const started = await startJob(tabId, code);
        if (!started.ok) {
          return this.buildErrorResponse(
            tabId,
            { ok: false, engine: 'cdp', error: started.error },
            startTime,
          );
        }
        return this.buildJobResponse(
          tabId,
          started.jobId,
          { ok: true, state: started.state, message: started.message },
          startTime,
        );
      }

      if (args.uids && hasUids) {
        const withElements = await executeWithElements(tabId, code, args.uids, options);
        return withElements.ok
          ? this.buildSuccessResponse(tabId, withElements, startTime)
          : this.buildErrorResponse(tabId, withElements, startTime);
      }

      const warnings: string[] = [];

      // Try CDP execution first
      const cdpResult = await executeViaCdp(tabId, code, options);

      if (cdpResult.ok) {
        return this.buildSuccessResponse(tabId, cdpResult, startTime);
      }

      // If not a debugger conflict, return the CDP error
      if (cdpResult.error.kind !== 'debugger_conflict') {
        return this.buildErrorResponse(tabId, cdpResult, startTime);
      }

      // Debugger conflict - fallback to scripting API
      warnings.push(
        'Debugger is busy (DevTools or another extension attached). Falling back to chrome.scripting.executeScript (runs in ISOLATED world, not page context).',
      );

      const scriptingResult = await executeViaScripting(tabId, code, options);

      if (scriptingResult.ok) {
        return this.buildSuccessResponse(tabId, scriptingResult, startTime, warnings);
      }

      return this.buildErrorResponse(tabId, scriptingResult, startTime, warnings);
    } catch (error) {
      console.error('JavaScriptTool.execute error:', error);
      return createErrorResponse(
        `JavaScript tool error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async resolveTargetTab(tabId?: number): Promise<chrome.tabs.Tab | null> {
    if (typeof tabId === 'number') {
      return this.tryGetTab(tabId);
    }
    try {
      return await this.getActiveTabOrThrow();
    } catch {
      return null;
    }
  }

  private buildSuccessResponse(
    tabId: number,
    result: ExecutionSuccess,
    startTime: number,
    warnings?: string[],
  ): ToolResult {
    const payload: JavaScriptToolResult = {
      success: true,
      tabId,
      engine: result.engine,
      result: result.output,
      truncated: result.truncated || undefined,
      redacted: result.redacted || undefined,
      warnings: warnings?.length ? warnings : undefined,
      metrics: { elapsedMs: Math.round(performance.now() - startTime) },
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
    };
  }

  private buildErrorResponse(
    tabId: number,
    result: ExecutionFailure,
    startTime: number,
    warnings?: string[],
  ): ToolResult {
    // A timeout abandons the wait, not the script: the page keeps running and
    // any request it already issued still lands. Say so, or the next step is a
    // retry that executes everything twice.
    const allWarnings = [...(warnings ?? [])];
    if (result.error.kind === 'timeout') {
      allWarnings.push(
        'The script was NOT cancelled — it keeps running in the page and its side effects (fetches, ' +
          'writes) may still land. Do not blindly retry non-idempotent code: check the resulting state ' +
          'first, or re-run with a larger timeoutMs. For work longer than the call allows, start it ' +
          'with async_job:true and poll the returned job_id.',
      );
    }

    const payload: JavaScriptToolResult = {
      success: false,
      tabId,
      engine: result.engine,
      error: result.error,
      warnings: allWarnings.length ? allWarnings : undefined,
      metrics: { elapsedMs: Math.round(performance.now() - startTime) },
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: true,
    };
  }

  /**
   * A job start or poll. running and busy are successful answers (poll again);
   * done carries the result like a plain run; error and lost are errors.
   */
  private buildJobResponse(
    tabId: number,
    jobId: string,
    outcome: JobOutcome,
    startTime: number,
  ): ToolResult {
    const metrics = { elapsedMs: Math.round(performance.now() - startTime) };
    let payload: JavaScriptToolResult;
    if (!outcome.ok) {
      payload = {
        success: false,
        tabId,
        engine: 'cdp',
        job_id: jobId,
        state: outcome.state,
        job_ms: outcome.jobMs,
        error: outcome.error,
        metrics,
      };
    } else if (outcome.state === 'done') {
      payload = {
        success: true,
        tabId,
        engine: 'cdp',
        job_id: jobId,
        state: 'done',
        job_ms: outcome.jobMs,
        result: outcome.output.text,
        truncated: outcome.output.truncated || undefined,
        redacted: outcome.output.redacted || undefined,
        message: outcome.reread
          ? 'Second read of a result that was already delivered; it is now dropped from the page.'
          : undefined,
        metrics,
      };
    } else {
      payload = {
        success: true,
        tabId,
        engine: 'cdp',
        job_id: jobId,
        state: outcome.state,
        job_ms: outcome.jobMs,
        message: outcome.message,
        metrics,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: !outcome.ok,
    };
  }
}

export const javascriptTool = new JavaScriptTool();
