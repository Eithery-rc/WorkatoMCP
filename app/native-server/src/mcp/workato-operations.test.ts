import { afterAll, describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wops-journal-'));
process.env.WORKATOMCP_OPERATIONS_DIR = journalDir;

import {
  beginPhase,
  endPhase,
  finishOperation,
  hashCode,
  journalArgs,
  listOperations,
  markInterrupted,
  operationsDir,
  planResume,
  pruneOperations,
  readOperation,
  resetOperationsDirCache,
  startOperation,
  summarizeOperation,
  upsertRecipe,
  OPERATION_RETENTION_FILES,
  type OperationRecord,
} from './workato-operations';

resetOperationsDirCache();

afterAll(() => {
  try {
    fs.rmSync(journalDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const newRecord = (): OperationRecord =>
  startOperation({
    context: { tab_id: 42, host: 'app.workato.com', workspace_id: 5150, environment: 'production' },
    args: { recipe_id: 999, code_path: '/tmp/r.json', code: { keyword: 'trigger' } },
  });

describe('journalArgs', () => {
  test('keeps the path and drops the tree, leaving a hash behind', () => {
    const args = journalArgs({
      recipe_id: 999,
      code_path: '/tmp/r.json',
      code: { keyword: 'trigger' },
      expected_context: { workspace_id: 1 },
      restart_if_running: false,
    });
    expect(args.code).toBeUndefined();
    expect(args.expected_context).toBeUndefined();
    expect(args.code_path).toBe('/tmp/r.json');
    // false must survive: it is a decision, not an absent value.
    expect(args.restart_if_running).toBe(false);
    expect(String(args.code_sha256)).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  test('the same tree hashes the same and a different one does not', () => {
    expect(hashCode({ a: 1 })).toBe(hashCode({ a: 1 }));
    expect(hashCode({ a: 1 })).not.toBe(hashCode({ a: 2 }));
    expect(hashCode(undefined)).toBeUndefined();
  });
});

describe('journal round trip', () => {
  test('a record is readable from disk as soon as it starts', () => {
    const record = newRecord();
    const onDisk = readOperation(record.operation_id);
    expect(onDisk).not.toBeNull();
    expect(onDisk!.status).toBe('running');
    expect(onDisk!.phase).toBe('discovery');
    expect(onDisk!.context.workspace_id).toBe(5150);
    // Never the tree.
    expect(onDisk!.args.code).toBeUndefined();
  });

  test('a phase is on disk BEFORE the call it describes ends', () => {
    const record = newRecord();
    const phase = beginPhase(record, 'stops', [111, 222]);
    const midFlight = readOperation(record.operation_id)!;
    expect(midFlight.phase).toBe('stops');
    expect(midFlight.phases[midFlight.phases.length - 1]).toMatchObject({
      name: 'stops',
      status: 'running',
      affected_ids: [111, 222],
    });
    endPhase(record, phase, 'ok', { stopped: [111] });
    expect(readOperation(record.operation_id)!.phases.slice(-1)[0]).toMatchObject({
      name: 'stops',
      status: 'ok',
      result: { stopped: [111] },
    });
  });

  test('an interruption names the phase, the ids and what was seen', () => {
    const record = newRecord();
    beginPhase(record, 'save', [999]);
    markInterrupted(record, {
      error: 'Request to profile "centium" timed out after 120000ms',
      affected_ids: [999],
      seen: { stopped: [111] },
    });
    const onDisk = readOperation(record.operation_id)!;
    expect(onDisk.status).toBe('interrupted');
    expect(onDisk.phases.slice(-1)[0].status).toBe('interrupted');
    expect(onDisk.interrupted).toMatchObject({ phase: 'save', affected_ids: [999] });
    expect((onDisk.interrupted as any).seen).toEqual({ stopped: [111] });
  });

  test('upsertRecipe merges instead of duplicating', () => {
    const record = newRecord();
    upsertRecipe(record, {
      recipe_id: 111,
      role: 'caller',
      initial: { running: true, version_no: 3 },
    });
    upsertRecipe(record, {
      recipe_id: 111,
      role: 'caller',
      initial: { running: true, version_no: 3 },
      stopped: true,
    });
    expect(record.recipes).toHaveLength(1);
    expect(record.recipes[0].stopped).toBe(true);
  });

  test('an unknown id reads as null rather than throwing', () => {
    expect(readOperation('does-not-exist')).toBeNull();
  });

  test('a path-shaped operation id is refused, not resolved', () => {
    expect(() => readOperation('../../etc/passwd')).toThrow(/not a valid operation id/);
  });

  test('listOperations returns newest first and summarizes', () => {
    const record = newRecord();
    upsertRecipe(record, { recipe_id: 999, role: 'callee', initial: { running: false } });
    finishOperation(record, { status: 'done', result: { ok: true } });
    const rows = listOperations(5);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].operation_id).toBe(record.operation_id);
    expect(summarizeOperation(record)).toMatchObject({
      operation_id: record.operation_id,
      status: 'done',
      recipe_id: 999,
      recipes: 1,
    });
  });
});

describe('pruneOperations', () => {
  test('drops journals past the age bound and keeps the newest ones', () => {
    const dir = operationsDir();
    const stale = path.join(dir, 'stale-fixture.json');
    fs.writeFileSync(stale, JSON.stringify({ operation_id: 'stale-fixture' }), 'utf8');
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
    fs.utimesSync(stale, old / 1000, old / 1000);

    pruneOperations();
    expect(fs.existsSync(stale)).toBe(false);
    // The retention bound is a count too, not only an age.
    expect(OPERATION_RETENTION_FILES).toBe(200);
  });
});

describe('planResume', () => {
  const record = (): OperationRecord =>
    ({
      operation_id: 'op',
      kind: 'save_with_dependents',
      created_at: 'x',
      updated_at: 'x',
      status: 'interrupted',
      phase: 'restore',
      context: { profile: null, tab_id: null, host: null, workspace_id: null, environment: null },
      args: {},
      phases: [],
      recipes: [
        { recipe_id: 111, role: 'caller', initial: { running: true } },
        { recipe_id: 222, role: 'caller', initial: { running: false } },
        { recipe_id: 333, role: 'caller', initial: { running: true } },
      ],
    }) as OperationRecord;

  test('restarts only what was running, and never what was deliberately stopped', () => {
    const decisions = planResume({
      record: record(),
      live: [
        { recipe_id: 111, running: false },
        { recipe_id: 222, running: false },
        { recipe_id: 333, running: true },
      ],
      save_usable: true,
      save_reason: 'saved as version 19',
    });
    expect(decisions).toEqual([
      expect.objectContaining({ recipe_id: 111, action: 'restart' }),
      expect.objectContaining({ recipe_id: 222, action: 'leave_stopped' }),
      expect.objectContaining({ recipe_id: 333, action: 'already_running' }),
    ]);
  });

  test('an unusable save blocks every restart and says why', () => {
    const decisions = planResume({
      record: record(),
      live: [{ recipe_id: 111, running: false }],
      save_usable: false,
      save_reason: 'the save persisted version 19 with 2 validation errors',
    });
    const blocked = decisions.find((d) => d.recipe_id === 111)!;
    expect(blocked.action).toBe('blocked');
    expect(blocked.reason).toMatch(/2 validation errors/);
  });

  test('a broken connection blocks that recipe alone', () => {
    const decisions = planResume({
      record: record(),
      live: [
        { recipe_id: 111, running: false },
        { recipe_id: 333, running: false },
      ],
      save_usable: true,
      save_reason: 'ok',
      connections: { 111: { healthy: false, reason: 'salesforce (lost): not connected' } },
    });
    expect(decisions.find((d) => d.recipe_id === 111)).toMatchObject({
      action: 'blocked',
      reason: 'salesforce (lost): not connected',
    });
    expect(decisions.find((d) => d.recipe_id === 333)).toMatchObject({ action: 'restart' });
  });

  test('a recipe whose live state could not be read is left alone, not guessed', () => {
    const decisions = planResume({
      record: record(),
      live: [{ recipe_id: 111, running: null, error: 'TabNotFound' }],
      save_usable: true,
      save_reason: 'ok',
    });
    expect(decisions.find((d) => d.recipe_id === 111)).toMatchObject({ action: 'unknown' });
  });
});
