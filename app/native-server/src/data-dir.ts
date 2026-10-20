/**
 * The bridge's per-machine data directory (~/.mokutab): the function
 * registry (a git repository) and config.json (the module switch). One
 * helper, so every process resolves it the same way.
 *
 * 1.x kept it in ~/.workatomcp. The bridge renames that directory on its
 * first 2.x start (migrateDataDir, run once from index.ts, before anything
 * reads the data). One rename on one volume: it either happens whole or not
 * at all, so no process ever sees half of the data. Until it has happened
 * (the bridge has not started since the upgrade, or the rename failed
 * because something held the directory open), every process keeps reading
 * ~/.workatomcp, and doctor says why.
 *
 * MOKUTAB_DATA_DIR (or the WORKATOMCP_DATA_DIR it replaced) overrides it.
 * An override is used as is and never moved (the test setup points it at a
 * temp dir, so a test never reads the machine's real config).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readEnv } from './env';
import { updateStateDir } from './update-checker';

export const DATA_DIR_ENV = 'MOKUTAB_DATA_DIR';
export const DATA_DIR_NAME = '.mokutab';
/** The 1.x data dir, moved to DATA_DIR_NAME on the first 2.x start. */
export const LEGACY_DATA_DIR_NAME = '.workatomcp';
/** In the bridge state dir while a move has failed, for doctor. */
export const DATA_DIR_MOVE_FAILURE_FILE = 'data-dir-move-failed.json';

export interface DataDirOptions {
  /** Home directory (default os.homedir()). */
  home?: string;
  env?: NodeJS.ProcessEnv;
}

/** The 2.x and the 1.x data dir under a home directory. */
export function homeDataDirs(home: string = os.homedir()): { current: string; legacy: string } {
  return { current: path.join(home, DATA_DIR_NAME), legacy: path.join(home, LEGACY_DATA_DIR_NAME) };
}

function exists(dir: string): boolean {
  return fs.existsSync(dir);
}

export function dataDir(options: DataDirOptions = {}): string {
  const override = readEnv(DATA_DIR_ENV, options.env);
  if (override) return path.resolve(override.trim());
  const { current, legacy } = homeDataDirs(options.home);
  // Not moved yet: the old directory still holds the data.
  return !exists(current) && exists(legacy) ? legacy : current;
}

/** The bridge config file (module switches). */
export function configFile(options: DataDirOptions = {}): string {
  return path.join(dataDir(options), 'config.json');
}

export type DataDirMove =
  /** An override is in use; nothing is moved. */
  | { outcome: 'override'; dir: string }
  /** Neither directory existed: a fresh install. */
  | { outcome: 'fresh'; dir: string }
  /** ~/.mokutab was already there (moved earlier, or by another bridge process just now). */
  | { outcome: 'current'; dir: string; legacyAlsoExists: boolean }
  /** ~/.workatomcp was renamed to ~/.mokutab now. */
  | { outcome: 'moved'; dir: string; from: string }
  /** The rename failed; this run keeps using ~/.workatomcp (`dir`). */
  | { outcome: 'move_failed'; dir: string; to: string; error: string };

export interface MigrateDataDirOptions extends DataDirOptions {
  rename?: (from: string, to: string) => void;
  /** Logs go to stderr: stdout is the native-messaging channel. */
  log?: (message: string) => void;
}

/**
 * Move ~/.workatomcp to ~/.mokutab when only the old one exists. Never
 * copies, never deletes, never throws: a failed rename leaves both paths as
 * they were and the old directory in use.
 */
export function migrateDataDir(options: MigrateDataDirOptions = {}): DataDirMove {
  const log = options.log ?? ((message: string) => console.error(`[data-dir] ${message}`));
  const override = readEnv(DATA_DIR_ENV, options.env);
  if (override) return { outcome: 'override', dir: path.resolve(override.trim()) };
  const { current, legacy } = homeDataDirs(options.home);
  if (exists(current)) {
    const legacyAlsoExists = exists(legacy);
    if (legacyAlsoExists) log(`both ${current} and ${legacy} exist; using ${current}`);
    return { outcome: 'current', dir: current, legacyAlsoExists };
  }
  if (!exists(legacy)) return { outcome: 'fresh', dir: current };
  try {
    (options.rename ?? fs.renameSync)(legacy, current);
    log(`moved ${legacy} to ${current}`);
    return { outcome: 'moved', dir: current, from: legacy };
  } catch (err: any) {
    // Every Chrome profile starts a bridge process: another one may have
    // moved it a moment ago.
    if (exists(current) && !exists(legacy)) {
      return { outcome: 'current', dir: current, legacyAlsoExists: false };
    }
    const message = String(err?.message ?? err);
    // Node's own messages already start with the code ("EPERM: operation not permitted").
    const error = err?.code && !message.startsWith(err.code) ? `${err.code}: ${message}` : message;
    log(
      `could not move ${legacy} to ${current} (${error}); using ${legacy} for this run. ` +
        'Something holds it open (an editor, a shell, a git process); the next start tries again.',
    );
    return { outcome: 'move_failed', dir: legacy, to: current, error };
  }
}

export interface DataDirMoveFailure {
  at: string;
  from: string;
  to: string;
  error: string;
}

/**
 * Keep the last failed move in the bridge state dir for doctor, and drop it
 * once the data is in ~/.mokutab. Best effort: a state dir it cannot write
 * changes nothing else.
 */
export function recordDataDirMove(
  move: DataDirMove,
  stateDir: string = updateStateDir(),
  now: () => Date = () => new Date(),
): void {
  const file = path.join(stateDir, DATA_DIR_MOVE_FAILURE_FILE);
  try {
    if (move.outcome === 'move_failed') {
      const failure: DataDirMoveFailure = {
        at: now().toISOString(),
        from: move.dir,
        to: move.to,
        error: move.error,
      };
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(failure, null, 2) + '\n');
    } else if (move.outcome === 'moved' || move.outcome === 'current') {
      fs.rmSync(file, { force: true });
    }
  } catch {
    // Only doctor reads it.
  }
}

/** The failed move the bridge last recorded, or null. */
export function readDataDirMoveFailure(
  stateDir: string = updateStateDir(),
): DataDirMoveFailure | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(stateDir, DATA_DIR_MOVE_FAILURE_FILE), 'utf8'),
    );
    return parsed && typeof parsed.error === 'string' ? (parsed as DataDirMoveFailure) : null;
  } catch {
    return null;
  }
}
