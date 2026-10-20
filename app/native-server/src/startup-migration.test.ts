/**
 * The module switch default across the first 2.x start (spec 3.4): a fresh
 * install starts with Workato off, a machine upgraded from 1.x keeps it on,
 * and an explicit setting in config.json always wins.
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { homeDataDirs, readDataDirMoveFailure, type DataDirMove } from './data-dir';
import { ModuleSwitch } from './mcp/module-switch';
import { migrateOnStart, type StartupMigrationOptions } from './startup-migration';

let home: string;
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

const config = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));

function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

describe('a fresh install', () => {
  test('neither data dir existed: Workato starts off and nothing is written', () => {
    const move = start();
    expect(move.outcome).toBe('fresh');
    expect(workatoOn(move)).toBe(false);
    expect(fs.existsSync(current)).toBe(false);
  });

  test('an explicit setting in ~/.mokutab wins', () => {
    put(path.join(current, 'config.json'), JSON.stringify({ modules: { workato: true } }));
    const move = start();
    expect(move.outcome).toBe('current');
    expect(workatoOn(move)).toBe(true);
  });
});

describe('an upgrade from 1.x', () => {
  test('a ~/.workatomcp with no config.json (functions only) keeps Workato on', () => {
    put(path.join(legacy, 'functions', 'acme', 'case.read.yaml'), 'name: acme.case.read\n');
    const move = start();
    expect(move.outcome).toBe('moved');
    expect(config(current)).toEqual({ modules: { workato: true } });
    expect(workatoOn(move)).toBe(true);
    expect(logs.join('\n')).toMatch(/kept workato on: this machine was upgraded from 1\.x/);
  });

  test('an existing config that does not mention Workato keeps its keys and gets it on', () => {
    put(
      path.join(legacy, 'config.json'),
      JSON.stringify({ keep: 'me', modules: { other: false } }),
    );
    const move = start();
    expect(config(current)).toEqual({ keep: 'me', modules: { other: false, workato: true } });
    expect(workatoOn(move)).toBe(true);
  });

  test('{"modules":{"workato":true}} moves as it was', () => {
    const text = JSON.stringify({ modules: { workato: true } });
    put(path.join(legacy, 'config.json'), text);
    const move = start();
    expect(fs.readFileSync(path.join(current, 'config.json'), 'utf8')).toBe(text);
    expect(workatoOn(move)).toBe(true);
  });

  test('an explicit off survives the upgrade', () => {
    const text = JSON.stringify({ modules: { workato: false } });
    put(path.join(legacy, 'config.json'), text);
    const move = start();
    expect(fs.readFileSync(path.join(current, 'config.json'), 'utf8')).toBe(text);
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

  test('only the modules 1.x served are switched on', () => {
    fs.mkdirSync(legacy);
    start({ modules: [{ id: 'workato', onAfterUpgrade: true }, { id: 'later' }] });
    expect(config(current)).toEqual({ modules: { workato: true } });
  });

  test('a malformed config is left for the switch to report, not overwritten', () => {
    put(path.join(legacy, 'config.json'), '{ broken');
    const move = start();
    expect(fs.readFileSync(path.join(current, 'config.json'), 'utf8')).toBe('{ broken');
    expect(workatoOn(move)).toBe(false);
    expect(logs.join('\n')).toMatch(/not valid JSON.*not keeping workato on/);
  });
});

describe('neither an override nor a second start writes anything', () => {
  test('an override dir is not seeded', () => {
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
});
