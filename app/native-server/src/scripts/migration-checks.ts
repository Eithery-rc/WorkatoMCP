/**
 * Doctor checks for what a 1.x (WorkatoMCP) install leaves behind after the
 * move to MokuTab 2.0: the old npm package, a native host manifest pointing
 * into it, a Claude Code registration under the old key, and the data dir
 * (both present, or a move the bridge could not make).
 *
 * Read-only: each check reads files and says what to run; none changes
 * anything. Inputs are passed in, so the checks run against fixtures.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DoctorCheckResult } from './doctor';
import { DATA_DIR_ENV, homeDataDirs, type DataDirMoveFailure } from '../data-dir';
import { readEnv } from '../env';

/** The 1.x npm package (and its command). */
export const OLD_PACKAGE = 'workatomcp-bridge';
/** The 1.x key in a Claude Code MCP registration. */
export const OLD_REGISTRATION_KEY = 'workato';
export const REGISTRATION_KEY = 'mokutab';
const BRIDGE_URL = 'http://127.0.0.1:12306/mcp';
export const REGISTER_COMMAND = `claude mcp add --transport http -s user ${REGISTRATION_KEY} ${BRIDGE_URL}`;

export interface CheckOutcome {
  check: DoctorCheckResult;
  nextSteps: string[];
}

// ---------------------------------------------------------------------------
// The old npm package
// ---------------------------------------------------------------------------

/** `npm root -g`, or null when npm is not there or does not answer. */
export function npmGlobalRoot(): string | null {
  try {
    // Through a shell: npm is a .cmd on Windows, which Node starts no other way.
    // A constant string, so nothing is spliced into it.
    const out = execSync('npm root -g', {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Global node_modules dirs to look in: the one this package is installed in
 * (<root>/@mokuhub/mokutab-bridge), and npm's.
 */
export function globalModuleRoots(
  packageRoot: string,
  npmRoot: () => string | null = npmGlobalRoot,
): string[] {
  const roots = new Set<string>();
  const scope = path.dirname(packageRoot);
  if (
    path.basename(scope) === '@mokuhub' &&
    path.basename(path.dirname(scope)) === 'node_modules'
  ) {
    roots.add(path.dirname(scope));
  }
  const fromNpm = npmRoot();
  if (fromNpm) roots.add(fromNpm);
  return [...roots];
}

export function oldPackageCheck(roots: readonly string[]): CheckOutcome {
  const found: string[] = [];
  for (const root of roots) {
    const manifest = path.join(root, OLD_PACKAGE, 'package.json');
    try {
      const version = JSON.parse(fs.readFileSync(manifest, 'utf8'))?.version;
      found.push(`${OLD_PACKAGE}@${version ?? '?'} in ${path.dirname(manifest)}`);
    } catch {
      // Not installed there.
    }
  }
  const base = { id: 'migration.old_package', title: 'Old package' };
  if (found.length === 0) {
    return {
      check: {
        ...base,
        status: 'ok',
        message: `${OLD_PACKAGE} is not installed globally`,
        details: { searched: roots },
      },
      nextSteps: [],
    };
  }
  const fix = `npm uninstall -g ${OLD_PACKAGE}`;
  return {
    check: {
      ...base,
      status: 'warn',
      message:
        `${found.join('; ')} is still installed: the 1.x bridge. Its ${OLD_PACKAGE} command ` +
        'runs the old code (a register from it points the native host back at it), and npm ' +
        'will not install @mokuhub/mokutab-bridge over its command names.',
      details: { found, fix: [fix] },
    },
    nextSteps: [fix],
  };
}

// ---------------------------------------------------------------------------
// The native host manifest
// ---------------------------------------------------------------------------

/** Whether a path runs through the old package's directory. */
function inOldPackage(target: string): boolean {
  return target.split(/[\\/]+/).some((segment) => segment.toLowerCase() === OLD_PACKAGE);
}

/**
 * What is wrong with the wrapper path a native host manifest names, beyond
 * "not this install's wrapper": it is gone (the package it pointed into was
 * uninstalled or moved), or it is the old 1.x package.
 */
export function manifestTargetIssues(
  target: string,
  exists: (file: string) => boolean = fs.existsSync,
): string[] {
  const issues: string[] = [];
  if (!exists(target)) {
    issues.push('path target does not exist (the package it pointed into was removed or moved)');
  }
  if (inOldPackage(target)) issues.push(`path points into the old ${OLD_PACKAGE} package`);
  return issues;
}

// ---------------------------------------------------------------------------
// The Claude Code registration
// ---------------------------------------------------------------------------

/** ~/.claude.json, or CLAUDE_CONFIG_DIR/.claude.json when that is set. */
export function claudeConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  const dir = env.CLAUDE_CONFIG_DIR?.trim();
  return path.join(dir ? dir : home, '.claude.json');
}

/** A registration that reaches this bridge: its URL, or a stdio proxy of it. */
function pointsAtBridge(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const text = JSON.stringify(entry);
  return (
    /(127\.0\.0\.1|localhost):12306\b/.test(text) || /(workatomcp|mcp-chrome)-stdio/.test(text)
  );
}

interface Registration {
  key: string;
  scope: 'user' | 'local';
  /** The project directory of a local registration. */
  project?: string;
}

const scopeLabel = (entry: Registration): string =>
  entry.project ? `local (${entry.project})` : entry.scope;

function registrationsIn(config: any): Registration[] {
  const out: Registration[] = [];
  const scan = (servers: unknown, scope: Registration['scope'], project?: string) => {
    if (!servers || typeof servers !== 'object') return;
    for (const [key, entry] of Object.entries(servers as Record<string, unknown>)) {
      if (pointsAtBridge(entry)) out.push({ key, scope, ...(project ? { project } : {}) });
    }
  };
  scan(config?.mcpServers, 'user');
  if (config?.projects && typeof config.projects === 'object') {
    for (const [project, settings] of Object.entries(config.projects as Record<string, any>)) {
      scan(settings?.mcpServers, 'local', project);
    }
  }
  return out;
}

/**
 * Whether Claude Code still reaches this bridge under the 1.x key, from the
 * text of its config (null when there is none). Only registrations that
 * point at this bridge count: a `workato` server elsewhere is somebody
 * else's. Reports keys and scopes, never the entries.
 */
export function claudeRegistrationCheck(configText: string | null, file: string): CheckOutcome {
  const base = { id: 'migration.claude_registration', title: 'Claude Code registration' };
  if (configText === null) {
    return {
      check: { ...base, status: 'ok', message: `no Claude Code config at ${file}` },
      nextSteps: [],
    };
  }
  let config: unknown;
  try {
    config = JSON.parse(configText);
  } catch (err: any) {
    return {
      check: {
        ...base,
        status: 'warn',
        message: `${file} is not valid JSON (${err?.message || String(err)}); not checked`,
      },
      nextSteps: [],
    };
  }
  const found = registrationsIn(config);
  const old = found.filter((entry) => entry.key === OLD_REGISTRATION_KEY);
  const current = found.filter((entry) => entry.key === REGISTRATION_KEY);
  const registrations = found.map((entry) => ({ key: entry.key, scope: scopeLabel(entry) }));
  if (old.length === 0) {
    return {
      check: {
        ...base,
        status: 'ok',
        message:
          current.length > 0
            ? `registered as ${REGISTRATION_KEY} (${current.map(scopeLabel).join(', ')})`
            : `no Claude Code registration points at this bridge (register: ${REGISTER_COMMAND})`,
        details: { registrations },
      },
      nextSteps: [],
    };
  }
  const steps = [
    ...(current.some((entry) => entry.scope === 'user') ? [] : [REGISTER_COMMAND]),
    ...old.map((entry) =>
      entry.project
        ? `claude mcp remove ${OLD_REGISTRATION_KEY} -s local (run in ${entry.project})`
        : `claude mcp remove ${OLD_REGISTRATION_KEY} -s user`,
    ),
  ];
  return {
    check: {
      ...base,
      status: 'warn',
      message:
        `Claude Code still registers this bridge as "${OLD_REGISTRATION_KEY}" ` +
        `(${old.map(scopeLabel).join(', ')}), so its tools read mcp__${OLD_REGISTRATION_KEY}__*. ` +
        `It keeps working; the 2.0 key is "${REGISTRATION_KEY}".`,
      details: { registrations, fix: [...steps, 'then restart the Claude Code sessions'] },
    },
    nextSteps: steps,
  };
}

// ---------------------------------------------------------------------------
// The data dir
// ---------------------------------------------------------------------------

export interface DataDirState {
  /** An override (MOKUTAB_DATA_DIR or WORKATOMCP_DATA_DIR) in use, or null. */
  override: string | null;
  current: string;
  legacy: string;
  currentExists: boolean;
  legacyExists: boolean;
  /** The failed move the bridge recorded, if any. */
  failure: DataDirMoveFailure | null;
}

export function readDataDirState(
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
  failure: DataDirMoveFailure | null = null,
): DataDirState {
  const { current, legacy } = homeDataDirs(home);
  const override = readEnv(DATA_DIR_ENV, env);
  return {
    override: override ? path.resolve(override.trim()) : null,
    current,
    legacy,
    currentExists: fs.existsSync(current),
    legacyExists: fs.existsSync(legacy),
    failure,
  };
}

function moveCommand(from: string, to: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `move "${from}" "${to}"` : `mv "${from}" "${to}"`;
}

export function dataDirCheck(
  state: DataDirState,
  platform: NodeJS.Platform = process.platform,
): CheckOutcome {
  const base = { id: 'migration.data_dir', title: 'Data dir' };
  const details = { current: state.current, legacy: state.legacy };
  if (state.override) {
    return {
      check: { ...base, status: 'ok', message: `${state.override} (set by ${DATA_DIR_ENV})` },
      nextSteps: [],
    };
  }
  if (state.currentExists && state.legacyExists) {
    return {
      check: {
        ...base,
        status: 'warn',
        message:
          `both ${state.current} and ${state.legacy} exist; the bridge uses ${state.current} and ` +
          `leaves ${state.legacy} alone. Copy over anything still needed from it (a function ` +
          'committed by hand), then delete it.',
        details,
      },
      nextSteps: [],
    };
  }
  if (state.legacyExists) {
    const fix = [
      'close what holds it open (an editor, a terminal or Explorer window in it, a git process), ' +
        'then reload the extension or restart Chrome: the bridge moves it on start',
      `or, with Chrome closed: ${moveCommand(state.legacy, state.current, platform)}`,
    ];
    return {
      check: {
        ...base,
        status: 'warn',
        message: state.failure
          ? `the bridge could not move ${state.legacy} to ${state.current} ` +
            `(${state.failure.error}, ${state.failure.at}); it keeps using ${state.legacy}`
          : `${state.legacy} has not moved to ${state.current} yet; the bridge moves it ` +
            'on its next start (reload the extension or restart Chrome)',
        details: { ...details, failure: state.failure, fix },
      },
      nextSteps: state.failure ? [fix[0]] : [],
    };
  }
  return {
    check: {
      ...base,
      status: 'ok',
      message: state.currentExists ? state.current : `${state.current} (created on first use)`,
      details,
    },
    nextSteps: [],
  };
}
