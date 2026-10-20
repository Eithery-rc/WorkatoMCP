/**
 * Browser functions: the registry on disk.
 *
 * One YAML file per function in a private git repository (default
 * ~/.mokutab/functions, override MOKUTAB_FN_DIR): `centium.case.read`
 * lives in `centium/case.read.yaml`, helper `_helpers.netsuite` in
 * `_helpers/netsuite.yaml`. Every save is a commit whose subject carries the
 * version, so git is the version history: diffs, blame and rollback come from
 * it, and a person can read and edit the files directly.
 *
 * Saves are optimistic: the caller names the version it built on and a save
 * on top of a newer one is refused. A file with uncommitted edits is never
 * overwritten (someone is editing it by hand).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import YAML from 'yaml';
import {
  HELPER_PREFIX,
  isFunctionName,
  isHelperName,
  validateDefinition,
  validateHelper,
  type FnDefinition,
  type HelperDefinition,
} from './fn-definition';
import { dataDir } from '../data-dir';
import { readEnv } from '../env';

export const FN_DIR_ENV = 'MOKUTAB_FN_DIR';
const LOCK_FILE = '.fn-save.lock';
const LOCK_STALE_MS = 60_000;
const LOCK_WAIT_MS = 10_000;
const GIT_USER = 'workatomcp';
const GIT_IDENTITY = ['-c', `user.name=${GIT_USER}`, '-c', 'user.email=workatomcp@localhost'];

export function defaultRegistryDir(): string {
  const override = readEnv(FN_DIR_ENV);
  return override ? path.resolve(override.trim()) : path.join(dataDir(), 'functions');
}

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

/**
 * Every registry git call runs without hooks and without fsmonitor: the
 * bridge only ever needs plain status, log, show, add and commit, and a
 * repository config must not make those run anything else.
 */
const SAFE_GIT = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  `core.hooksPath=${path.join(os.tmpdir(), `mokutab-no-hooks-${process.pid}`)}`,
];

export const execGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      [...SAFE_GIT, ...args],
      { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          reject(
            new Error(
              code === 'ENOENT'
                ? 'git was not found on PATH; the function registry needs git for its history'
                : `git ${args[0]} failed: ${(stderr || error.message).toString().trim()}`,
            ),
          );
        } else {
          resolve(stdout.toString());
        }
      },
    );
  });

export interface RegistryEntry {
  name: string;
  file: string;
  definition?: FnDefinition | HelperDefinition;
  /** The file could not be read or parsed. */
  error?: string;
}

export interface HistoryEntry {
  version: number | null;
  sha: string;
  date: string;
  subject: string;
  saved_by?: string;
}

export interface SaveOptions {
  base_version?: number;
  changelog: string;
  caller?: string;
}

export interface SaveResult {
  name: string;
  version: number;
  previous_version: number | null;
  sha: string;
  file: string;
}

const HEADER =
  '# MokuTab browser function. Saved by chrome_fn_save; each save is a git commit.\n' +
  '# Editing by hand is fine: bump `version`, then commit, or the next save refuses.\n';

const KEY_ORDER = [
  'name',
  'description',
  'tags',
  'kind',
  'version',
  'params',
  'target',
  'helpers',
  'vault',
  'steps',
  'preview',
  'result',
  'dedupe_key',
  'verify_hint',
  'notes',
  'code',
];

function ordered(def: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KEY_ORDER) if (def[key] !== undefined) out[key] = def[key];
  for (const [key, value] of Object.entries(def)) if (!(key in out)) out[key] = value;
  return out;
}

export function toYaml(def: FnDefinition | HelperDefinition): string {
  return HEADER + YAML.stringify(ordered(def as any), { lineWidth: 0, blockQuote: 'literal' });
}

export function parseYaml(text: string): unknown {
  return YAML.parse(text);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FnRegistry {
  // Saves of this process run one at a time; the lock file covers another process.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly dir: string = defaultRegistryDir(),
    private readonly git: GitRunner = execGit,
  ) {}

  /** `centium.case.read` -> `<dir>/centium/case.read.yaml`. Only valid names map to a path. */
  fileFor(name: string): string {
    if (!isFunctionName(name) && !isHelperName(name)) {
      throw new Error(`"${name}" is not a function name (dotted lower-case words)`);
    }
    const [head, ...rest] = name.split('.');
    return path.join(this.dir, head, `${rest.join('.')}.yaml`);
  }

  private rel(file: string): string {
    return path.relative(this.dir, file).split(path.sep).join('/');
  }

  private nameFor(file: string): string | null {
    const rel = this.rel(file);
    const parts = rel.split('/');
    if (parts.length !== 2 || !parts[1].endsWith('.yaml')) return null;
    return `${parts[0]}.${parts[1].slice(0, -'.yaml'.length)}`;
  }

  /** Every function and helper file, parsed. Broken files are listed with their error. */
  list(): RegistryEntry[] {
    if (!fs.existsSync(this.dir)) return [];
    const entries: RegistryEntry[] = [];
    for (const ns of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!ns.isDirectory() || ns.name.startsWith('.')) continue;
      const nsDir = path.join(this.dir, ns.name);
      for (const file of fs.readdirSync(nsDir, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith('.yaml')) continue;
        const full = path.join(nsDir, file.name);
        const name = this.nameFor(full);
        if (!name) continue;
        entries.push(this.readEntry(name, full));
      }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  private readEntry(name: string, file: string): RegistryEntry {
    try {
      const parsed = parseYaml(fs.readFileSync(file, 'utf8')) as any;
      if (!parsed || typeof parsed !== 'object')
        return { name, file, error: 'empty or not a mapping' };
      if (parsed.name !== name) {
        return { name, file, error: `the file says name "${parsed.name}"; it must be "${name}"` };
      }
      return { name, file, definition: parsed };
    } catch (err: any) {
      return { name, file, error: `YAML: ${err?.message || String(err)}` };
    }
  }

  get(name: string): RegistryEntry | null {
    const file = this.fileFor(name);
    if (!fs.existsSync(file)) return null;
    return this.readEntry(name, file);
  }

  /** Helper code in the order asked for; a missing helper is an error. */
  helpers(names: string[]): Array<{ name: string; code: string }> {
    return names.map((short) => {
      const entry = this.get(`${HELPER_PREFIX}${short}`);
      const code = (entry?.definition as HelperDefinition | undefined)?.code;
      if (!entry || entry.error || typeof code !== 'string') {
        throw new Error(
          `helper "${short}" is missing or broken${entry?.error ? ` (${entry.error})` : ''}`,
        );
      }
      return { name: short, code };
    });
  }

  private async ensureRepo(): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    if (fs.existsSync(path.join(this.dir, '.git'))) return;
    await this.git(['init', '-q'], this.dir);
    fs.writeFileSync(path.join(this.dir, '.gitignore'), `${LOCK_FILE}\n`);
    fs.writeFileSync(
      path.join(this.dir, 'README.md'),
      '# Browser functions\n\nMokuTab `chrome_fn_*` registry: one YAML file per function, ' +
        'helpers under `_helpers/`. Every save through chrome_fn_save is a commit; the subject ' +
        'is `<name> v<version>: <changelog>`.\n',
    );
    await this.git(['add', '.gitignore', 'README.md'], this.dir);
    await this.git(
      [...GIT_IDENTITY, 'commit', '-q', '-m', 'Initialize the function registry'],
      this.dir,
    );
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      fs.mkdirSync(this.dir, { recursive: true });
      const lock = path.join(this.dir, LOCK_FILE);
      const started = Date.now();
      for (;;) {
        try {
          fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
          break;
        } catch (err: any) {
          // Only an existing lock is contention; anything else (EACCES, ENOSPC) is an error.
          if (err?.code !== 'EEXIST') throw err;
          try {
            if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
              fs.rmSync(lock, { force: true });
            }
          } catch {
            // Released (or being deleted) between the two calls: try again after the pause.
          }
          if (Date.now() - started > LOCK_WAIT_MS) {
            throw new Error('another save holds the registry lock; try again');
          }
          await sleep(100);
        }
      }
      try {
        return await work();
      } finally {
        fs.rmSync(lock, { force: true });
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Uncommitted or untracked state of one file ('' when clean). */
  private async fileStatus(file: string): Promise<string> {
    return (await this.git(['status', '--porcelain', '--', this.rel(file)], this.dir)).trim();
  }

  /**
   * Save a function or helper as the next version. `base_version` must be the
   * current version when the name exists (omit it for a new name).
   */
  async save(input: FnDefinition | HelperDefinition, opts: SaveOptions): Promise<SaveResult> {
    const name = (input as any)?.name;
    const errors = isHelperName(String(name)) ? validateHelper(input) : validateDefinition(input);
    if (errors.length)
      throw new SaveRefused(`the definition has problems:\n- ${errors.join('\n- ')}`);
    const changelog = (opts.changelog || '').trim().replace(/\s+/g, ' ');
    if (!changelog) throw new SaveRefused('changelog is required: say what changed and why');
    if ((input as FnDefinition).vault !== undefined) {
      throw new SaveRefused(
        `functions that type vault values are never saved by chrome_fn_save. Write ` +
          `${this.fileFor(name)} by hand (bump version) and commit it yourself ` +
          `(git -C "${this.dir}" commit); only a person-made commit lets it run.`,
      );
    }

    // Initialized under the lock: two first saves at once must not both run git init.
    return this.withLock(async () => {
      await this.ensureRepo();
      const file = this.fileFor(name);
      let previous: number | null = null;
      if (fs.existsSync(file)) {
        const status = await this.fileStatus(file);
        if (status) {
          throw new SaveRefused(
            `${this.rel(file)} has changes that are not committed (${status}). Commit or discard ` +
              'them first, then save on top of that version.',
          );
        }
        const current = this.readEntry(name, file);
        if ((current.definition as any)?.vault !== undefined) {
          throw new SaveRefused(
            `"${name}" types vault values and is maintained by hand; chrome_fn_save does not replace it. ` +
              `Edit ${file} and commit it yourself.`,
          );
        }
        const version = (current.definition as any)?.version;
        previous = typeof version === 'number' ? version : 0;
        if (opts.base_version !== previous) {
          throw new SaveRefused(
            `"${name}" is at version ${previous}; this save was built on ` +
              `${opts.base_version === undefined ? 'nothing (base_version missing)' : `version ${opts.base_version}`}. ` +
              'Read it again with chrome_fn_get, apply the change on top, and pass base_version.',
          );
        }
      } else if (opts.base_version !== undefined && opts.base_version !== 0) {
        throw new SaveRefused(`"${name}" does not exist yet; omit base_version to create it.`);
      }

      const version = (previous ?? 0) + 1;
      const def = { ...(input as any), version };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, toYaml(def));
      fs.renameSync(tmp, file);
      const caller = (opts.caller || '').trim().replace(/[\r\n]+/g, ' ');
      const message = `${name} v${version}: ${changelog}${caller ? `\n\nSaved-By: ${caller}` : ''}`;
      try {
        await this.git(['add', '--', this.rel(file)], this.dir);
        await this.git(
          [...GIT_IDENTITY, 'commit', '-q', '-m', message, '--', this.rel(file)],
          this.dir,
        );
      } catch (err) {
        // Leave the tree as it was: the save did not happen.
        if (previous === null) {
          await this.git(['rm', '-q', '--cached', '--', this.rel(file)], this.dir).catch(() => '');
          fs.rmSync(file, { force: true });
        } else {
          await this.git(['checkout', 'HEAD', '--', this.rel(file)], this.dir).catch(() => '');
        }
        throw err;
      }
      const sha = (await this.git(['rev-parse', 'HEAD'], this.dir)).trim();
      return { name, version, previous_version: previous, sha, file };
    });
  }

  /** Commits that touched the function, newest first. */
  async history(name: string): Promise<HistoryEntry[]> {
    const file = this.fileFor(name);
    if (!fs.existsSync(path.join(this.dir, '.git'))) return [];
    const raw = await this.git(
      ['log', '--format=%H%x1f%aI%x1f%s%x1f%b%x1e', '--', this.rel(file)],
      this.dir,
    );
    const out: HistoryEntry[] = [];
    for (const record of raw.split('\x1e')) {
      const [sha, date, subject, body] = record.replace(/^\s+/, '').split('\x1f');
      if (!sha || !subject) continue;
      const match = / v(\d+): /.exec(subject);
      const savedBy = /^Saved-By: (.+)$/m.exec(body || '');
      out.push({
        version: match ? Number(match[1]) : null,
        sha,
        date,
        subject,
        ...(savedBy ? { saved_by: savedBy[1].trim() } : {}),
      });
    }
    return out;
  }

  /** The definition as saved at `version`. */
  async getVersion(name: string, version: number): Promise<FnDefinition | HelperDefinition> {
    const current = this.get(name);
    if (current?.definition && (current.definition as any).version === version) {
      return current.definition;
    }
    const rel = this.rel(this.fileFor(name));
    for (const entry of await this.history(name)) {
      if (entry.version !== null && entry.version !== version) continue;
      let text: string;
      try {
        text = await this.git(['show', `${entry.sha}:${rel}`], this.dir);
      } catch {
        continue;
      }
      const parsed = parseYaml(text) as any;
      if (parsed?.version === version) return parsed;
    }
    throw new Error(`"${name}" has no version ${version}`);
  }

  /** Whether the file is committed exactly as it is on disk. */
  async isClean(name: string): Promise<boolean> {
    const file = this.fileFor(name);
    if (!fs.existsSync(file) || !fs.existsSync(path.join(this.dir, '.git'))) return false;
    return (await this.fileStatus(file)) === '';
  }

  /**
   * Null when the file on disk is exactly what a person committed (not a
   * chrome_fn_save commit), else why not. A function that reads the vault
   * runs only then: an agent with MCP tools alone can write a file (an
   * out_file) but cannot commit one.
   */
  async handCommitted(name: string): Promise<string | null> {
    if (!(await this.isClean(name))) {
      return `${this.rel(this.fileFor(name))} is not committed exactly as it is on disk`;
    }
    const last = (
      await this.git(
        ['log', '-1', '--format=%an%x1f%cn', '--', this.rel(this.fileFor(name))],
        this.dir,
      )
    ).trim();
    const [author, committer] = last.split('\x1f');
    if (!last || author === GIT_USER || committer === GIT_USER) {
      return `its last commit was made by chrome_fn_save, not by a person`;
    }
    return null;
  }
}

/** A save the registry refused for a reason the caller can fix. */
export class SaveRefused extends Error {}
