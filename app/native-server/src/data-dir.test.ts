import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DATA_DIR_MOVE_FAILURE_FILE,
  configFile,
  dataDir,
  homeDataDirs,
  migrateDataDir,
  readDataDirMoveFailure,
  recordDataDirMove,
} from './data-dir';

let home: string;
let current: string;
let legacy: string;
let logs: string[];
/** No override: the home dir decides. */
const env: NodeJS.ProcessEnv = {};
const options = () => ({ home, env, log: (message: string) => logs.push(message) });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'data-dir-home-'));
  ({ current, legacy } = homeDataDirs(home));
  logs = [];
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const read = (file: string) => fs.readFileSync(file, 'utf8');
const busy = (code: string) => () => {
  throw Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
};

describe('which data dir a process reads', () => {
  test('~/.mokutab and ~/.workatomcp under the home dir', () => {
    expect(current).toBe(path.join(home, '.mokutab'));
    expect(legacy).toBe(path.join(home, '.workatomcp'));
  });

  test('an override wins, the MOKUTAB_ name before the WORKATOMCP_ one', () => {
    fs.mkdirSync(legacy);
    const both = { MOKUTAB_DATA_DIR: '/new', WORKATOMCP_DATA_DIR: '/old' };
    expect(dataDir({ home, env: both })).toBe(path.resolve('/new'));
    expect(dataDir({ home, env: { WORKATOMCP_DATA_DIR: '/old' } })).toBe(path.resolve('/old'));
  });

  test('a fresh install reads ~/.mokutab', () => {
    expect(dataDir({ home, env })).toBe(current);
    expect(configFile({ home, env })).toBe(path.join(current, 'config.json'));
  });

  test('~/.workatomcp while it has not been moved', () => {
    fs.mkdirSync(legacy);
    expect(dataDir({ home, env })).toBe(legacy);
  });

  test('~/.mokutab once it exists, even with ~/.workatomcp still there', () => {
    fs.mkdirSync(legacy);
    fs.mkdirSync(current);
    expect(dataDir({ home, env })).toBe(current);
  });
});

describe('the first 2.x start moves ~/.workatomcp to ~/.mokutab', () => {
  test('in one rename: the registry repo and config.json arrive as they were', () => {
    put(path.join(legacy, 'config.json'), '{"modules":{"workato":true}}\n');
    put(path.join(legacy, 'functions', '.git', 'HEAD'), 'ref: refs/heads/master\n');
    put(path.join(legacy, 'functions', 'acme', 'case.read.yaml'), 'name: acme.case.read\n');

    const move = migrateDataDir(options());

    expect(move).toEqual({ outcome: 'moved', dir: current, from: legacy });
    expect(fs.existsSync(legacy)).toBe(false);
    expect(read(path.join(current, 'config.json'))).toBe('{"modules":{"workato":true}}\n');
    expect(read(path.join(current, 'functions', '.git', 'HEAD'))).toBe('ref: refs/heads/master\n');
    expect(read(path.join(current, 'functions', 'acme', 'case.read.yaml'))).toBe(
      'name: acme.case.read\n',
    );
    expect(dataDir({ home, env })).toBe(current);
    expect(logs.join('\n')).toContain(`moved ${legacy} to ${current}`);
  });

  test('a fresh install moves and creates nothing', () => {
    expect(migrateDataDir(options())).toEqual({ outcome: 'fresh', dir: current });
    expect(fs.readdirSync(home)).toEqual([]);
  });

  test('a second start finds ~/.mokutab and leaves it alone', () => {
    fs.mkdirSync(legacy);
    migrateDataDir(options());
    expect(migrateDataDir(options())).toEqual({
      outcome: 'current',
      dir: current,
      legacyAlsoExists: false,
    });
  });

  test('both present: ~/.mokutab is used, neither is touched, and it is said', () => {
    put(path.join(legacy, 'config.json'), 'old');
    put(path.join(current, 'config.json'), 'new');
    expect(migrateDataDir(options())).toEqual({
      outcome: 'current',
      dir: current,
      legacyAlsoExists: true,
    });
    expect(read(path.join(legacy, 'config.json'))).toBe('old');
    expect(read(path.join(current, 'config.json'))).toBe('new');
    expect(logs.join('\n')).toMatch(/both .* exist; using/);
  });

  test('an override is used as is, and the home dirs are not moved', () => {
    fs.mkdirSync(legacy);
    const move = migrateDataDir({ ...options(), env: { MOKUTAB_DATA_DIR: path.join(home, 'x') } });
    expect(move).toEqual({ outcome: 'override', dir: path.join(home, 'x') });
    expect(fs.existsSync(legacy)).toBe(true);
    expect(fs.existsSync(current)).toBe(false);
  });

  for (const code of ['EPERM', 'EBUSY']) {
    test(`a rename that fails with ${code} keeps ~/.workatomcp in use, whole`, () => {
      put(path.join(legacy, 'functions', 'acme', 'case.read.yaml'), 'name: acme.case.read\n');

      const move = migrateDataDir({ ...options(), rename: busy(code) });

      expect(move).toMatchObject({ outcome: 'move_failed', dir: legacy, to: current });
      expect(move.outcome === 'move_failed' && move.error).toMatch(code);
      // Nothing half-moved, nothing copied.
      expect(fs.existsSync(current)).toBe(false);
      expect(read(path.join(legacy, 'functions', 'acme', 'case.read.yaml'))).toBe(
        'name: acme.case.read\n',
      );
      expect(dataDir({ home, env })).toBe(legacy);
      expect(logs.join('\n')).toMatch(
        new RegExp(`could not move .*${code}.*using .* for this run`),
      );
    });
  }

  test('a rename another bridge process made first counts as done', () => {
    fs.mkdirSync(legacy);
    // The other process wins the race: by the time this one renames, the
    // directory has moved and its own rename fails.
    const lost = (from: string, to: string) => {
      fs.renameSync(from, to);
      throw Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
    };
    expect(migrateDataDir({ ...options(), rename: lost })).toEqual({
      outcome: 'current',
      dir: current,
      legacyAlsoExists: false,
    });
  });
});

describe('the failed move record doctor reads', () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = path.join(home, 'state');
  });

  test('is written for a failed move and dropped once the data is in ~/.mokutab', () => {
    const at = new Date('2026-10-20T10:00:00Z');
    recordDataDirMove(
      { outcome: 'move_failed', dir: legacy, to: current, error: 'EPERM: busy' },
      stateDir,
      () => at,
    );
    expect(readDataDirMoveFailure(stateDir)).toEqual({
      at: at.toISOString(),
      from: legacy,
      to: current,
      error: 'EPERM: busy',
    });

    recordDataDirMove({ outcome: 'moved', dir: current, from: legacy }, stateDir);
    expect(fs.existsSync(path.join(stateDir, DATA_DIR_MOVE_FAILURE_FILE))).toBe(false);
    expect(readDataDirMoveFailure(stateDir)).toBeNull();
  });

  test('a fresh install or an override records nothing', () => {
    recordDataDirMove({ outcome: 'fresh', dir: current }, stateDir);
    recordDataDirMove({ outcome: 'override', dir: current }, stateDir);
    expect(fs.existsSync(stateDir)).toBe(false);
  });
});
