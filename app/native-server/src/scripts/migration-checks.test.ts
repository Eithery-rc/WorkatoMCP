import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  REGISTER_COMMAND,
  claudeConfigPath,
  claudeRegistrationCheck,
  dataDirCheck,
  globalModuleRoots,
  manifestTargetIssues,
  oldPackageCheck,
  readDataDirState,
  type DataDirState,
} from './migration-checks';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-checks-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

describe('the old workatomcp-bridge package', () => {
  test('found in a global node_modules: warn, with the uninstall to run', () => {
    const root = path.join(tmp, 'node_modules');
    put(path.join(root, 'workatomcp-bridge', 'package.json'), '{"version":"1.13.0"}');
    const outcome = oldPackageCheck([path.join(tmp, 'elsewhere'), root]);
    expect(outcome.check.status).toBe('warn');
    expect(outcome.check.message).toContain('workatomcp-bridge@1.13.0');
    expect(outcome.nextSteps).toEqual(['npm uninstall -g workatomcp-bridge']);
  });

  test('not installed: ok', () => {
    const outcome = oldPackageCheck([path.join(tmp, 'node_modules')]);
    expect(outcome.check.status).toBe('ok');
    expect(outcome.nextSteps).toEqual([]);
  });

  test('looks next to this install and in npm root -g, once each', () => {
    const globalRoot = path.join(tmp, 'npm', 'node_modules');
    const installed = path.join(globalRoot, '@mokuhub', 'mokutab-bridge');
    expect(globalModuleRoots(installed, () => globalRoot)).toEqual([globalRoot]);
    expect(globalModuleRoots(installed, () => null)).toEqual([globalRoot]);
    // A repo checkout: only npm's root.
    const checkout = path.join(tmp, 'repo', 'app', 'native-server');
    expect(globalModuleRoots(checkout, () => globalRoot)).toEqual([globalRoot]);
    expect(globalModuleRoots(checkout, () => null)).toEqual([]);
  });
});

describe('the native host manifest target', () => {
  test('a path that no longer exists names the likely cause', () => {
    expect(manifestTargetIssues(path.join(tmp, 'gone', 'run_host.bat'))).toEqual([
      'path target does not exist (the package it pointed into was removed or moved)',
    ]);
  });

  test('a path into the old package is named, whether it still exists or not', () => {
    const old = path.join(tmp, 'node_modules', 'workatomcp-bridge', 'dist', 'run_host.bat');
    expect(manifestTargetIssues(old, () => true)).toEqual([
      'path points into the old workatomcp-bridge package',
    ]);
    expect(manifestTargetIssues(old, () => false)).toHaveLength(2);
  });

  test('the new package or a repo build is fine', () => {
    const current = path.join(
      tmp,
      'node_modules',
      '@mokuhub',
      'mokutab-bridge',
      'dist',
      'run_host.bat',
    );
    expect(manifestTargetIssues(current, () => true)).toEqual([]);
    // The repo folder is still called WorkatoMCP on this machine; only the package name counts.
    const repo = path.join(tmp, 'WorkatoMCP', 'app', 'native-server', 'dist', 'run_host.bat');
    expect(manifestTargetIssues(repo, () => true)).toEqual([]);
  });
});

describe('the Claude Code registration', () => {
  const file = '/home/me/.claude.json';
  const bridge = { type: 'http', url: 'http://127.0.0.1:12306/mcp' };
  const check = (config: unknown) => claudeRegistrationCheck(JSON.stringify(config), file);

  test('reads ~/.claude.json, or the one in CLAUDE_CONFIG_DIR', () => {
    expect(claudeConfigPath({}, '/home/me')).toBe(path.join('/home/me', '.claude.json'));
    expect(claudeConfigPath({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/me')).toBe(
      path.join('/cfg', '.claude.json'),
    );
  });

  test('the old key at user scope: warn, register under mokutab, then remove workato', () => {
    const outcome = check({ mcpServers: { workato: bridge } });
    expect(outcome.check.status).toBe('warn');
    expect(outcome.check.message).toMatch(/still registers this bridge as "workato" \(user\)/);
    expect(outcome.check.message).toContain('mcp__workato__*');
    expect(outcome.nextSteps).toEqual([REGISTER_COMMAND, 'claude mcp remove workato -s user']);
    expect(REGISTER_COMMAND).toBe(
      'claude mcp add --transport http -s user mokutab http://127.0.0.1:12306/mcp',
    );
  });

  test('both keys: only the removal is left to do', () => {
    const outcome = check({ mcpServers: { workato: bridge, mokutab: bridge } });
    expect(outcome.nextSteps).toEqual(['claude mcp remove workato -s user']);
  });

  test('a project-scope registration names the project to run the removal in', () => {
    const outcome = check({
      mcpServers: { mokutab: bridge },
      projects: { 'C:/Work/BSD/Alafair': { mcpServers: { workato: bridge } } },
    });
    expect(outcome.check.status).toBe('warn');
    expect(outcome.nextSteps).toEqual([
      'claude mcp remove workato -s local (run in C:/Work/BSD/Alafair)',
    ]);
  });

  test('a stdio proxy of the bridge counts too', () => {
    const outcome = check({ mcpServers: { workato: { command: 'workatomcp-stdio', args: [] } } });
    expect(outcome.check.status).toBe('warn');
  });

  test('a "workato" server that is not this bridge is somebody else\'s', () => {
    const outcome = check({
      mcpServers: { workato: { type: 'http', url: 'https://example.com/mcp' } },
    });
    expect(outcome.check.status).toBe('ok');
    expect(outcome.check.message).toMatch(/no Claude Code registration points at this bridge/);
  });

  test('registered as mokutab: ok', () => {
    const outcome = check({ mcpServers: { mokutab: bridge } });
    expect(outcome.check).toMatchObject({ status: 'ok', message: 'registered as mokutab (user)' });
  });

  test('no config, or an unreadable one, never fails doctor', () => {
    expect(claudeRegistrationCheck(null, file).check.status).toBe('ok');
    const broken = claudeRegistrationCheck('{ nope', file);
    expect(broken.check.status).toBe('warn');
    expect(broken.check.message).toMatch(/not valid JSON.*not checked/);
  });

  test('reports keys and scopes, never what the entries hold', () => {
    const secret = 'sk-test-0123456789';
    const outcome = check({
      mcpServers: { workato: { ...bridge, headers: { Authorization: secret } } },
    });
    expect(JSON.stringify(outcome)).not.toContain(secret);
  });
});

describe('the data dir', () => {
  const state = (over: Partial<DataDirState>): DataDirState => ({
    override: null,
    current: '/home/me/.mokutab',
    legacy: '/home/me/.workatomcp',
    currentExists: false,
    legacyExists: false,
    failure: null,
    ...over,
  });

  test('moved: ok', () => {
    expect(dataDirCheck(state({ currentExists: true })).check).toMatchObject({
      status: 'ok',
      message: '/home/me/.mokutab',
    });
  });

  test('a fresh install: ok, created on first use', () => {
    expect(dataDirCheck(state({})).check.message).toMatch(/created on first use/);
  });

  test('both present: warn, the bridge uses ~/.mokutab', () => {
    const outcome = dataDirCheck(state({ currentExists: true, legacyExists: true }));
    expect(outcome.check.status).toBe('warn');
    expect(outcome.check.message).toMatch(/both .* exist; the bridge uses \/home\/me\/\.mokutab/);
  });

  test('not moved yet: warn, the next start moves it', () => {
    const outcome = dataDirCheck(state({ legacyExists: true }));
    expect(outcome.check.status).toBe('warn');
    expect(outcome.check.message).toMatch(
      /has not moved .* yet; the bridge moves it on its next start/,
    );
    expect(outcome.nextSteps).toEqual([]);
  });

  test('a failed move: warn with the error, and how to clear it', () => {
    const outcome = dataDirCheck(
      state({
        legacyExists: true,
        failure: {
          at: '2026-10-20T10:00:00.000Z',
          from: '/home/me/.workatomcp',
          to: '/home/me/.mokutab',
          error: 'EPERM: operation not permitted',
        },
      }),
      'win32',
    );
    expect(outcome.check.status).toBe('warn');
    expect(outcome.check.message).toMatch(
      /could not move .*EPERM.*keeps using \/home\/me\/\.workatomcp/,
    );
    expect(outcome.nextSteps[0]).toMatch(/close what holds it open/);
    expect((outcome.check.details as any).fix[1]).toBe(
      'or, with Chrome closed: move "/home/me/.workatomcp" "/home/me/.mokutab"',
    );
  });

  test('an override: ok, nothing to move', () => {
    const outcome = dataDirCheck(state({ override: '/data', legacyExists: true }));
    expect(outcome.check).toMatchObject({
      status: 'ok',
      message: '/data (set by MOKUTAB_DATA_DIR)',
    });
  });

  test('reads the state off the home dir', () => {
    fs.mkdirSync(path.join(tmp, '.workatomcp'));
    const read = readDataDirState(tmp, {});
    expect(read).toMatchObject({ override: null, currentExists: false, legacyExists: true });
    expect(readDataDirState(tmp, { WORKATOMCP_DATA_DIR: tmp }).override).toBe(path.resolve(tmp));
  });
});
