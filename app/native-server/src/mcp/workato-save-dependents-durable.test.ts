/**
 * The durability half of workato_recipe_save_with_dependents: truthful
 * lifecycle outcomes, save classification, connection preflight, the journal,
 * interruption and resume.
 *
 * The fake Workato below is deliberately less forgiving than the one in
 * workato-save-dependents.test.ts: a start only flips the state when the
 * scenario says it does, a save can persist an invalid tree, and any call can
 * be made to throw the way a bridge timeout throws.
 */

import { afterAll, describe, expect, test } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wops-durable-'));
process.env.WORKATOMCP_OPERATIONS_DIR = journalDir;

import {
  classifySaveResult,
  handleWorkatoSaveWithDependentsCall,
  readLifecycleResult,
  resumeSaveOperation,
  trailingJson,
} from './workato-save-dependents';
import { readOperation, resetOperationsDirCache } from './workato-operations';

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

const errText = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});

const parse = (result: CallToolResult): any =>
  JSON.parse((result.content[0] as any).text.split('\n').slice(-1)[0]);

interface FakeOptions {
  running?: Record<number, boolean>;
  versions?: Record<number, number>;
  /** Recipes whose start is ACCEPTED but never reaches running. */
  startNeverFlips?: number[];
  /** Connection verdicts by recipe id. Absent means "the read gave no verdict". */
  connections?: Record<number, { healthy: boolean; blocking?: unknown[] }>;
  save?: (args: any, attempt: number) => CallToolResult;
  callers?: Array<{ recipe_id: number; name: string; running: boolean }>;
  /** Throw once, the way a bridge timeout throws, on this tool + recipe. */
  throwOnce?: { name: string; recipe_id?: number };
}

function makeWorkato(opts: FakeOptions) {
  const running: Record<number, boolean> = { ...(opts.running ?? {}) };
  const versions: Record<number, number> = { ...(opts.versions ?? {}) };
  const calls: Array<{ name: string; args: any }> = [];
  let saveAttempts = 0;
  let thrown = false;

  const call = async (name: string, args: any): Promise<CallToolResult> => {
    calls.push({ name, args });
    if (
      opts.throwOnce &&
      !thrown &&
      opts.throwOnce.name === name &&
      (opts.throwOnce.recipe_id === undefined || opts.throwOnce.recipe_id === args.recipe_id)
    ) {
      thrown = true;
      // The request that timed out still reached Workato; count it, so a
      // resume's save is attempt 2 and the fake can answer already_applied.
      if (name === 'workato_ui_save_recipe_code') saveAttempts += 1;
      throw new Error('Request to profile "centium" timed out after 120000ms');
    }

    if (name === 'workato_recipe_status') {
      return okText({
        recipe_id: args.recipe_id,
        name: `recipe ${args.recipe_id}`,
        running: running[args.recipe_id] === true,
        state: running[args.recipe_id] === true ? 'running' : 'stopped',
        version_no: versions[args.recipe_id] ?? 3,
      });
    }

    if (name === 'workato_recipe_connections') {
      const verdict = opts.connections?.[args.recipe_id];
      if (!verdict) return okText({ recipe_id: args.recipe_id, connections: [] });
      return okText({
        recipe_id: args.recipe_id,
        connections: [],
        healthy: verdict.healthy,
        blocking: verdict.blocking ?? [],
        actions: [],
      });
    }

    if (name === 'workato_stop_recipe') {
      running[args.recipe_id] = false;
      return okText({ recipe_id: args.recipe_id, action: 'stop', outcome: 'state_reached' });
    }

    if (name === 'workato_start_recipe') {
      const never = (opts.startNeverFlips ?? []).includes(args.recipe_id);
      if (never) {
        return okText({
          recipe_id: args.recipe_id,
          action: 'start',
          status: 'enqueued',
          outcome: 'accepted',
          state: 'stopped',
          running: false,
          state_flipped: false,
        });
      }
      running[args.recipe_id] = true;
      return okText({ recipe_id: args.recipe_id, action: 'start', outcome: 'state_reached' });
    }

    if (name === 'workato_ui_save_recipe_code') {
      saveAttempts += 1;
      if (opts.save) return opts.save(args, saveAttempts);
      versions[args.recipe_id] = (versions[args.recipe_id] ?? 3) + 1;
      return okText({
        recipe_id: args.recipe_id,
        version_no: versions[args.recipe_id],
        code_errors: [],
        persisted: true,
        valid: true,
        verified: true,
      });
    }

    if (name === 'workato_recipe_callers') {
      const callers = opts.callers ?? [];
      for (const caller of callers) {
        if (running[caller.recipe_id] === undefined) running[caller.recipe_id] = caller.running;
      }
      return okText(
        {
          recipe_id: args.recipe_id,
          sources: ['graph', 'code'],
          callers,
          unresolved_dynamic_targets: [],
          failed_reads: [],
          scope: { mode: 'folders', folder_ids: [30573643], complete: true },
          completeness: 'complete',
          completeness_reasons: [],
        },
        `${callers.length} caller(s)`,
      );
    }

    return okText({});
  };

  return { call, calls, running, versions, saveAttempts: () => saveAttempts };
}

const named = (calls: Array<{ name: string; args: any }>, name: string) =>
  calls.filter((c) => c.name === name);

// ---------------------------------------------------------------------------
// Pure readers
// ---------------------------------------------------------------------------

describe('readLifecycleResult', () => {
  test('accepted is not state_reached', () => {
    expect(
      readLifecycleResult(okText({ outcome: 'accepted', state: 'stopped', running: false }))
        .outcome,
    ).toBe('accepted');
    expect(readLifecycleResult(okText({ outcome: 'state_reached' })).outcome).toBe('state_reached');
  });

  test('falls back to state_flipped for an older extension', () => {
    expect(readLifecycleResult(okText({ state_flipped: false })).outcome).toBe('accepted');
    expect(readLifecycleResult(okText({ state_flipped: true })).outcome).toBe('state_reached');
    expect(readLifecycleResult(okText({ status: 'enqueued' })).outcome).toBe('unknown');
  });

  test('an isError start is failed and keeps the activation error', () => {
    const reading = readLifecycleResult(
      errText(
        'start recipe 1 FAILED\n' +
          JSON.stringify({ outcome: 'failed', start_error: { state: 'stopped' } }),
      ),
    );
    expect(reading.outcome).toBe('failed');
    expect(reading.start_error).toEqual({ state: 'stopped' });
  });
});

describe('classifySaveResult', () => {
  test('a clean save is ok and lets callers back', () => {
    const a = classifySaveResult(
      okText({ recipe_id: 1, version_no: 19, code_errors: [], persisted: true, valid: true }),
    );
    expect(a.classification).toBe('ok');
    expect(a.restart_callers).toBe(true);
    expect(a.version_no).toBe(19);
  });

  test('already_applied counts as success and says no duplicate was created', () => {
    const a = classifySaveResult(
      okText({
        recipe_id: 1,
        version_no: 19,
        save_status: 'already_applied',
        persisted: true,
        valid: true,
        code_errors: [],
      }),
    );
    expect(a.classification).toBe('already_applied');
    expect(a.restart_callers).toBe(true);
    expect(a.summary).toMatch(/no duplicate version/);
  });

  test('persisted_invalid is persisted, not "nothing changed"', () => {
    const a = classifySaveResult(
      okText({
        recipe_id: 1,
        version_no: 19,
        code_errors: [{ line: 2, message: 'account_id blank' }],
        persisted: true,
        valid: false,
        save_status: 'persisted_invalid',
      }),
    );
    expect(a.classification).toBe('persisted_invalid');
    expect(a.persisted).toBe(true);
    expect(a.restart_callers).toBe(false);
    expect(a.summary).toMatch(/PERSISTED as version 19/);
  });

  test('persisted_incomplete arrives as an isError and is still persisted', () => {
    const a = classifySaveResult(
      errText(
        'saved recipe 1 as version 19, but the readback does not match\n' +
          JSON.stringify({
            recipe_id: 1,
            version_no: 19,
            save_status: 'persisted_incomplete',
            dropped: [{ path: 'trigger_every' }],
          }),
      ),
    );
    expect(a.classification).toBe('persisted_incomplete');
    expect(a.persisted).toBe(true);
    expect(a.restart_callers).toBe(false);
    expect(a.dropped).toHaveLength(1);
  });

  test('a real failure is not persisted and callers may go back', () => {
    const a = classifySaveResult(errText('WorkatoApiError (http): 500'));
    expect(a.classification).toBe('failed');
    expect(a.persisted).toBe(false);
    expect(a.restart_callers).toBe(true);
  });

  test('trailingJson ignores prose above the payload', () => {
    expect(trailingJson('some words\nmore words\n{"a":1}')).toEqual({ a: 1 });
    expect(trailingJson('no json here')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

describe('truthful restart reporting', () => {
  test('a start Workato only ACCEPTED is reported as not restored', async () => {
    const wk = makeWorkato({ running: { 111: true }, startNeverFlips: [111] });
    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111] },
      wk.call,
    );

    const payload = parse(result);
    expect(payload.dependents[0].restarted).toBe(false);
    expect(payload.dependents[0].restart_outcome).toBe('accepted');
    expect(payload.dependents[0].error).toMatch(/ACCEPTED the start but the state did not reach/);
    expect((result.content[0] as any).text).toMatch(/1 dependent\(s\) FAILED to restart/);
    expect(wk.running[111]).toBe(false);

    const journal = readOperation(payload.operation_id)!;
    expect(journal.status).toBe('done');
    expect(journal.recipes.find((r) => r.recipe_id === 111)!.restarted).toBe(false);
  });
});

describe('save classification drives the restore', () => {
  test('a persisted_invalid save does not restart callers and names the version and errors', async () => {
    const wk = makeWorkato({
      running: { 111: true },
      save: (args) =>
        okText({
          recipe_id: args.recipe_id,
          version_no: 19,
          code_errors: [{ line: 2, message: "account_id can't be blank" }],
          persisted: true,
          valid: false,
          verified: true,
          save_status: 'persisted_invalid',
        }),
    });

    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111] },
      wk.call,
    );

    const text = (result.content[0] as any).text;
    const payload = parse(result);
    expect(payload.save_classification).toBe('persisted_invalid');
    expect(payload.version_no).toBe(19);
    expect(payload.code_errors[0].message).toMatch(/account_id/);
    expect(text).toMatch(/PERSISTED as version 19/);
    expect(text).not.toMatch(/nothing was changed/);
    // The caller stays stopped, with the reason on its own record.
    expect(named(wk.calls, 'workato_start_recipe')).toHaveLength(0);
    expect(payload.dependents[0].blocked_reason).toMatch(/persisted_invalid/);
    expect(wk.running[111]).toBe(false);
  });

  test('a persisted_incomplete save is an error but still reports its version and dropped paths', async () => {
    const wk = makeWorkato({
      running: { 111: true },
      save: () =>
        errText(
          'workato_ui_save_recipe_code: saved recipe 999 as version 20, but the readback does ' +
            'not match what was sent.\n' +
            JSON.stringify({
              recipe_id: 999,
              version_no: 20,
              save_status: 'persisted_incomplete',
              dropped: [{ path: 'input.trigger_every' }],
            }),
        ),
    });

    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111] },
      wk.call,
    );

    expect(result.isError).toBe(true);
    const payload = parse(result);
    expect(payload.save_classification).toBe('persisted_incomplete');
    expect(payload.version_no).toBe(20);
    expect(payload.dropped).toEqual([{ path: 'input.trigger_every' }]);
    expect(named(wk.calls, 'workato_start_recipe')).toHaveLength(0);
  });

  test('a save that truly failed still puts the callers back', async () => {
    const wk = makeWorkato({
      running: { 111: true },
      save: () => errText('WorkatoApiError (http): 500 Internal Server Error'),
    });
    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111] },
      wk.call,
    );
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toMatch(/nothing was changed/);
    expect(wk.running[111]).toBe(true);
  });
});

describe('connection preflight', () => {
  test('an unhealthy callee is still saved but nothing is restarted against it', async () => {
    const wk = makeWorkato({
      running: { 111: true },
      connections: {
        999: {
          healthy: false,
          blocking: [
            {
              provider: 'salesforce',
              connection_id: 19092754,
              status: 'lost',
              reason: 'Salesforce is not connected',
            },
          ],
        },
      },
    });

    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111] },
      wk.call,
    );

    // The save happened: a disconnected connection must not make the recipe
    // uneditable.
    const save = named(wk.calls, 'workato_ui_save_recipe_code')[0];
    expect(save).toBeDefined();
    expect(save.args.restart_if_running).toBe(false);
    // Health was read before the first stop.
    const order = wk.calls.map((c) => c.name);
    expect(order.indexOf('workato_recipe_connections')).toBeLessThan(
      order.indexOf('workato_stop_recipe'),
    );

    const payload = parse(result);
    expect(payload.callee_connections_healthy).toBe(false);
    expect(payload.callee_connections_reason).toMatch(
      /salesforce \(lost\): Salesforce is not connected/,
    );
    expect(payload.dependents[0].blocked_reason).toMatch(/connections are not usable/);
    expect(named(wk.calls, 'workato_start_recipe')).toHaveLength(0);
    expect(wk.running[111]).toBe(false);
  });

  test('an unhealthy caller is left stopped while the healthy ones come back', async () => {
    const wk = makeWorkato({
      running: { 111: true, 222: true },
      connections: {
        222: {
          healthy: false,
          blocking: [{ provider: 'netsuite', connection_id: 7, status: 'lost', reason: 'expired' }],
        },
      },
    });
    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111, 222] },
      wk.call,
    );
    const payload = parse(result);
    expect(wk.running[111]).toBe(true);
    expect(wk.running[222]).toBe(false);
    expect(payload.dependents[1].blocked_reason).toMatch(/netsuite \(lost\): expired/);
  });

  test('preflight_connections:false skips the health calls entirely', async () => {
    const wk = makeWorkato({ running: { 111: true } });
    await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111], preflight_connections: false },
      wk.call,
    );
    expect(named(wk.calls, 'workato_recipe_connections')).toHaveLength(0);
  });
});

describe('idempotency', () => {
  test("the save carries the callee's pre-stop version as the lock", async () => {
    const wk = makeWorkato({ running: { 111: true }, versions: { 999: 7 } });
    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111] },
      wk.call,
    );
    expect(named(wk.calls, 'workato_ui_save_recipe_code')[0].args.expected_base_version_no).toBe(7);
    expect(parse(result).expected_base_version_no).toBe(7);
    expect(readOperation(parse(result).operation_id)!.expected_base_version_no).toBe(7);
  });

  test('an explicit expected_base_version_no still wins', async () => {
    const wk = makeWorkato({ running: {}, versions: { 999: 7 } });
    await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [], expected_base_version_no: 5 },
      wk.call,
    );
    expect(named(wk.calls, 'workato_ui_save_recipe_code')[0].args.expected_base_version_no).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Interruption and resume
// ---------------------------------------------------------------------------

describe('interruption', () => {
  test('a timeout during the stops leaves an interrupted journal naming the ids', async () => {
    const wk = makeWorkato({
      running: { 111: true, 222: true },
      throwOnce: { name: 'workato_stop_recipe', recipe_id: 222 },
    });
    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code_path: '/tmp/r.json', dependent_recipe_ids: [111, 222] },
      wk.call,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text;
    expect(text).toMatch(/was INTERRUPTED during the stops phase/);
    expect(text).toMatch(/workato_operation_status/);
    const payload = parse(result);
    expect(payload.interrupted_recipe_ids).toEqual([222]);

    const journal = readOperation(payload.operation_id)!;
    expect(journal.status).toBe('interrupted');
    expect(journal.phase).toBe('stops');
    expect(journal.phases.slice(-1)[0]).toMatchObject({ name: 'stops', status: 'interrupted' });
    expect((journal.interrupted as any).affected_ids).toEqual([222]);
    // 111 was already stopped when the timeout hit, and the journal says so.
    expect(journal.recipes.find((r) => r.recipe_id === 111)!.stopped).toBe(true);
    // Nothing was saved.
    expect(named(wk.calls, 'workato_ui_save_recipe_code')).toHaveLength(0);
  });

  test('a timeout during the save is resumable and does not create a second version', async () => {
    let stored = 3;
    const wk = makeWorkato({
      running: { 111: true },
      versions: { 999: 3 },
      throwOnce: { name: 'workato_ui_save_recipe_code' },
      save: (args, attempt) => {
        // The first attempt timed out inside the bridge but LANDED in Workato,
        // which is exactly the case the version lock exists for.
        stored = 4;
        return okText({
          recipe_id: args.recipe_id,
          version_no: stored,
          base_version_no: args.expected_base_version_no,
          save_status: attempt > 1 ? 'already_applied' : undefined,
          code_errors: [],
          persisted: true,
          valid: true,
          verified: true,
        });
      },
    });

    const first = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code_path: '/tmp/r.json', dependent_recipe_ids: [111] },
      wk.call,
    );
    expect(first.isError).toBe(true);
    const operationId = parse(first).operation_id;
    const interrupted = readOperation(operationId)!;
    expect(interrupted.phase).toBe('save');
    expect(interrupted.status).toBe('interrupted');
    expect(interrupted.expected_base_version_no).toBe(3);
    expect(wk.running[111]).toBe(false);

    const outcome = await resumeSaveOperation(readOperation(operationId)!, wk.call);
    const saves = named(wk.calls, 'workato_ui_save_recipe_code');
    // Exactly one re-issue, under the journalled lock.
    expect(saves).toHaveLength(2);
    expect(saves[1].args.expected_base_version_no).toBe(3);
    expect(saves[1].args.code_path).toBe('/tmp/r.json');
    expect(saves[1].args.restart_if_running).toBe(false);
    expect((outcome.save as any).classification).toBe('already_applied');
    expect(outcome.restarted).toEqual([111]);
    expect(outcome.failed).toEqual([]);
    expect(wk.running[111]).toBe(true);
    expect(readOperation(operationId)!.status).toBe('done');
  });

  test('a timeout during the restore is finished by resume without saving again', async () => {
    const wk = makeWorkato({
      running: { 111: true },
      versions: { 999: 3 },
      throwOnce: { name: 'workato_start_recipe', recipe_id: 111 },
    });

    const first = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code_path: '/tmp/r.json', dependent_recipe_ids: [111] },
      wk.call,
    );
    const operationId = parse(first).operation_id;
    expect(readOperation(operationId)!.phase).toBe('restore');
    expect(readOperation(operationId)!.status).toBe('interrupted');

    const outcome = await resumeSaveOperation(readOperation(operationId)!, wk.call);
    expect(named(wk.calls, 'workato_ui_save_recipe_code')).toHaveLength(1);
    expect(outcome.restarted).toEqual([111]);
    expect(wk.running[111]).toBe(true);
  });

  test('resume leaves a previously stopped recipe stopped and names what it will not do', async () => {
    const wk = makeWorkato({
      running: { 111: true, 222: false },
      versions: { 999: 3 },
      throwOnce: { name: 'workato_start_recipe', recipe_id: 111 },
    });
    const first = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code_path: '/tmp/r.json', dependent_recipe_ids: [111, 222] },
      wk.call,
    );
    const operationId = parse(first).operation_id;
    const outcome = await resumeSaveOperation(readOperation(operationId)!, wk.call);
    expect(outcome.decisions.find((d) => d.recipe_id === 222)).toMatchObject({
      action: 'leave_stopped',
    });
    expect(wk.running[222]).toBe(false);
  });

  test('an inline code body cannot be re-saved on resume, and the response says so', async () => {
    const wk = makeWorkato({
      running: { 111: true },
      versions: { 999: 3 },
      throwOnce: { name: 'workato_ui_save_recipe_code' },
    });
    const first = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: { keyword: 'trigger' }, dependent_recipe_ids: [111] },
      wk.call,
    );
    const operationId = parse(first).operation_id;
    const outcome = await resumeSaveOperation(readOperation(operationId)!, wk.call);
    expect(named(wk.calls, 'workato_ui_save_recipe_code')).toHaveLength(1);
    expect(outcome.restarted).toEqual([]);
    expect(outcome.unfinished[0].reason).toMatch(/passed inline/);
    expect(outcome.notes.join(' ')).toMatch(/pass code_path/);
    expect(wk.running[111]).toBe(false);
  });
});

describe('async mode', () => {
  test('returns an operation_id first and the journal reaches done', async () => {
    const wk = makeWorkato({ running: { 111: true } });
    const immediate = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, dependent_recipe_ids: [111], async: true },
      wk.call,
    );

    expect(immediate.isError).toBe(false);
    const payload = parse(immediate);
    expect(payload.async).toBe(true);
    expect(typeof payload.operation_id).toBe('string');
    // Nothing has been saved yet at the moment the response is handed back.
    expect(named(wk.calls, 'workato_ui_save_recipe_code')).toHaveLength(0);

    let journal = readOperation(payload.operation_id)!;
    for (let i = 0; i < 200 && journal.status === 'running'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      journal = readOperation(payload.operation_id)!;
    }
    expect(journal.status).toBe('done');
    expect(journal.phase).toBe('done');
    expect(named(wk.calls, 'workato_ui_save_recipe_code')).toHaveLength(1);
    expect(wk.running[111]).toBe(true);
  });
});

describe('post-stop revalidation', () => {
  test('a caller that only the second discovery sees is stopped and reported', async () => {
    let round = 0;
    const base = makeWorkato({
      running: { 111: true, 333: true },
      callers: [],
    });
    const call = async (name: string, args: any): Promise<CallToolResult> => {
      if (name === 'workato_recipe_callers') {
        round += 1;
        const callers =
          round === 1
            ? [{ recipe_id: 111, name: 'first', running: true }]
            : [
                { recipe_id: 111, name: 'first', running: true },
                { recipe_id: 333, name: 'late', running: true },
              ];
        return okText(
          {
            recipe_id: args.recipe_id,
            sources: ['graph', 'code'],
            callers,
            unresolved_dynamic_targets: [],
            failed_reads: [],
            scope: { mode: 'folders', folder_ids: [30573643], complete: true },
            completeness: 'complete',
            completeness_reasons: [],
          },
          `${callers.length} caller(s)`,
        );
      }
      return base.call(name, args);
    };

    const result = await handleWorkatoSaveWithDependentsCall(
      'workato_recipe_save_with_dependents',
      { recipe_id: 999, code: {}, scan_folder_id: 30573643 },
      call,
    );

    const payload = parse(result);
    expect(payload.late_discovered_caller_ids).toEqual([333]);
    expect((result.content[0] as any).text).toMatch(
      /1 caller\(s\) appeared only in the post-stop revalidation: 333/,
    );
    const late = payload.dependents.find((d: any) => d.id === 333);
    expect(late.discovered_late).toBe(true);
    expect(late.stopped).toBe(true);
    expect(base.running[333]).toBe(true); // stopped for the save, then restored
  });
});
