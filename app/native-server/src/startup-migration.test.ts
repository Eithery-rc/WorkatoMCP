/**
 * The module switch default across the first 2.x start (spec 3.4): a fresh
 * install starts with Workato off, a machine that ran 1.x keeps it on, the
 * decision is recorded once, and an explicit setting in config.json always
 * wins.
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { homeDataDirs, readDataDirMoveFailure, type DataDirMove } from './data-dir';
import { ModuleSwitch } from './mcp/module-switch';
import { migrateOnStart, type StartupMigrationOptions } from './startup-migration';

let home: string;
/** The 1.x (and 2.x) bridge state dir: %LOCALAPPDATA%\mcp-chrome-bridge in real life. */
let stateDir: string;
let current: string;
let legacy: string;
let logs: string[];

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-migration-'));
  stateDir = path.join(home, 'state');
  ({ current, legacy } = homeDataDirs(home));
  logs = [];
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const start = (extra: Partial<StartupMigrationOptions> = {}) =>
  migrateOnStart({ home, env: {}, stateDir, log: (m) => logs.push(m), ...extra });

/** The switch a bridge reads after this start. */
const workatoOn = (move: DataDirMove) =>
  new ModuleSwitch(
    () => path.join(move.dir, 'config.json'),
    () => {},
    { recheckMs: 0 },
  ).isEnabled('workato');

const configText = (dir: string) => fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
const config = (dir: string) => JSON.parse(configText(dir));

function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** What a 2.x run leaves in the state dir (watches, default profile). */
function runWritesStateDir(): void {
  put(path.join(stateDir, 'watches.json'), '[]');
}

describe('a fresh install', () => {
  test('no data dir and no state dir: Workato starts off, and that is recorded', () => {
    const move = start();
    expect(move.outcome).toBe('fresh');
    expect(config(current)).toEqual({ modules: { workato: false } });
    expect(workatoOn(move)).toBe(false);
    expect(logs.join('\n')).toMatch(/workato off: a fresh install/);
  });

  test('a second start, after the first one created the state dir, stays off', () => {
    start();
    runWritesStateDir();
    const before = configText(current);
    const move = start();
    expect(move.outcome).toBe('current');
    expect(configText(current)).toBe(before);
    expect(workatoOn(move)).toBe(false);
  });

  test('an explicit setting in ~/.mokutab is never rewritten', () => {
    for (const workato of [true, false]) {
      const text = JSON.stringify({ modules: { workato } });
      put(path.join(current, 'config.json'), text);
      const move = start();
      expect(configText(current)).toBe(text);
      expect(workatoOn(move)).toBe(workato);
    }
  });
});

describe('a machine that ran 1.x', () => {
  test('only the 1.x state dir (no function ever saved): Workato on, and recorded', () => {
    fs.mkdirSync(path.join(stateDir, 'logs'), { recursive: true });
    const move = start();
    expect(move.outcome).toBe('fresh');
    expect(config(current)).toEqual({ modules: { workato: true } });
    expect(workatoOn(move)).toBe(true);
    expect(logs.join('\n')).toMatch(/workato on: this machine ran 1\.x \(.*state exists\)/);

    // Recorded: the next start reads it and writes nothing.
    const before = configText(current);
    expect(workatoOn(start())).toBe(true);
    expect(configText(current)).toBe(before);
  });

  test('only ~/.workatomcp, with no config.json (functions only): Workato on', () => {
    put(path.join(legacy, 'functions', 'acme', 'case.read.yaml'), 'name: acme.case.read\n');
    const move = start();
    expect(move.outcome).toBe('moved');
    expect(config(current)).toEqual({ modules: { workato: true } });
    expect(workatoOn(move)).toBe(true);
    expect(logs.join('\n')).toMatch(/this machine ran 1\.x \(.*\.workatomcp exists\)/);
  });

  test('a config that does not mention Workato keeps its keys and gets it on', () => {
    put(
      path.join(legacy, 'config.json'),
      JSON.stringify({ keep: 'me', modules: { other: false } }),
    );
    const move = start();
    expect(config(current)).toEqual({ keep: 'me', modules: { other: false, workato: true } });
    expect(workatoOn(move)).toBe(true);
  });

  test('an explicit setting moves as it was, whatever the evidence', () => {
    for (const workato of [true, false]) {
      fs.rmSync(current, { recursive: true, force: true });
      fs.mkdirSync(stateDir, { recursive: true });
      const text = JSON.stringify({ modules: { workato } });
      put(path.join(legacy, 'config.json'), text);
      const move = start();
      expect(move.outcome).toBe('moved');
      expect(configText(current)).toBe(text);
      expect(workatoOn(move)).toBe(workato);
    }
  });

  test('an explicit off in ~/.mokutab stays off next to the 1.x state dir', () => {
    fs.mkdirSync(stateDir, { recursive: true });
    const text = JSON.stringify({ modules: { workato: false } });
    put(path.join(current, 'config.json'), text);
    const move = start();
    expect(configText(current)).toBe(text);
    expect(workatoOn(move)).toBe(false);
  });

  test('a failed move keeps Workato on in the directory still in use, and doctor hears of it', () => {
    fs.mkdirSync(legacy);
    const busy = () => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    };
    const move = start({ rename: busy });
    expect(move).toMatchObject({ outcome: 'move_failed', dir: legacy });
    expect(config(legacy)).toEqual({ modules: { workato: true } });
    expect(workatoOn(move)).toBe(true);
    expect(fs.existsSync(current)).toBe(false);
    expect(readDataDirMoveFailure(stateDir)).toMatchObject({ from: legacy, to: current });

    // The next start moves it, settings included, and clears the record.
    const next = start();
    expect(next.outcome).toBe('moved');
    expect(workatoOn(next)).toBe(true);
    expect(readDataDirMoveFailure(stateDir)).toBeNull();
  });

  test('only the modules 1.x served are written', () => {
    fs.mkdirSync(legacy);
    start({ modules: [{ id: 'workato', onAfterUpgrade: true }, { id: 'later' }] });
    expect(config(current)).toEqual({ modules: { workato: true } });
  });

  test('a malformed config is left for the switch to report, not overwritten', () => {
    put(path.join(legacy, 'config.json'), '{ broken');
    const move = start();
    expect(configText(current)).toBe('{ broken');
    expect(workatoOn(move)).toBe(false);
    expect(logs.join('\n')).toMatch(/not valid JSON.*not recording workato/);
  });
});

describe('what is never written', () => {
  test('an override dir is left alone', () => {
    fs.mkdirSync(legacy);
    const dir = path.join(home, 'override');
    const move = start({ env: { MOKUTAB_DATA_DIR: dir } });
    expect(move.outcome).toBe('override');
    expect(fs.existsSync(dir)).toBe(false);
  });

  test('a later start leaves a config the person changed since alone', () => {
    fs.mkdirSync(legacy);
    start();
    put(path.join(current, 'config.json'), JSON.stringify({ modules: { workato: false } }));
    const move = start();
    expect(move.outcome).toBe('current');
    expect(workatoOn(move)).toBe(false);
  });

  test('bridges starting together write the same answer and leave no temp file', () => {
    fs.mkdirSync(stateDir, { recursive: true });
    start();
    start();
    expect(config(current)).toEqual({ modules: { workato: true } });
    expect(fs.readdirSync(current).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
