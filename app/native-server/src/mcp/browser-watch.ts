/**
 * Background tab watches (chrome_watch_*).
 *
 * The bridge runs an agent-written script in chosen tabs on a timer and turns
 * changes in its result into events. The agent waits for events with a
 * background process (`cli watch-wait`, a long poll on /watch/wait) instead of
 * looking at the page itself, so a quiet page costs it nothing.
 *
 * Change rules: an array result reports only items never seen before in that
 * tab (by `key`, else the whole item); any other value reports when it differs
 * from the previous reading. The first reading of a tab is its baseline, and
 * null/undefined means "no reading" (page not ready), which changes nothing.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from 'workatomcp-shared';
import { NATIVE_SERVER_PORT } from '../constant';

export const WATCH_START_TOOL = TOOL_NAMES.BROWSER.WATCH_START;
export const WATCH_STOP_TOOL = TOOL_NAMES.BROWSER.WATCH_STOP;
export const WATCH_LIST_TOOL = TOOL_NAMES.BROWSER.WATCH_LIST;
export const WATCH_EVENTS_TOOL = TOOL_NAMES.BROWSER.WATCH_EVENTS;
export const WATCH_TOOLS = new Set<string>([
  WATCH_START_TOOL,
  WATCH_STOP_TOOL,
  WATCH_LIST_TOOL,
  WATCH_EVENTS_TOOL,
]);

export function isWatchTool(name: string): boolean {
  return WATCH_TOOLS.has(name);
}

export const MIN_EVERY_MS = 10_000;
const DEFAULT_EVERY_MS = 30_000;
const DEFAULT_TTL_MIN = 720;
const MAX_TTL_MIN = 10_080;
const MAX_WATCHES = 20;
const MAX_TABS_PER_WATCH = 10;
const MAX_SCRIPT_CHARS = 20_000;
const MAX_EVENTS = 500;
const PERSISTED_EVENTS = 100;
const MAX_SEEN_KEYS = 5000;
/** Items of one array reading that are compared; the rest are ignored. */
const MAX_ITEMS_PER_READING = 500;
/** Consecutive failed readings of a tab before it is reported as an event. */
export const ERROR_STREAK_TO_REPORT = 3;
const MAX_EVENT_ITEMS = 20;
const MAX_ITEM_CHARS = 600;
const MAX_VALUE_CHARS = 1500;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_WAIT_MS = 15 * 60 * 1000;

export interface WatchSpec {
  id: string;
  name: string | null;
  profile: string;
  tabIds: number[];
  urls: string[];
  script: string;
  everyMs: number;
  key: string | null;
  createdAt: number;
  expiresAt: number;
  /** Engine of the first reading; the watch keeps it (see watch-probe.ts). */
  engine?: 'userScripts' | 'cdp';
}

interface TabState {
  url?: string;
  title?: string;
  /** Origin of the first successful reading; an explicit tab must stay on it. */
  origin?: string;
  /** Scalar results: hash and value of the last reading. */
  lastHash?: string;
  lastValue?: unknown;
  /** Array results: keys seen so far, oldest first. */
  seen?: string[];
  lastReadingAt?: number;
  errorStreak: number;
  errorReported: boolean;
  lastError?: string;
}

export type WatchEventKind = 'added' | 'changed' | 'error' | 'recovered' | 'ended';

export interface WatchEvent {
  seq: number;
  at: string;
  watch_id: string;
  name: string | null;
  profile: string;
  kind: WatchEventKind;
  tab_id?: number;
  url?: string;
  title?: string;
  added?: unknown[];
  added_total?: number;
  value?: unknown;
  previous?: unknown;
  error?: string;
  reason?: string;
}

export interface ProbeResult {
  tabId: number;
  url?: string;
  title?: string;
  ok: boolean;
  value?: unknown;
  error?: string;
  /** Not read this tick (busy, loading); not an error. */
  skipped?: string;
  /** The tab no longer exists. */
  gone?: boolean;
}

export interface ProbeReply {
  results: ProbeResult[];
  engine?: string;
  note?: string;
}

export interface ProbePayload {
  script: string;
  tabIds: number[];
  urls: string[];
  timeoutMs: number;
  maxTabs: number;
  origins: Record<string, string>;
  engine?: 'userScripts' | 'cdp';
}

export interface WatchDeps {
  probe(profile: string, payload: ProbePayload): Promise<ProbeReply>;
  isConnected(profile: string): boolean;
  now(): number;
  /** Where watches are persisted; null keeps them in memory only (tests). */
  stateFile: string | null;
}

interface WatchRuntime {
  spec: WatchSpec;
  tabs: Map<number, TabState>;
  /** Runtime-only Set mirror of each tab's `seen` list. */
  seenSets: Map<number, Set<string>>;
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastTickAt: number | null;
  status: string;
  engine?: string;
  engineNote?: string;
  events: number;
  /** Ticks in a row where every explicit tab was gone. */
  goneStreak: number;
}

interface Waiter {
  ids: Set<string> | null;
  cursor: number;
  resolve: (value: { events: WatchEvent[]; cursor: number }) => void;
  timer: NodeJS.Timeout;
}

/** JSON with sorted object keys, so equal values hash equally. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) sorted[key] = v[key];
      return sorted;
    }
    return v;
  });
}

/** The value itself when its JSON is short, else a truncated JSON string. */
export function capValue(value: unknown, maxChars: number): unknown {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
  if (text === undefined || text.length <= maxChars) return value;
  return `${text.slice(0, maxChars)}... [truncated, ${text.length} chars]`;
}

/** Identity of an array item. Whole-item keys are hashed: page text is not kept. */
function itemKey(item: unknown, key: string | null): string {
  if (key && item && typeof item === 'object' && !Array.isArray(item)) {
    const field = (item as Record<string, unknown>)[key];
    if (field !== undefined && field !== null) return `k:${String(field).slice(0, 200)}`;
  }
  return `v:${createHash('sha1').update(stableStringify(item)).digest('hex')}`;
}

function originOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}

function newWatchId(): string {
  return `W${randomBytes(3).toString('hex')}`;
}

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The command an agent runs in the background to wait for events. */
export function waitCommand(ids: string[], cursor: number, port = bridgePort()): string {
  const cli = path.resolve(__dirname, '..', 'cli.js').replace(/\\/g, '/');
  const portArg = port === NATIVE_SERVER_PORT ? '' : ` --port ${port}`;
  const idArg = ids.length > 0 ? ` --id ${ids.join(',')}` : '';
  return `node "${cli}" watch-wait${idArg} --cursor ${cursor}${portArg}`;
}

function bridgePort(): number {
  const fromEnv = Number(process.env.CHROME_MCP_PORT);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : NATIVE_SERVER_PORT;
}

export class WatchManager {
  private watches = new Map<string, WatchRuntime>();
  private events: WatchEvent[] = [];
  private seq = 0;
  private waiters = new Set<Waiter>();
  private saveTimer: NodeJS.Timeout | null = null;
  private initialized = false;
  /** State changed since the last write. */
  private dirty = false;
  /** Inside applyReply, which writes once at its end. */
  private applying = false;

  constructor(private deps: WatchDeps) {}

  get cursor(): number {
    return this.seq;
  }

  /** Restore persisted watches and start their timers. Idempotent. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    const file = this.deps.stateFile;
    if (!file) return;
    let raw: any;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return;
    }
    if (raw?.version !== 1) return;
    this.seq = numberOr(raw.seq, 0);
    this.events = Array.isArray(raw.events) ? raw.events.filter((e: any) => e && e.seq > 0) : [];
    const now = this.deps.now();
    for (const spec of Array.isArray(raw.watches) ? raw.watches : []) {
      // A damaged entry is dropped, never allowed to break the bridge start.
      try {
        if (!spec?.id || typeof spec.script !== 'string' || !(spec.expiresAt > now)) continue;
        if (typeof spec.profile !== 'string' || !Array.isArray(spec.tabIds)) continue;
        if (!Array.isArray(spec.urls)) continue;
        spec.everyMs = Math.max(MIN_EVERY_MS, numberOr(spec.everyMs, DEFAULT_EVERY_MS));
        const rt = this.newRuntime(spec as WatchSpec);
        const tabs = raw.tabs?.[spec.id];
        for (const [tabId, state] of Object.entries(tabs && typeof tabs === 'object' ? tabs : {})) {
          if (!state || typeof state !== 'object') continue;
          const tabState = state as TabState;
          rt.tabs.set(Number(tabId), { ...tabState, errorStreak: 0, errorReported: false });
          if (Array.isArray(tabState.seen)) rt.seenSets.set(Number(tabId), new Set(tabState.seen));
        }
        this.watches.set(rt.spec.id, rt);
        this.schedule(rt);
      } catch {
        /* skip it */
      }
    }
  }

  /** Write pending state now (process exit). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) this.save();
  }

  /**
   * Answer every held long poll now, with no events. The server calls this
   * before closing: a held poll would otherwise keep the close waiting.
   */
  releaseWaiters(): void {
    for (const waiter of [...this.waiters]) waiter.resolve({ events: [], cursor: this.seq });
  }

  private newRuntime(spec: WatchSpec): WatchRuntime {
    return {
      spec,
      tabs: new Map(),
      seenSets: new Map(),
      timer: null,
      running: false,
      lastTickAt: null,
      status: 'starting',
      events: 0,
      goneStreak: 0,
    };
  }

  private schedule(rt: WatchRuntime): void {
    if (rt.timer) clearInterval(rt.timer);
    rt.timer = setInterval(() => void this.tick(rt), rt.spec.everyMs);
    rt.timer.unref?.();
  }

  /**
   * Validate, read every target once, and keep the watch only when at least
   * one tab answered: a script that throws everywhere, or a pattern that
   * matches nothing, is reported now instead of becoming a silent watch.
   */
  async start(
    args: Record<string, any>,
    profile: string,
  ): Promise<{ spec: WatchSpec; reply: ProbeReply }> {
    const script = typeof args.script === 'string' ? args.script.trim() : '';
    if (!script) throw new Error('script is required (the body of an async function).');
    if (script.length > MAX_SCRIPT_CHARS) {
      throw new Error(`script is ${script.length} chars; the limit is ${MAX_SCRIPT_CHARS}.`);
    }
    const tabIds = Array.isArray(args.tabIds)
      ? args.tabIds.filter((id: unknown) => typeof id === 'number' && Number.isInteger(id))
      : [];
    const urls = (
      Array.isArray(args.url) ? args.url : typeof args.url === 'string' ? [args.url] : []
    )
      .filter((u: unknown) => typeof u === 'string' && u.trim() !== '')
      .map((u: string) => u.trim());
    if (tabIds.length === 0 && urls.length === 0) {
      throw new Error('give tabIds, url (match patterns), or both.');
    }
    if (tabIds.length > MAX_TABS_PER_WATCH) {
      throw new Error(`at most ${MAX_TABS_PER_WATCH} tabs per watch.`);
    }
    if (this.watches.size >= MAX_WATCHES) {
      throw new Error(
        `${MAX_WATCHES} watches are already active; stop one with chrome_watch_stop first.`,
      );
    }
    const everyMs = Math.max(
      MIN_EVERY_MS,
      Math.round(numberOr(args.every_seconds, DEFAULT_EVERY_MS / 1000) * 1000),
    );
    const ttlMin = Math.min(MAX_TTL_MIN, Math.max(1, numberOr(args.ttl_minutes, DEFAULT_TTL_MIN)));
    const now = this.deps.now();
    const spec: WatchSpec = {
      id: newWatchId(),
      name: typeof args.name === 'string' && args.name.trim() ? args.name.trim() : null,
      profile,
      tabIds,
      urls,
      script,
      everyMs,
      key: typeof args.key === 'string' && args.key.trim() ? args.key.trim() : null,
      createdAt: now,
      expiresAt: now + ttlMin * 60_000,
    };
    const rt = this.newRuntime(spec);
    const reply = await this.deps.probe(profile, this.probePayload(rt));
    const results = Array.isArray(reply?.results) ? reply.results : [];
    if (results.length === 0) {
      throw new Error(
        `no tab matched in profile "${profile}" (tabIds ${JSON.stringify(tabIds)}, url ` +
          `${JSON.stringify(urls)}). Nothing is being watched.`,
      );
    }
    if (!results.some((r) => r.ok || r.skipped)) {
      const errors = results.map((r) => `tab ${r.tabId}: ${r.error ?? 'failed'}`).join('; ');
      throw new Error(`the script failed in every tab (${errors}). Nothing is being watched.`);
    }
    if (reply.engine === 'userScripts' || reply.engine === 'cdp') spec.engine = reply.engine;
    this.applyReply(rt, reply);
    this.watches.set(spec.id, rt);
    this.schedule(rt);
    this.markDirty(true);
    return { spec, reply };
  }

  stop(id: string, reason = 'stopped'): boolean {
    const rt = this.watches.get(id);
    if (!rt) return false;
    if (rt.timer) clearInterval(rt.timer);
    this.watches.delete(id);
    this.emit(rt, { kind: 'ended', reason });
    return true;
  }

  stopAll(): string[] {
    const ids = [...this.watches.keys()];
    for (const id of ids) this.stop(id);
    return ids;
  }

  has(id: string): boolean {
    return this.watches.has(id);
  }

  list(): Record<string, unknown>[] {
    const now = this.deps.now();
    return [...this.watches.values()].map((rt) => ({
      watch_id: rt.spec.id,
      name: rt.spec.name,
      profile: rt.spec.profile,
      tabIds: rt.spec.tabIds,
      url: rt.spec.urls,
      every_seconds: rt.spec.everyMs / 1000,
      key: rt.spec.key,
      status: rt.status,
      engine: rt.engine ?? null,
      events: rt.events,
      last_tick: rt.lastTickAt ? new Date(rt.lastTickAt).toISOString() : null,
      expires_in_minutes: Math.max(0, Math.round((rt.spec.expiresAt - now) / 60_000)),
      tabs: [...rt.tabs.entries()].map(([tabId, state]) => ({
        tabId,
        title: state.title ?? null,
        last_reading: state.seen
          ? `${state.seen.length} item(s) seen`
          : state.lastHash !== undefined
            ? capValue(state.lastValue, 200)
            : null,
        ...(state.lastError ? { error: state.lastError, error_streak: state.errorStreak } : {}),
      })),
    }));
  }

  /** Events after `cursor` (all kept events when omitted), filtered by watch ids. */
  eventsAfter(ids: Set<string> | null, cursor?: number): WatchEvent[] {
    const from = cursor ?? -1;
    return this.events.filter((e) => e.seq > from && (!ids || ids.has(e.watch_id)));
  }

  /**
   * Resolve with the first events after `cursor`, or with none after
   * `timeoutMs`. A wait on watch ids that no longer exist returns at once, so
   * a background waiter never outlives its watch.
   */
  waitEvents(
    ids: Set<string> | null,
    cursor: number | undefined,
    timeoutMs: number,
    signal?: { onAbort(fn: () => void): void },
  ): Promise<{ events: WatchEvent[]; cursor: number; note?: string }> {
    // A cursor past the current seq (state lost in a crash) would strand the
    // waiter until seq caught up; treat it as "from now".
    const from = Math.min(cursor ?? this.seq, this.seq);
    const ready = this.eventsAfter(ids, from);
    if (ready.length > 0) return Promise.resolve({ events: ready, cursor: this.seq });
    if (ids && ![...ids].some((id) => this.watches.has(id))) {
      return Promise.resolve({
        events: [],
        cursor: this.seq,
        note: `no active watch with id ${[...ids].join(', ')}`,
      });
    }
    if (timeoutMs <= 0) return Promise.resolve({ events: [], cursor: this.seq });
    return new Promise((resolve) => {
      const waiter: Waiter = {
        ids,
        cursor: from,
        resolve: (value) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          resolve(value);
        },
        timer: setTimeout(
          () => waiter.resolve({ events: [], cursor: this.seq }),
          Math.min(timeoutMs, MAX_WAIT_MS),
        ),
      };
      this.waiters.add(waiter);
      signal?.onAbort(() => waiter.resolve({ events: [], cursor: this.seq }));
    });
  }

  private probePayload(rt: WatchRuntime): ProbePayload {
    const { spec } = rt;
    const origins: Record<string, string> = {};
    for (const tabId of spec.tabIds) {
      const origin = rt.tabs.get(tabId)?.origin;
      if (origin) origins[String(tabId)] = origin;
    }
    return {
      script: spec.script,
      tabIds: spec.tabIds,
      urls: spec.urls,
      timeoutMs: PROBE_TIMEOUT_MS,
      maxTabs: MAX_TABS_PER_WATCH,
      origins,
      ...(spec.engine ? { engine: spec.engine } : {}),
    };
  }

  /** One reading of every target tab. Exposed for tests. */
  async tick(rt: WatchRuntime | string): Promise<void> {
    const runtime = typeof rt === 'string' ? this.watches.get(rt) : rt;
    if (!runtime || runtime.running) return;
    const { spec } = runtime;
    if (this.deps.now() >= spec.expiresAt) {
      this.stop(spec.id, 'expired');
      return;
    }
    if (!this.deps.isConnected(spec.profile)) {
      runtime.status = 'profile_offline';
      return;
    }
    runtime.running = true;
    try {
      const reply = await this.deps.probe(spec.profile, this.probePayload(runtime));
      if (!this.watches.has(spec.id)) return;
      this.applyReply(runtime, reply);
    } catch (err: any) {
      runtime.status = `probe_failed: ${err?.message || String(err)}`;
    } finally {
      runtime.running = false;
      runtime.lastTickAt = this.deps.now();
    }
  }

  /**
   * Apply one tick. Events are written to disk at once (a restart must not
   * lose an event a waiter already handed out); other changes are batched.
   */
  private applyReply(rt: WatchRuntime, reply: ProbeReply): void {
    const seqBefore = this.seq;
    let changed: boolean;
    this.applying = true;
    try {
      changed = this.applyReplyInner(rt, reply);
    } finally {
      this.applying = false;
    }
    const emitted = this.seq !== seqBefore;
    this.markDirty(emitted, changed || emitted);
  }

  private applyReplyInner(rt: WatchRuntime, reply: ProbeReply): boolean {
    let changed = false;
    const results = Array.isArray(reply?.results) ? reply.results : [];
    if (reply?.engine) rt.engine = reply.engine;
    if (reply?.note) rt.engineNote = reply.note;
    rt.status = 'ok';
    const present = new Set<number>();
    for (const result of results) {
      present.add(result.tabId);
      if (this.applyResult(rt, result)) changed = true;
    }
    // A tab found by url that is gone now just leaves; its state goes with it.
    for (const tabId of [...rt.tabs.keys()]) {
      if (!present.has(tabId) && !rt.spec.tabIds.includes(tabId)) {
        rt.tabs.delete(tabId);
        rt.seenSets.delete(tabId);
        changed = true;
      }
    }
    // Every explicitly named tab closed and nothing found by url: end it.
    const explicitGone =
      rt.spec.tabIds.length > 0 &&
      rt.spec.urls.length === 0 &&
      rt.spec.tabIds.every((id) => results.find((r) => r.tabId === id)?.gone);
    rt.goneStreak = explicitGone ? rt.goneStreak + 1 : 0;
    if (rt.goneStreak >= ERROR_STREAK_TO_REPORT) {
      if (rt.timer) clearInterval(rt.timer);
      this.watches.delete(rt.spec.id);
      this.emit(rt, { kind: 'ended', reason: 'every watched tab is closed' });
      return true;
    }
    if (results.length === 0 && rt.spec.urls.length > 0) rt.status = 'no_matching_tab';
    return changed;
  }

  /** Apply one tab's reading; true when persisted state changed. */
  private applyResult(rt: WatchRuntime, result: ProbeResult): boolean {
    const known = rt.tabs.get(result.tabId);
    const state: TabState = known ?? { errorStreak: 0, errorReported: false };
    let changed = !known || (result.url !== undefined && result.url !== state.url);
    rt.tabs.set(result.tabId, state);
    if (result.url) state.url = result.url;
    if (result.title) state.title = result.title;
    const where = { tab_id: result.tabId, url: state.url, title: state.title };

    if (result.skipped) return changed;
    if (!result.ok) {
      state.errorStreak += 1;
      state.lastError = result.error ?? (result.gone ? 'tab is closed' : 'failed');
      if (state.errorStreak >= ERROR_STREAK_TO_REPORT && !state.errorReported) {
        state.errorReported = true;
        this.emit(rt, { kind: 'error', ...where, error: state.lastError });
      }
      return changed;
    }
    if (state.errorReported) {
      this.emit(rt, { kind: 'recovered', ...where });
    }
    state.errorStreak = 0;
    state.errorReported = false;
    delete state.lastError;
    if (!state.origin) {
      state.origin = originOf(result.url);
      changed = true;
    }

    const value = result.value;
    if (value === null || value === undefined) return changed;
    const now = this.deps.now();
    const firstReading = state.lastReadingAt === undefined;
    state.lastReadingAt = now;
    if (firstReading) changed = true;

    if (Array.isArray(value)) {
      let seen = rt.seenSets.get(result.tabId);
      if (!seen) {
        seen = new Set(state.seen ?? []);
        rt.seenSets.set(result.tabId, seen);
      }
      state.seen = state.seen ?? [];
      delete state.lastHash;
      delete state.lastValue;
      const added: unknown[] = [];
      for (const item of value.slice(0, MAX_ITEMS_PER_READING)) {
        const key = itemKey(item, rt.spec.key);
        if (seen.has(key)) continue;
        seen.add(key);
        state.seen.push(key);
        added.push(item);
      }
      if (state.seen.length > MAX_SEEN_KEYS) {
        for (const old of state.seen.splice(0, state.seen.length - MAX_SEEN_KEYS)) seen.delete(old);
      }
      if (!firstReading && added.length > 0) {
        this.emit(rt, {
          kind: 'added',
          ...where,
          added: added.slice(0, MAX_EVENT_ITEMS).map((item) => capValue(item, MAX_ITEM_CHARS)),
          added_total: added.length,
        });
      }
      return changed || added.length > 0;
    }

    const hash = stableStringify(value);
    const previous = state.lastValue;
    const valueChanged = state.lastHash !== undefined && state.lastHash !== hash;
    if (state.lastHash === undefined) changed = true;
    state.lastHash = hash;
    state.lastValue = capValue(value, MAX_VALUE_CHARS);
    delete state.seen;
    rt.seenSets.delete(result.tabId);
    if (!firstReading && valueChanged) {
      this.emit(rt, {
        kind: 'changed',
        ...where,
        value: state.lastValue,
        previous,
      });
    }
    return changed || valueChanged;
  }

  private emit(rt: WatchRuntime, fields: Partial<WatchEvent> & { kind: WatchEventKind }): void {
    this.seq += 1;
    rt.events += 1;
    const event: WatchEvent = {
      seq: this.seq,
      at: new Date(this.deps.now()).toISOString(),
      watch_id: rt.spec.id,
      name: rt.spec.name,
      profile: rt.spec.profile,
      ...fields,
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    for (const waiter of [...this.waiters]) {
      const ready = this.eventsAfter(waiter.ids, waiter.cursor);
      if (ready.length > 0) waiter.resolve({ events: ready, cursor: this.seq });
    }
    // stop() and the expiry path emit outside a tick: write those right away.
    this.dirty = true;
    if (!this.applying) this.markDirty(true);
  }

  /** Write now (`now`), or within a few seconds when only `changed`. */
  private markDirty(now: boolean, changed = now): void {
    if (!now && !changed) return;
    this.dirty = true;
    if (!this.deps.stateFile) return;
    if (now) {
      this.flush();
      return;
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) this.save();
    }, 5000);
    this.saveTimer.unref?.();
  }

  private save(): void {
    const file = this.deps.stateFile;
    if (!file) return;
    const tabs: Record<string, Record<string, TabState>> = {};
    for (const rt of this.watches.values()) {
      tabs[rt.spec.id] = Object.fromEntries(rt.tabs.entries());
    }
    const data = {
      version: 1,
      seq: this.seq,
      watches: [...this.watches.values()].map((rt) => rt.spec),
      tabs,
      events: this.events.slice(-PERSISTED_EVENTS),
    };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      try {
        fs.renameSync(tmp, file);
      } catch {
        // Windows: a scanner holding the target makes rename fail; write in place.
        fs.writeFileSync(file, JSON.stringify(data));
      }
      this.dirty = false;
    } catch {
      /* best effort: the watches keep running in memory, the next change retries */
    }
  }

  /** Stop timers (tests). */
  dispose(): void {
    for (const rt of this.watches.values()) if (rt.timer) clearInterval(rt.timer);
    for (const waiter of [...this.waiters]) waiter.resolve({ events: [], cursor: this.seq });
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }
}

function parseIds(value: unknown): Set<string> | null {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const ids = list.map((v) => String(v).trim()).filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

/** chrome_watch_* tool calls. `profile` is the routed profile for start. */
export async function handleWatchToolCall(
  manager: WatchManager,
  name: string,
  args: Record<string, any>,
  profile: string | null,
): Promise<CallToolResult> {
  try {
    if (name === WATCH_START_TOOL) {
      if (!profile) return textResult('Error: no Chrome profile is connected to watch in.', true);
      const { spec, reply } = await manager.start(args, profile);
      const cursor = manager.cursor;
      const readings = reply.results.map((r) => ({
        tabId: r.tabId,
        title: r.title ?? null,
        ...(r.ok
          ? { reading: capValue(r.value, 400) }
          : r.skipped
            ? { skipped: r.skipped }
            : { error: r.error ?? 'failed' }),
      }));
      return textResult(
        JSON.stringify(
          {
            watch_id: spec.id,
            name: spec.name,
            profile: spec.profile,
            every_seconds: spec.everyMs / 1000,
            expires_at: new Date(spec.expiresAt).toISOString(),
            engine: reply.engine ?? null,
            ...(reply.note ? { engine_note: reply.note } : {}),
            first_reading: readings,
            cursor,
            wait_command: waitCommand([spec.id], cursor),
            note:
              'Run wait_command with Bash run_in_background (timeout 7200000). It exits with the ' +
              'events when something changes and prints the command to re-arm. Several watches: ' +
              'join their ids with commas in --id.',
          },
          null,
          2,
        ),
      );
    }
    if (name === WATCH_STOP_TOOL) {
      if (args.all === true) {
        return textResult(JSON.stringify({ stopped: manager.stopAll() }));
      }
      const id = typeof args.watch_id === 'string' ? args.watch_id.trim() : '';
      if (!id) return textResult('Error: pass watch_id, or all:true.', true);
      if (!manager.stop(id)) return textResult(`Error: no active watch "${id}".`, true);
      return textResult(JSON.stringify({ stopped: [id] }));
    }
    if (name === WATCH_LIST_TOOL) {
      return textResult(
        JSON.stringify({ cursor: manager.cursor, watches: manager.list() }, null, 2),
      );
    }
    if (name === WATCH_EVENTS_TOOL) {
      const ids = parseIds(args.watch_ids);
      const cursor = typeof args.cursor === 'number' ? args.cursor : undefined;
      const waitMs = Math.min(100, Math.max(0, numberOr(args.wait_seconds, 0))) * 1000;
      const result =
        waitMs > 0
          ? await manager.waitEvents(ids, cursor ?? -1, waitMs)
          : { events: manager.eventsAfter(ids, cursor), cursor: manager.cursor };
      return textResult(JSON.stringify(result));
    }
    return textResult(`Error: unknown watch tool ${name}.`, true);
  } catch (err: any) {
    return textResult(`Error: ${err?.message || String(err)}`, true);
  }
}

/** The /watch/wait long poll used by `cli watch-wait`. */
export function parseWaitQuery(query: Record<string, unknown>): {
  ids: Set<string> | null;
  cursor: number | undefined;
  timeoutMs: number;
} {
  const cursor = Number(query.cursor);
  const timeoutMs = Number(query.timeoutMs);
  return {
    ids: parseIds(query.ids),
    cursor: query.cursor !== undefined && Number.isFinite(cursor) ? cursor : undefined,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
  };
}
