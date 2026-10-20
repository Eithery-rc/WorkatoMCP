import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { configFile, dataDir, DATA_DIR_ENV } from '../data-dir';
import { ModuleSwitch } from './module-switch';

let dir: string;
let file: string;
let logs: string[];
let switches: ModuleSwitch;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-switch-'));
  file = path.join(dir, 'config.json');
  logs = [];
  switches = new ModuleSwitch(
    () => file,
    (message) => logs.push(message),
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

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
    expect(fs.readFileSync(`${file}.malformed`, 'utf8')).toBe('{ broken');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ modules: { workato: true } });
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
