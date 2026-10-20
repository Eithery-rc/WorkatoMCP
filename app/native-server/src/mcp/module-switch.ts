/**
 * Which modules are on: one switch per machine, kept in the bridge.
 *
 * Three Chrome profiles talk to one bridge, so the state lives here, in
 * `config.json` in the data dir (`{"modules": {"workato": true}}`), not in
 * chrome.storage: a switch per profile would make a session's tool list
 * depend on which profile it happens to route to. Every profile's popup reads
 * and writes this one value through the extension-to-bridge connection.
 *
 * A missing file or a missing key means on (the behaviour before modules
 * existed). A malformed file never crashes the bridge: the last good state
 * (or the default) stays in force and the problem is logged.
 */

import * as fs from 'fs';
import * as path from 'path';
import { configFile } from '../data-dir';

export type ModuleStates = Record<string, boolean>;

export interface ModuleSwitchView {
  isEnabled(id: string): boolean;
}

type Listener = (states: ModuleStates) => void;

/** Logs go to stderr: stdout is the native-messaging channel. */
function defaultLog(message: string): void {
  console.error(`[modules] ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class ModuleSwitch implements ModuleSwitchView {
  private states: ModuleStates = {};
  /** mtime/size of the file the states came from; null when there was no file. */
  private signature: string | null | undefined = undefined;
  private listeners = new Set<Listener>();

  constructor(
    private readonly file: () => string = configFile,
    private readonly log: (message: string) => void = defaultLog,
  ) {}

  isEnabled(id: string): boolean {
    this.refresh();
    return this.states[id] ?? true;
  }

  /** The state of each given module id (default on). */
  snapshot(ids: readonly string[]): ModuleStates {
    this.refresh();
    const out: ModuleStates = {};
    for (const id of ids) out[id] = this.states[id] ?? true;
    return out;
  }

  /**
   * Switch one module and persist it. Other keys of the file are kept; a
   * malformed file is moved aside to config.json.malformed first.
   */
  set(id: string, enabled: boolean): void {
    this.refresh();
    const before = this.states[id] ?? true;
    const file = this.file();
    let doc: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isRecord(parsed)) doc = parsed;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        try {
          fs.renameSync(file, `${file}.malformed`);
          this.log(`${file} was not valid JSON; moved it to ${file}.malformed`);
        } catch {
          /* nothing to move */
        }
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
    this.signature = this.readSignature(file);
    if (before !== enabled) this.emit();
  }

  /** Called with the full state map whenever a module's effective state changes. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

  private readSignature(file: string): string | null {
    try {
      const stat = fs.statSync(file);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return null;
    }
  }

  /** Re-read the file when it changed on disk (a hand edit, another process). */
  private refresh(): void {
    const file = this.file();
    const signature = this.readSignature(file);
    if (signature === this.signature) return;
    this.signature = signature;
    const previous = this.states;
    if (signature === null) {
      this.states = {};
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err: any) {
        this.log(
          `${file} is not valid JSON (${err?.message || String(err)}); keeping the last good ` +
            'module state',
        );
        return;
      }
      const modules = isRecord(parsed) && isRecord(parsed.modules) ? parsed.modules : {};
      const next: ModuleStates = {};
      for (const [id, value] of Object.entries(modules)) {
        if (typeof value === 'boolean') next[id] = value;
        else this.log(`${file}: modules.${id} is not true or false; using the default (on)`);
      }
      this.states = next;
    }
    const ids = new Set([...Object.keys(previous), ...Object.keys(this.states)]);
    for (const id of ids) {
      if ((previous[id] ?? true) !== (this.states[id] ?? true)) {
        this.emit();
        return;
      }
    }
  }
}

/** The process-wide switch, read from the bridge config file. */
export const moduleSwitch = new ModuleSwitch();
