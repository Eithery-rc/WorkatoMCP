/**
 * Bridge self-update: detection half.
 *
 * The live bridge polls the npm registry (same-major versions only) and, when
 * a newer version exists, drops an update-pending.json flag into the state
 * directory it shares with apply-update.cjs. Application happens there: the
 * run_host wrapper scripts execute apply-update.cjs BEFORE the node host
 * starts, when nothing locks the package directory, so `npm install -g` can
 * replace it safely (a running bridge holds locks that make the same install
 * fail with EBUSY on Windows).
 *
 * To close the loop without user action, the checker also restarts the host
 * once an update is pending and the MCP surface has been idle long enough:
 * exiting cleanly makes the extension's reconnect logic respawn the host via
 * the wrapper, which applies the update, and the new version comes up in its
 * place. Repeated apply failures (attempts >= MAX_APPLY_ATTEMPTS, tracked in
 * the flag by apply-update.cjs) stop the restart loop.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const LOG_PREFIX = '[UpdateChecker]';
const PACKAGE_NAME = 'workatomcp-bridge';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

const INITIAL_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const REGISTRY_TIMEOUT_MS = 5_000;
const IDLE_POLL_INTERVAL_MS = 60_000;
const IDLE_RESTART_AFTER_MS = 10 * 60_000;
const MIN_UPTIME_BEFORE_RESTART_MS = 5 * 60_000;
export const MAX_APPLY_ATTEMPTS = 3;

export interface UpdateFlag {
  version: string;
  detected_at: string;
  attempts?: number;
  last_attempt_at?: string;
  last_error?: string;
}

const startedAt = Date.now();
let lastActivityAt = Date.now();
let restartLoopWarned = false;

/** Stamp MCP/HTTP activity; the idle restart only fires when this goes quiet. */
export function markMcpActivity(): void {
  lastActivityAt = Date.now();
}

/**
 * State dir shared with apply-update.cjs (keep both implementations in sync).
 * Mirrors the wrapper scripts' log-dir bases so everything lives in one place.
 * WORKATOMCP_UPDATE_STATE_DIR overrides for tests.
 */
export function updateStateDir(): string {
  const override = process.env.WORKATOMCP_UPDATE_STATE_DIR;
  if (override) return override;
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'mcp-chrome-bridge');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Logs', 'mcp-chrome-bridge');
  }
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'mcp-chrome-bridge');
}

export function updateFlagPath(): string {
  return path.join(updateStateDir(), 'update-pending.json');
}

export function parseVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when candidate is a newer version within the SAME major as current. */
export function isNewerSameMajor(candidate: unknown, current: unknown): boolean {
  const c = parseVersion(candidate);
  const cur = parseVersion(current);
  if (!c || !cur) return false;
  if (c[0] !== cur[0]) return false;
  if (c[1] !== cur[1]) return c[1] > cur[1];
  return c[2] > cur[2];
}

export function readFlag(): UpdateFlag | null {
  try {
    const raw = fs.readFileSync(updateFlagPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parseVersion(parsed.version)) return null;
    return parsed as UpdateFlag;
  } catch {
    return null;
  }
}

export function writeFlag(flag: UpdateFlag): void {
  const dir = updateStateDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(updateFlagPath(), JSON.stringify(flag, null, 2), 'utf8');
}

function deleteFlag(): void {
  try {
    fs.unlinkSync(updateFlagPath());
  } catch {
    /* already gone */
  }
}

function readOwnVersion(): string | null {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
    const version = JSON.parse(raw)?.version;
    return parseVersion(version) ? version : null;
  } catch {
    return null;
  }
}

async function checkOnce(currentVersion: string): Promise<void> {
  let latest: string | undefined;
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return;
    latest = (await res.json())?.version;
  } catch {
    return; // offline / registry down: try again next interval
  }
  if (!isNewerSameMajor(latest, currentVersion)) return;

  const existing = readFlag();
  if (existing && existing.version === latest) return; // already flagged
  writeFlag({ version: latest as string, detected_at: new Date().toISOString() });
  console.error(
    `${LOG_PREFIX} ${PACKAGE_NAME} ${latest} available (running ${currentVersion}); ` +
      'flagged for install on next host spawn',
  );
}

function maybeRestartToApply(currentVersion: string, requestRestart: () => void): void {
  const flag = readFlag();
  if (!flag) return;
  if (!isNewerSameMajor(flag.version, currentVersion)) {
    deleteFlag(); // applied already, or stale/foreign flag
    return;
  }
  if ((flag.attempts ?? 0) >= MAX_APPLY_ATTEMPTS) {
    if (!restartLoopWarned) {
      restartLoopWarned = true;
      console.error(
        `${LOG_PREFIX} update to ${flag.version} failed ${flag.attempts} times; ` +
          `giving up on auto-apply. See update.log in ${updateStateDir()}. ` +
          `Manual fix: npm i -g ${PACKAGE_NAME}@latest`,
      );
    }
    return;
  }
  const now = Date.now();
  if (now - startedAt < MIN_UPTIME_BEFORE_RESTART_MS) return;
  if (now - lastActivityAt < IDLE_RESTART_AFTER_MS) return;
  console.error(
    `${LOG_PREFIX} idle with ${flag.version} pending; restarting host to apply ` +
      `(running ${currentVersion})`,
  );
  requestRestart();
}

/**
 * Start the background version check and the idle-restart watcher.
 * requestRestart must shut the host down cleanly and exit(0); the extension's
 * reconnect logic respawns it through the wrapper, which applies the update.
 */
export function startUpdateChecker(requestRestart: () => void): void {
  const currentVersion = readOwnVersion();
  if (!currentVersion) {
    console.error(`${LOG_PREFIX} could not read own version; self-update disabled`);
    return;
  }
  setTimeout(() => void checkOnce(currentVersion), INITIAL_CHECK_DELAY_MS).unref();
  setInterval(() => void checkOnce(currentVersion), CHECK_INTERVAL_MS).unref();
  setInterval(
    () => maybeRestartToApply(currentVersion, requestRestart),
    IDLE_POLL_INTERVAL_MS,
  ).unref();
}
