import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  isNewerSameMajor,
  parseVersion,
  readFlag,
  writeFlag,
  updateFlagPath,
  updateStateDir,
} from './update-checker';

describe('update-checker version logic', () => {
  it('parses plain x.y.z versions only', () => {
    expect(parseVersion('1.3.11')).toEqual([1, 3, 11]);
    expect(parseVersion(' 1.3.11 ')).toEqual([1, 3, 11]);
    expect(parseVersion('1.3.11-beta.1')).toBeNull();
    expect(parseVersion('1.3')).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
    expect(parseVersion(42)).toBeNull();
  });

  it('accepts newer versions within the same major', () => {
    expect(isNewerSameMajor('1.3.12', '1.3.11')).toBe(true);
    expect(isNewerSameMajor('1.4.0', '1.3.11')).toBe(true);
  });

  it('rejects equal, older, cross-major, and malformed versions', () => {
    expect(isNewerSameMajor('1.3.11', '1.3.11')).toBe(false);
    expect(isNewerSameMajor('1.3.10', '1.3.11')).toBe(false);
    expect(isNewerSameMajor('2.0.0', '1.3.11')).toBe(false);
    expect(isNewerSameMajor('not-a-version', '1.3.11')).toBe(false);
    expect(isNewerSameMajor('1.4.0', 'garbage')).toBe(false);
  });
});

describe('update flag persistence', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workatomcp-update-test-'));
    process.env.WORKATOMCP_UPDATE_STATE_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.WORKATOMCP_UPDATE_STATE_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('honors the state-dir override', () => {
    expect(updateStateDir()).toBe(tempDir);
    expect(updateFlagPath()).toBe(path.join(tempDir, 'update-pending.json'));
  });

  it('round-trips a flag', () => {
    expect(readFlag()).toBeNull();
    writeFlag({ version: '1.3.12', detected_at: '2026-08-18T00:00:00.000Z' });
    const flag = readFlag();
    expect(flag?.version).toBe('1.3.12');
    expect(flag?.detected_at).toBe('2026-08-18T00:00:00.000Z');
  });

  it('returns null for corrupt or versionless flags', () => {
    fs.writeFileSync(updateFlagPath(), 'not json');
    expect(readFlag()).toBeNull();
    fs.writeFileSync(updateFlagPath(), JSON.stringify({ detected_at: 'x' }));
    expect(readFlag()).toBeNull();
  });
});
