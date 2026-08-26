/**
 * @fileoverview Tests for the save refusal on a corrupt `_dp('...')` payload,
 * and for the read-only allowlist gate on workato_call_action.
 */

import { describe, expect, it } from 'vitest';

import {
  describeBrokenDatapills,
  findBrokenDatapills,
  normalizeCodeTree,
} from '@/entrypoints/background/tools/workato-ui/save-guards';
import { isReadAction } from '@/entrypoints/background/tools/workato/call-action';

const GOOD = `#{_dp('{"pill_type":"output","provider":"py_eval","line":"1616311d","path":["email"]}')}`;
// What a regex that cut across the pill boundary leaves behind: the payload's
// own comma split it, so the JSON never closes.
const TRUNCATED = `#{_dp('{"pill_type":"output","provider":"py_eval","line":"1616311d","path":["ema')}`;

describe('findBrokenDatapills', () => {
  it('passes a valid pill', () => {
    expect(findBrokenDatapills(GOOD)).toEqual([]);
  });

  it('passes a json.dumps-spaced pill — that one is normalized, not rejected', () => {
    const spaced = `#{_dp('{"pill_type": "output", "provider": "p", "line": "L", "path": ["a"]}')}`;
    expect(findBrokenDatapills(spaced)).toEqual([]);
  });

  it('catches a payload truncated mid-JSON', () => {
    const broken = findBrokenDatapills(TRUNCATED);
    expect(broken).toHaveLength(1);
    expect(broken[0].payload).toContain('"path":["ema');
    expect(broken[0].error).toBeTruthy();
  });

  it('walks a whole code tree and reports each distinct break once', () => {
    const tree = {
      input: { a: GOOD, b: TRUNCATED },
      block: [{ input: { c: TRUNCATED } }, { input: { d: `#{_dp('nope')}` } }],
    };
    const broken = findBrokenDatapills(tree);
    expect(broken).toHaveLength(2);
  });

  it('reaches pills inside a stringified tree', () => {
    const stringified = JSON.stringify({ input: { a: TRUNCATED } });
    expect(findBrokenDatapills(stringified)).toHaveLength(1);
  });

  it('normalizeCodeTree leaves a broken pill alone — hence the separate guard', () => {
    const { code, normalized } = normalizeCodeTree({ input: { a: TRUNCATED } });
    expect(normalized).toBe(0);
    expect((code as any).input.a).toBe(TRUNCATED);
    expect(findBrokenDatapills(code)).toHaveLength(1);
  });

  it('explains the failure and points at the fix', () => {
    const text = describeBrokenDatapills(findBrokenDatapills(TRUNCATED));
    expect(text).toMatch(/Refusing the save/);
    expect(text).toMatch(/resolve them to an empty value/);
    expect(text).toMatch(/workato_datapill/);
  });
});

describe('isReadAction', () => {
  it('treats run_suiteql as the read it is', () => {
    // Named run_*, so the prefix list called it a write and every schema probe
    // had to pass allow_writes:true.
    expect(isReadAction('run_suiteql', {})).toBe(true);
    expect(isReadAction('RUN_SUITEQL', {})).toBe(true);
    expect(isReadAction('execute_suiteql', {})).toBe(true);
    expect(isReadAction('run_query', {})).toBe(true);
  });

  it('still allows the read prefixes', () => {
    for (const name of ['search_sobjects', 'get_record', 'list_files', 'describe_object']) {
      expect(isReadAction(name, {})).toBe(true);
    }
  });

  it('still gates genuine writes', () => {
    for (const name of ['batch_upsert_rest', 'create_record', 'run_script', 'delete_record']) {
      expect(isReadAction(name, {})).toBe(false);
    }
  });

  it('gates adhoc http by verb', () => {
    expect(isReadAction('__adhoc_http_action', { verb: 'get' })).toBe(true);
    expect(isReadAction('__adhoc_http_action', { verb: 'post' })).toBe(false);
  });
});
