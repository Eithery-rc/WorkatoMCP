import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { configFile, dataDir, DATA_DIR_ENV } from '../data-dir';
import { DEFAULT_ENABLED, ModuleSwitch, type ModuleSwitchIo } from './module-switch';

let dir: string;
let file: string;
let logs: string[];
let switches: ModuleSwitch;
/** Set to make the next reads fail the way a locked file does. */
let failReads = 0;
let stats = 0;

const busy = () => Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });

/** Real file reads, with a switch to fail them and a stat counter. */
const io: ModuleSwitchIo = {
  readFile: (target) => {
    if (failReads > 0) {
      failReads -= 1;
      throw busy();
    }
    return fs.readFileSync(target, 'utf8');
  },
  stat: (target) => {
    stats += 1;
    return fs.statSync(target);
  },
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-switch-'));
  file = path.join(dir, 'config.json');
  logs = [];
  failReads = 0;
  stats = 0;
  switches = new ModuleSwitch(
    () => file,
    (message) => logs.push(message),
    { recheckMs: 0, io },
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The config.json.malformed-<time> copies in the test dir. */
function malformedCopies(): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('config.json.malformed-'))
    .map((name) => path.join(dir, name));
}

/** Write the file with a distinct mtime, so a re-read is never skipped by the stat check. */
function writeConfig(text: string): void {
  fs.writeFileSync(file, text);
  const stamp = new Date(Date.now() + Math.floor(Math.random() * 100000));
  fs.utimesSync(file, stamp, stamp);
}

describe('reading the module switch', () => {
  test('a missing file means every module is on', () => {
    expect(fs.existsSync(file)).toBe(false);
    expect(switches.isEnabled('workato')).toBe(true);
    expect(switches.snapshot(['workato', 'other'])).toEqual({ workato: true, other: true });
    expect(logs).toEqual([]);
  });

  test('a missing key means on; a present key is honoured', () => {
    writeConfig(JSON.stringify({ modules: { other: false } }));
    expect(switches.isEnabled('workato')).toBe(true);
    expect(switches.isEnabled('other')).toBe(false);
    writeConfig(JSON.stringify({ something_else: 1 }));
    expect(switches.isEnabled('other')).toBe(true);
  });

  test('malformed JSON keeps the default and says so, without throwing', () => {
    writeConfig('{ not json');
    expect(() => switches.isEnabled('workato')).not.toThrow();
    expect(switches.isEnabled('workato')).toBe(true);
    expect(logs.join('\n')).toMatch(/not valid JSON.*keeping the last good module state/);
    // Logged once per bad file, not once per read.
    switches.isEnabled('workato');
    expect(logs).toHaveLength(1);
  });

  test('malformed JSON keeps the last good state', () => {
    writeConfig(JSON.stringify({ modules: { workato: false } }));
    expect(switches.isEnabled('workato')).toBe(false);
    writeConfig('{"modules": {"workato": tru');
    expect(switches.isEnabled('workato')).toBe(false);
    expect(logs).toHaveLength(1);
  });

  test('a value that is not a boolean falls back to on and is reported', () => {
    writeConfig(JSON.stringify({ modules: { workato: 'no' } }));
    expect(switches.isEnabled('workato')).toBe(true);
    expect(logs.join('\n')).toMatch(/modules\.workato is not true or false/);
  });

  test('a read that fails for a moment (EBUSY) does not latch the stale state', () => {
    writeConfig(JSON.stringify({ modules: { workato: false } }));
    expect(switches.isEnabled('workato')).toBe(false);
    writeConfig(JSON.stringify({ modules: { workato: true } }));
    failReads = 1;
    // The busy read keeps the old value...
    expect(switches.isEnabled('workato')).toBe(false);
    // ...and the next look reads the file, because the signature did not move.
    expect(switches.isEnabled('workato')).toBe(true);
    expect(logs).toEqual([]);
  });

  test('a malformed file is retried after it is fixed, not latched', () => {
    writeConfig('{ broken');
    expect(switches.isEnabled('workato')).toBe(DEFAULT_ENABLED);
    writeConfig(JSON.stringify({ modules: { workato: false } }));
    expect(switches.isEnabled('workato')).toBe(false);
  });

  test('the file is looked at no more often than recheckMs', () => {
    let clock = 1000;
    const throttled = new ModuleSwitch(
      () => file,
      () => {},
      { recheckMs: 250, now: () => clock, io },
    );
    writeConfig(JSON.stringify({ modules: { workato: true } }));
    expect(throttled.isEnabled('workato')).toBe(true);
    stats = 0;
    writeConfig(JSON.stringify({ modules: { workato: false } }));
    clock += 100;
    expect(throttled.isEnabled('workato')).toBe(true);
    expect(stats).toBe(0);
    clock += 200;
    expect(throttled.isEnabled('workato')).toBe(false);
    expect(stats).toBe(1);
  });

  test('a clock that steps back does not hold the next look off', () => {
    let clock = 10_000;
    const throttled = new ModuleSwitch(
      () => file,
      () => {},
      { recheckMs: 250, now: () => clock, io },
    );
    writeConfig(JSON.stringify({ modules: { workato: true } }));
    expect(throttled.isEnabled('workato')).toBe(true);
    writeConfig(JSON.stringify({ modules: { workato: false } }));
    // The wall clock jumps back an hour: elapsed is negative, so look now.
    clock -= 3_600_000;
    expect(throttled.isEnabled('workato')).toBe(false);
  });

  test('valid JSON that is not an object keeps the last good state and says so', () => {
    writeConfig(JSON.stringify({ modules: { workato: false } }));
    expect(switches.isEnabled('workato')).toBe(false);
    writeConfig('[]');
    expect(switches.isEnabled('workato')).toBe(false);
    expect(logs.join('\n')).toMatch(/is not a JSON object \(an array\); keeping the last good/);
  });

  test('a hand edit is picked up on the next read and reported as a change', () => {
    const seen: Record<string, boolean>[] = [];
    switches.onChange((states) => seen.push(states));
    expect(switches.isEnabled('workato')).toBe(true);
    writeConfig(JSON.stringify({ modules: { workato: false } }));
    expect(switches.isEnabled('workato')).toBe(false);
    expect(seen).toEqual([{ workato: false }]);
  });
});

describe('writing the module switch', () => {
  test('set persists the value, keeps other keys and tells the listeners once', () => {
    writeConfig(JSON.stringify({ keep: 'me', modules: { other: true } }));
    const listener = jest.fn();
    switches.onChange(listener);

    switches.set('workato', false);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      keep: 'me',
      modules: { other: true, workato: false },
    });
    expect(switches.isEnabled('workato')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    // Setting the same value again is not a change.
    switches.set('workato', false);
    expect(listener).toHaveBeenCalledTimes(1);

    // A fresh reader of the same file sees it.
    expect(
      new ModuleSwitch(
        () => file,
        () => {},
      ).isEnabled('workato'),
    ).toBe(false);
  });

  test('set creates the data dir and file when they are missing', () => {
    const nested = path.join(dir, 'a', 'b', 'config.json');
    const fresh = new ModuleSwitch(
      () => nested,
      () => {},
    );
    fresh.set('workato', false);
    expect(JSON.parse(fs.readFileSync(nested, 'utf8'))).toEqual({ modules: { workato: false } });
  });

  test('set over a malformed file moves it aside instead of losing it silently', () => {
    writeConfig('{ broken');
    switches.set('workato', true);
    const copies = malformedCopies();
    expect(copies).toHaveLength(1);
    expect(fs.readFileSync(copies[0], 'utf8')).toBe('{ broken');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ modules: { workato: true } });
  });

  test('valid JSON that is not an object is moved aside too, never overwritten', () => {
    for (const text of ['[]', 'null', '42']) {
      writeConfig(text);
      switches.set('workato', true);
    }
    // Each one kept: a second copy never replaces the first.
    const kept = malformedCopies().map((copy) => fs.readFileSync(copy, 'utf8'));
    expect(kept.sort()).toEqual(['42', '[]', 'null']);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ modules: { workato: true } });
  });

  test('a UTF-8 BOM is not a malformed file', () => {
    writeConfig('﻿' + JSON.stringify({ keep: 'me', modules: { workato: false } }));
    expect(switches.isEnabled('workato')).toBe(false);
    switches.set('workato', true);
    expect(malformedCopies()).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      keep: 'me',
      modules: { workato: true },
    });
  });

  test('set over a file it cannot read fails and leaves the file alone', () => {
    writeConfig(JSON.stringify({ keep: 'me', modules: { workato: true } }));
    switches.isEnabled('workato');
    failReads = 10;
    expect(() => switches.set('workato', false)).toThrow(/could not read .*EBUSY.*nothing changed/);
    failReads = 0;
    expect(malformedCopies()).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      keep: 'me',
      modules: { workato: true },
    });
    expect(switches.isEnabled('workato')).toBe(true);
  });
});

describe('the data dir helper', () => {
  test('config.json lives in the data dir, which the test setup moved to a temp dir', () => {
    expect(process.env[DATA_DIR_ENV]).toBeTruthy();
    expect(dataDir()).toBe(path.resolve(process.env[DATA_DIR_ENV]!));
    expect(configFile()).toBe(path.join(dataDir(), 'config.json'));
    expect(dataDir().startsWith(os.homedir() + path.sep + '.workatomcp')).toBe(false);
  });
});
