/**
 * Which modules are on: one switch per machine, kept in the bridge.
 *
 * Three Chrome profiles talk to one bridge, so the state lives here, in
 * `config.json` in the data dir (`{"modules": {"workato": true}}`), not in
 * chrome.storage: a switch per profile would make a session's tool list
 * depend on which profile it happens to route to. Every profile's popup reads
 * and writes this one value through the extension-to-bridge connection.
 *
 * A missing file or a missing key means DEFAULT_ENABLED: off. The first 2.x
 * start decides, once, between a fresh install (the core only) and an upgrade
 * from 1.x (which keeps the modules 1.x served on), and writes the answer into
 * config.json as an explicit value (recordModuleDefaults, run by
 * startup-migration.ts), so later starts never have to guess again. An
 * explicit true or false in the file always wins. A malformed file never
 * crashes the bridge: the last good state (or the default) stays in force and
 * the problem is logged. A read that fails for another reason (a file locked
 * by an editor or a sync tool) changes nothing and is retried on the next
 * check.
 */

import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { configFile } from '../data-dir';

/** A module the config does not mention is off (the first start writes it either way). */
export const DEFAULT_ENABLED = false;

/** The file is stat'ed at most this often; a change shows up within this window. */
export const MODULE_SWITCH_RECHECK_MS = 250;

export type ModuleStates = Record<string, boolean>;

export interface ModuleSwitchView {
  isEnabled(id: string): boolean;
}

export interface ModuleSwitchIo {
  readFile(file: string): string;
  stat(file: string): { mtimeMs: number; size: number };
}

const DEFAULT_IO: ModuleSwitchIo = {
  readFile: (file) => fs.readFileSync(file, 'utf8'),
  stat: (file) => fs.statSync(file),
};

export interface ModuleSwitchOptions {
  /** Minimum time between two looks at the file (default MODULE_SWITCH_RECHECK_MS). */
  recheckMs?: number;
  now?: () => number;
  /** File reads (a test seam; defaults to fs). */
  io?: ModuleSwitchIo;
}

type Listener = (states: ModuleStates) => void;

/** Logs go to stderr: stdout is the native-messaging channel. */
function defaultLog(message: string): void {
  console.error(`[modules] ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

type FileSignature = { kind: 'file'; signature: string } | { kind: 'missing' } | { kind: 'error' };

type ParsedConfig = { ok: true; doc: Record<string, unknown> } | { ok: false; reason: string };

/**
 * The config document, or why it is not one. A UTF-8 BOM (which some Windows
 * editors write) is ignored; valid JSON that is not an object is as unusable
 * as a syntax error.
 */
function parseConfig(raw: string): ParsedConfig {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err: any) {
    return { ok: false, reason: `not valid JSON (${err?.message || String(err)})` };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      reason: `not a JSON object (${Array.isArray(parsed) ? 'an array' : String(parsed)})`,
    };
  }
  return { ok: true, doc: parsed };
}

/** Where a malformed file is moved: stamped, so a second one never replaces the first. */
function malformedCopyPath(file: string, at: Date): string {
  const stem = `${file}.malformed-${at.toISOString().replace(/[:.]/g, '-')}`;
  let candidate = stem;
  for (let n = 1; fs.existsSync(candidate); n++) candidate = `${stem}-${n}`;
  return candidate;
}

export class ModuleSwitch implements ModuleSwitchView {
  private states: ModuleStates = {};
  /**
   * The signature (mtime and size, or null for "no file") of the content the
   * states came from. Advanced only after a successful read and parse.
   */
  private signature: string | null | undefined = undefined;
  /** Signature of a malformed file already reported, so it is logged once. */
  private reportedBad: string | null = null;
  /** Whether a state was established yet; the first one is not reported as a change. */
  private baselineSet = false;
  private lastCheckAt = Number.NEGATIVE_INFINITY;
  private listeners = new Set<Listener>();
  private readonly recheckMs: number;
  private readonly now: () => number;
  private readonly io: ModuleSwitchIo;

  constructor(
    private readonly file: () => string = configFile,
    private readonly log: (message: string) => void = defaultLog,
    options: ModuleSwitchOptions = {},
  ) {
    this.recheckMs = options.recheckMs ?? MODULE_SWITCH_RECHECK_MS;
    // Monotonic by default: a wall clock can step back (NTP, a resumed laptop).
    this.now = options.now ?? (() => performance.now());
    this.io = options.io ?? DEFAULT_IO;
  }

  isEnabled(id: string): boolean {
    this.refresh();
    return this.stateOf(id);
  }

  /** The state of each given module id. */
  snapshot(ids: readonly string[]): ModuleStates {
    this.refresh();
    const out: ModuleStates = {};
    for (const id of ids) out[id] = this.stateOf(id);
    return out;
  }

  /**
   * Switch one module and persist it. Other keys of the file are kept; a file
   * that is not a JSON object is moved aside to config.json.malformed-<time>
   * first. A file that cannot be read for another reason is left alone and
   * the set fails, rather than replacing settings it could not see.
   */
  set(id: string, enabled: boolean): void {
    this.refresh(true);
    const before = this.stateOf(id);
    const file = this.file();
    let doc: Record<string, unknown> = {};
    let raw: string | null = null;
    try {
      raw = this.io.readFile(file);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        throw new Error(`could not read ${file} (${err?.code || err?.message}); nothing changed`);
      }
    }
    if (raw !== null) {
      const parsed = parseConfig(raw);
      if (parsed.ok) {
        doc = parsed.doc;
      } else {
        const aside = malformedCopyPath(file, new Date());
        fs.renameSync(file, aside);
        this.log(`${file} was ${parsed.reason}; moved it to ${aside}`);
      }
    }
    const modules = isRecord(doc.modules) ? { ...doc.modules } : {};
    modules[id] = enabled;
    doc.modules = modules;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
    fs.renameSync(tmp, file);
    this.states = { ...this.states, [id]: enabled };
    const written = this.statFile(file);
    this.signature = written.kind === 'file' ? written.signature : undefined;
    this.lastCheckAt = this.now();
    this.baselineSet = true;
    if (before !== enabled) this.emit();
  }

  /** Called with the full state map whenever a module's effective state changes. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private stateOf(id: string): boolean {
    return this.states[id] ?? DEFAULT_ENABLED;
  }

  private emit(): void {
    const states = { ...this.states };
    for (const listener of this.listeners) {
      try {
        listener(states);
      } catch (err: any) {
        this.log(`a module switch listener failed: ${err?.message || String(err)}`);
      }
    }
  }

  private statFile(file: string): FileSignature {
    try {
      const stat = this.io.stat(file);
      return { kind: 'file', signature: `${stat.mtimeMs}:${stat.size}` };
    } catch (err: any) {
      return err?.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'error' };
    }
  }

  /** Re-read the file when it changed on disk (a hand edit, another process). */
  private refresh(force = false): void {
    const now = this.now();
    const elapsed = now - this.lastCheckAt;
    // A clock that stepped back (elapsed < 0) must not hold the check off.
    if (!force && elapsed >= 0 && elapsed < this.recheckMs) return;
    this.lastCheckAt = now;

    const file = this.file();
    const stat = this.statFile(file);
    // Not readable right now: keep what we have and look again next time.
    if (stat.kind === 'error') return;
    const signature = stat.kind === 'missing' ? null : stat.signature;
    if (signature === this.signature) return;

    const next: ModuleStates = {};
    if (stat.kind === 'file') {
      let raw: string;
      try {
        raw = this.io.readFile(file);
      } catch {
        // Locked or gone between the stat and the read: retry next time.
        return;
      }
      const parsed = parseConfig(raw);
      if (!parsed.ok) {
        if (this.reportedBad !== signature) {
          this.reportedBad = signature;
          this.log(`${file} is ${parsed.reason}; keeping the last good module state`);
        }
        // The defaults (or the last good state) are what callers now see.
        this.baselineSet = true;
        return;
      }
      const modules = isRecord(parsed.doc.modules) ? parsed.doc.modules : {};
      for (const [id, value] of Object.entries(modules)) {
        if (typeof value === 'boolean') next[id] = value;
        else this.log(`${file}: modules.${id} is not true or false; using the default`);
      }
    }

    const previous = this.states;
    this.states = next;
    this.signature = signature;
    this.reportedBad = null;
    // The first state read is where the switch starts, not a change: an
    // upgraded machine's {"workato": true} differs from the default, and
    // announcing it would push a second state and a list_changed on every
    // bridge start.
    const first = !this.baselineSet;
    this.baselineSet = true;
    if (first) return;
    const ids = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const id of ids) {
      if ((previous[id] ?? DEFAULT_ENABLED) !== (next[id] ?? DEFAULT_ENABLED)) {
        this.emit();
        return;
      }
    }
  }
}

/** The ids `doc` sets to true or false. */
function explicitIds(doc: Record<string, unknown>, ids: readonly string[]): Set<string> {
  const modules = isRecord(doc.modules) ? doc.modules : {};
  return new Set(ids.filter((id) => typeof modules[id] === 'boolean'));
}

/**
 * Write `on` into `file` for each of `ids` it does not set to true or
 * false yet, keeping every other key: how the first start records whether
 * this machine is a fresh install or an upgrade (`why` says which, for the
 * log). An explicit value is never touched. A file that is not a JSON object
 * is left alone (the switch reports it as usual, and the default applies).
 * Returns the ids written.
 *
 * Several bridge processes start at once during a reload, all deciding the
 * same thing: each writes its own temp file and renames it into place, so a
 * reader never sees half a file, and a rename that loses to another
 * process's leaves that one's (equal) answer.
 */
export function recordModuleDefaults(
  file: string,
  ids: readonly string[],
  on: boolean,
  why: string,
  log: (message: string) => void = defaultLog,
): string[] {
  const read = (): ParsedConfig | null => {
    try {
      return parseConfig(fs.readFileSync(file, 'utf8'));
    } catch (err: any) {
      if (err?.code === 'ENOENT') return { ok: true, doc: {} };
      log(`could not read ${file} (${err?.code || err?.message}); nothing recorded`);
      return null;
    }
  };
  const parsed = read();
  if (!parsed) return [];
  if (!parsed.ok) {
    log(`${file} is ${parsed.reason}; not recording ${ids.join(', ')} (${why})`);
    return [];
  }
  const doc = parsed.doc;
  const explicit = explicitIds(doc, ids);
  const written = ids.filter((id) => !explicit.has(id));
  if (written.length === 0) return [];
  const modules = isRecord(doc.modules) ? { ...doc.modules } : {};
  for (const id of written) modules[id] = on;
  doc.modules = modules;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch (err: any) {
    fs.rmSync(tmp, { force: true });
    // Another bridge may have recorded the same answer a moment ago.
    const now = read();
    if (now?.ok && explicitIds(now.doc, ids).size === ids.length) return [];
    log(
      `could not write ${file} (${err?.code || err?.message}); ${written.join(', ')} not recorded`,
    );
    return [];
  }
  log(`${written.join(', ')} ${on ? 'on' : 'off'}: ${why} (recorded in ${file})`);
  return written;
}

/** The process-wide switch, read from the bridge config file. */
export const moduleSwitch = new ModuleSwitch();
