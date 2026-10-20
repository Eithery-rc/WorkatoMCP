/**
 * Which modules are on: one switch per machine, kept in the bridge.
 *
 * Three Chrome profiles talk to one bridge, so the state lives here, in
 * `config.json` in the data dir (`{"modules": {"workato": true}}`), not in
 * chrome.storage: a switch per profile would make a session's tool list
 * depend on which profile it happens to route to. Every profile's popup reads
 * and writes this one value through the extension-to-bridge connection.
 *
 * A missing file or a missing key means DEFAULT_ENABLED (on in this release,
 * the behaviour before modules existed). A malformed file never crashes the
 * bridge: the last good state (or the default) stays in force and the problem
 * is logged. A read that fails for another reason (a file locked by an editor
 * or a sync tool) changes nothing and is retried on the next check.
 */

import * as fs from 'fs';
import * as path from 'path';
import { configFile } from '../data-dir';

/** A module the config does not mention is on. Step 3 of the 2.0 plan flips this. */
export const DEFAULT_ENABLED = true;

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

export class ModuleSwitch implements ModuleSwitchView {
  private states: ModuleStates = {};
  /**
   * The signature (mtime and size, or null for "no file") of the content the
   * states came from. Advanced only after a successful read and parse.
   */
  private signature: string | null | undefined = undefined;
  /** Signature of a malformed file already reported, so it is logged once. */
  private reportedBad: string | null = null;
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
    this.now = options.now ?? Date.now;
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
   * that is not valid JSON is moved aside to config.json.malformed first. A
   * file that cannot be read for another reason is left alone and the set
   * fails, rather than replacing settings it could not see.
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
      try {
        const parsed = JSON.parse(raw);
        if (isRecord(parsed)) doc = parsed;
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        fs.renameSync(file, `${file}.malformed`);
        this.log(`${file} was not valid JSON; moved it to ${file}.malformed`);
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
    if (!force && now - this.lastCheckAt < this.recheckMs) return;
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err: any) {
        if (this.reportedBad !== signature) {
          this.reportedBad = signature;
          this.log(
            `${file} is not valid JSON (${err?.message || String(err)}); keeping the last good ` +
              'module state',
          );
        }
        return;
      }
      const modules = isRecord(parsed) && isRecord(parsed.modules) ? parsed.modules : {};
      for (const [id, value] of Object.entries(modules)) {
        if (typeof value === 'boolean') next[id] = value;
        else this.log(`${file}: modules.${id} is not true or false; using the default`);
      }
    }

    const previous = this.states;
    this.states = next;
    this.signature = signature;
    this.reportedBad = null;
    const ids = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const id of ids) {
      if ((previous[id] ?? DEFAULT_ENABLED) !== (next[id] ?? DEFAULT_ENABLED)) {
        this.emit();
        return;
      }
    }
  }
}

/** The process-wide switch, read from the bridge config file. */
export const moduleSwitch = new ModuleSwitch();
