import { afterAll, describe, expect, test } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wops-status-'));
process.env.WORKATOMCP_OPERATIONS_DIR = journalDir;

import {
  describeDrift,
  handleWorkatoOperationCall,
  isWorkatoOperationTool,
} from './workato-operation-status';
import { handleWorkatoSaveWithDependentsCall } from './workato-save-dependents';
import { readOperation, resetOperationsDirCache, type OperationRecord } from './workato-operations';

resetOperationsDirCache();

afterAll(() => {
  try {
    fs.rmSync(journalDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const okText = (payload: unknown, headline = 'ok'): CallToolResult => ({
  isError: false,
  content: [{ type: 'text', text: `${headline}\n${JSON.stringify(payload)}` }],
});

const parse = (result: CallToolResult): any =>
  JSON.parse((result.content[0] as any).text.split('\n').slice(-1)[0]);

/** A fake Workato that can be made to time out once on a named tool. */
function makeWorkato(opts: { running: Record<number, boolean>; throwOnce?: string }) {
  const running = { ...opts.running };
  const calls: Array<{ name: string; args: any }> = [];
  let thrown = false;
  const call = async (name: string, args: any): Promise<CallToolResult> => {
    calls.push({ name, args });
    if (opts.throwOnce && !thrown && name === opts.throwOnce) {
      thrown = true;
      throw new Error('Request to profile "centium" timed out after 120000ms');
    }
    if (name === 'workato_recipe_status') {
      return okText({
        recipe_id: args.recipe_id,
        name: `recipe ${args.recipe_id}`,
        running: running[args.recipe_id] === true,
        state: running[args.recipe_id] === true ? 'running' : 'stopped',
        version_no: 3,
      });
    }
    if (name === 'workato_stop_recipe') {
      running[args.recipe_id] = false;
      return okText({ recipe_id: args.recipe_id, action: 'stop', outcome: 'state_reached' });
    }
    if (name === 'workato_start_recipe') {
      running[args.recipe_id] = true;
      return okText({ recipe_id: args.recipe_id, action: 'start', outcome: 'state_reached' });
    }
    if (name === 'workato_ui_save_recipe_code') {
      return okText({
        recipe_id: args.recipe_id,
        version_no: 4,
        code_errors: [],
        persisted: true,
        valid: true,
        verified: true,
        save_status: 'already_applied',
      });
    }
    return okText({});
  };
  return { call, calls, running };
}

const runSave = async (wk: ReturnType<typeof makeWorkato>, args: Record<string, unknown> = {}) =>
  handleWorkatoSaveWithDependentsCall(
    'workato_recipe_save_with_dependents',
    { recipe_id: 999, code_path: '/tmp/r.json', dependent_recipe_ids: [111], ...args },
    wk.call,
  );

describe('isWorkatoOperationTool', () => {
  test('matches only its own tool', () => {
    expect(isWorkatoOperationTool('workato_operation_status')).toBe(true);
    expect(isWorkatoOperationTool('workato_recipe_save_with_dependents')).toBe(false);
  });
});

describe('workato_operation_status', () => {
  test('refuses without an operation_id or list', async () => {
    const wk = makeWorkato({ running: {} });
    const result = await handleWorkatoOperationCall('workato_operation_status', {}, wk.call);
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toMatch(/pass operation_id/);
  });

  test('an unknown operation is a clear miss, not an empty record', async () => {
    const wk = makeWorkato({ running: {} });
    const result = await handleWorkatoOperationCall(
      'workato_operation_status',
      { operation_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
      wk.call,
    );
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toMatch(/no journal for operation/);
    expect(wk.calls).toHaveLength(0);
  });

  test('reads a finished operation back without touching Workato', async () => {
    const wk = makeWorkato({ running: { 111: true } });
    const saved = await runSave(wk);
    const operationId = parse(saved).operation_id;
    wk.calls.length = 0;

    const result = await handleWorkatoOperationCall(
      'workato_operation_status',
      { operation_id: operationId },
      wk.call,
    );
    expect(result.isError).toBe(false);
    const payload = parse(result);
    expect(payload.operation.operation_id).toBe(operationId);
    expect(payload.summary.status).toBe('done');
    expect(payload.operation.phases.map((p: any) => p.name)).toEqual([
      'discovery',
      'preflight',
      'stops',
      'save',
      'restore',
    ]);
    // The read path is local: no browser round trip.
    expect(wk.calls).toHaveLength(0);
    expect(payload.live).toBeUndefined();
  });

  test('refresh reads one live status per affected recipe and reports drift', async () => {
    const wk = makeWorkato({ running: { 111: true } });
    const saved = await runSave(wk);
    const operationId = parse(saved).operation_id;
    // Someone stopped the caller again after the operation finished.
    wk.running[111] = false;
    wk.calls.length = 0;

    const result = await handleWorkatoOperationCall(
      'workato_operation_status',
      { operation_id: operationId, refresh: true },
      wk.call,
    );
    const payload = parse(result);
    expect(payload.live).toHaveLength(2); // callee + one caller
    expect(wk.calls.filter((c) => c.name === 'workato_recipe_status')).toHaveLength(2);
    expect(payload.drift.join(' ')).toMatch(/recipe 111 \(caller\) was RUNNING before/);
  });

  test('list returns the recent operations with a limit and a bound', async () => {
    const wk = makeWorkato({ running: { 111: true } });
    await runSave(wk);
    await runSave(wk);
    const result = await handleWorkatoOperationCall(
      'workato_operation_status',
      { list: true, limit: 1 },
      wk.call,
    );
    const payload = parse(result);
    expect(payload.operations).toHaveLength(1);
    expect(payload.limit).toBe(1);
    expect(payload.returned).toBe(1);
    expect(payload.truncated).toBe(true);
    expect(payload.next_cursor).toBeNull();
    expect(payload.operations[0].recipe_id).toBe(999);
  });

  test('resume:true finishes an interrupted restore and marks the journal done', async () => {
    const wk = makeWorkato({ running: { 111: true }, throwOnce: 'workato_start_recipe' });
    const saved = await runSave(wk);
    const operationId = parse(saved).operation_id;
    expect(readOperation(operationId)!.status).toBe('interrupted');
    expect(wk.running[111]).toBe(false);

    const result = await handleWorkatoOperationCall(
      'workato_operation_status',
      { operation_id: operationId, resume: true },
      wk.call,
    );
    const payload = parse(result);
    expect(payload.resume.restarted).toEqual([111]);
    expect(payload.resume.failed).toEqual([]);
    expect(wk.running[111]).toBe(true);
    expect(readOperation(operationId)!.status).toBe('done');
    // A resume always reports the live state alongside it.
    expect(payload.live).toHaveLength(2);
  });
});

describe('describeDrift', () => {
  const record = {
    recipes: [
      { recipe_id: 111, role: 'caller', initial: { running: true, version_no: 3 } },
      { recipe_id: 999, role: 'callee', initial: { running: false, version_no: 7 } },
    ],
  } as unknown as OperationRecord;

  test('names a caller that is still stopped and a version that moved', () => {
    const notes = describeDrift(record, [
      { recipe_id: 111, running: false, state: 'stopped', version_no: 3 },
      { recipe_id: 999, running: false, state: 'stopped', version_no: 8 },
    ]);
    expect(notes).toEqual([
      expect.stringMatching(/recipe 111 \(caller\) was RUNNING before the operation/),
      expect.stringMatching(/recipe 999 moved from version 7 to 8/),
    ]);
  });

  test('an unreadable recipe is reported as unreadable, not as unchanged', () => {
    const notes = describeDrift(record, [
      { recipe_id: 111, running: null, state: null, version_no: null, error: 'TabNotFound' },
    ]);
    expect(notes).toEqual([expect.stringMatching(/live state could not be read \(TabNotFound\)/)]);
  });
});
