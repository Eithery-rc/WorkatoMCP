#!/usr/bin/env node
/**
 * Bridge self-update: application half.
 *
 * run_host.bat / run_host.sh execute this BEFORE launching the node host, when
 * nothing locks the package directory, so `npm install -g` can replace the
 * running install safely. Detection lives in update-checker.ts, which drops
 * the update-pending.json flag this script consumes; keep the state-dir logic
 * in the two files in sync.
 *
 * Deliberately self-contained (no requires from dist): npm replaces the whole
 * package mid-run, and this file must not depend on anything it deletes. It is
 * fully loaded into memory before the install starts, always exits 0, and
 * never blocks the host launch: any failure is recorded in the flag
 * (attempts / last_error) and in <stateDir>/update.log, and the wrapper
 * carries on starting the existing version.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKAGE_NAME = 'workatomcp-bridge';
const MAX_APPLY_ATTEMPTS = 3;
const ATTEMPT_BACKOFF_MS = 15 * 60_000;
const FLAG_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const LOCK_STALE_MS = 15 * 60_000;
const INSTALL_TIMEOUT_MS = 180_000;
const LOG_MAX_BYTES = 256 * 1024;

/** Must mirror updateStateDir() in update-checker.ts. */
function stateDir() {
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

const FLAG_PATH = path.join(stateDir(), 'update-pending.json');
const LOCK_PATH = path.join(stateDir(), 'update.lock');
const LOG_PATH = path.join(stateDir(), 'update.log');

function log(message) {
  const line = `${new Date().toISOString()} [apply-update] ${message}\n`;
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    try {
      if (fs.statSync(LOG_PATH).size > LOG_MAX_BYTES) {
        fs.renameSync(LOG_PATH, `${LOG_PATH}.1`);
      }
    } catch {
      /* no log yet */
    }
    fs.appendFileSync(LOG_PATH, line);
  } catch {
    /* logging must never break the launch */
  }
  // Also surface in the wrapper log (stdout is redirected there).
  process.stdout.write(line);
}

function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewerSameMajor(candidate, current) {
  const c = parseVersion(candidate);
  const cur = parseVersion(current);
  if (!c || !cur) return false;
  if (c[0] !== cur[0]) return false;
  if (c[1] !== cur[1]) return c[1] > cur[1];
  return c[2] > cur[2];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function deleteFlag() {
  try {
    fs.unlinkSync(FLAG_PATH);
  } catch {
    /* already gone */
  }
}

function recordFailure(flag, error) {
  try {
    flag.attempts = (flag.attempts || 0) + 1;
    flag.last_attempt_at = new Date().toISOString();
    flag.last_error = String(error).slice(0, 512);
    fs.writeFileSync(FLAG_PATH, JSON.stringify(flag, null, 2), 'utf8');
  } catch {
    /* best effort */
  }
}

function acquireLock() {
  try {
    fs.mkdirSync(LOCK_PATH);
    return true;
  } catch {
    try {
      const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
      if (age > LOCK_STALE_MS) {
        fs.rmdirSync(LOCK_PATH);
        fs.mkdirSync(LOCK_PATH);
        return true;
      }
    } catch {
      /* fall through */
    }
    return false;
  }
}

function releaseLock() {
  try {
    fs.rmdirSync(LOCK_PATH);
  } catch {
    /* best effort */
  }
}

/** Build the npm invocation: prefer npm-cli.js next to node (no shell quirks). */
function npmInvocation(installArgs) {
  const nodeDir = path.dirname(process.execPath);
  const npmCli = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(npmCli)) {
    return { command: process.execPath, args: [npmCli, ...installArgs], shell: false };
  }
  const npmBin = path.join(nodeDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  if (fs.existsSync(npmBin)) {
    return { command: npmBin, args: installArgs, shell: process.platform === 'win32' };
  }
  return { command: 'npm', args: installArgs, shell: true };
}

function main() {
  const flag = readJson(FLAG_PATH);
  if (!flag) return; // nothing pending: the common fast path

  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const currentVersion = readJson(packageJsonPath)?.version;
  const target = flag.version;

  if (!parseVersion(target) || !isNewerSameMajor(target, currentVersion)) {
    log(`flag version ${target} vs current ${currentVersion}: nothing to do, clearing flag`);
    deleteFlag();
    return;
  }
  if (flag.detected_at && Date.now() - Date.parse(flag.detected_at) > FLAG_MAX_AGE_MS) {
    log(`flag for ${target} is stale (detected ${flag.detected_at}), clearing`);
    deleteFlag();
    return;
  }
  if ((flag.attempts || 0) >= MAX_APPLY_ATTEMPTS) {
    log(`update to ${target} already failed ${flag.attempts} times, skipping (manual fix needed)`);
    return;
  }
  if (flag.last_attempt_at && Date.now() - Date.parse(flag.last_attempt_at) < ATTEMPT_BACKOFF_MS) {
    log(`last attempt at ${flag.last_attempt_at} was recent, backing off`);
    return;
  }
  if (!acquireLock()) {
    log('another update is in progress, skipping');
    return;
  }

  try {
    const { command, args, shell } = npmInvocation([
      'install',
      '-g',
      `${PACKAGE_NAME}@${target}`,
      '--no-audit',
      '--no-fund',
      '--loglevel=warn',
    ]);
    log(`installing ${PACKAGE_NAME}@${target} (current ${currentVersion}) via ${command}`);
    const result = spawnSync(command, args, {
      shell,
      cwd: os.tmpdir(),
      timeout: INSTALL_TIMEOUT_MS,
      encoding: 'utf8',
      windowsHide: true,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    if (result.status !== 0) {
      const reason = result.error
        ? String(result.error)
        : `npm exited ${result.status}: ${output.slice(-512)}`;
      log(`install failed: ${reason}`);
      recordFailure(flag, reason);
      return;
    }
    // Verify what actually landed on disk before declaring success.
    const installedVersion = readJson(packageJsonPath)?.version;
    if (installedVersion === target) {
      log(`installed ${PACKAGE_NAME}@${target}`);
      deleteFlag();
    } else {
      const reason = `npm exited 0 but package.json reports ${installedVersion}`;
      log(reason);
      recordFailure(flag, reason);
    }
  } catch (err) {
    log(`unexpected error: ${err && err.stack ? err.stack : err}`);
    recordFailure(flag, err);
  } finally {
    releaseLock();
  }
}

try {
  main();
} catch (err) {
  try {
    log(`fatal: ${err && err.stack ? err.stack : err}`);
  } catch {
    /* nothing left to do */
  }
}
process.exitCode = 0;
