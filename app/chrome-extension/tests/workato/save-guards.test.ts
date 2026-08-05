/**
 * @fileoverview Tests for the save-time guards: datapill normalization and the
 * sent-vs-persisted tree diff that catches Workato's silent input strip.
 */

import { describe, expect, it } from 'vitest';

import {
  describeMissing,
  diffPersistedTree,
  isFullyPersisted,
  normalizeCodeTree,
  normalizeDatapills,
  ISSUE_CAP,
} from '@/entrypoints/background/tools/workato-ui/save-guards';

const pill = (json: string) => `#{_dp('${json}')}`;

const COMPACT = '{"pill_type":"output","provider":"py_eval","line":"1616311d","path":["email"]}';
const SPACED =
  '{"pill_type": "output", "provider": "py_eval", "line": "1616311d", "path": ["email"]}';

describe('normalizeDatapills', () => {
  it('compacts a json.dumps-style pill payload', () => {
    const { value, normalized } = normalizeDatapills(pill(SPACED));
    expect(value).toBe(pill(COMPACT));
    expect(normalized).toBe(1);
  });

  it('leaves an already-compact pill byte-for-byte alone', () => {
    const { value, normalized } = normalizeDatapills(pill(COMPACT));
    expect(value).toBe(pill(COMPACT));
    expect(normalized).toBe(0);
  });

  it('walks nested structures and counts every rewrite', () => {
    const { value, normalized } = normalizeDatapills({
      input: {
        to: pill(SPACED),
        cc: ['literal', pill(SPACED)],
        nested: { subject: `Hello ${pill(SPACED)} and ${pill(COMPACT)}` },
      },
    });
    expect(normalized).toBe(3);
    expect(JSON.stringify(value)).not.toContain('": "');
  });

  it('preserves surrounding text and multiple pills in one string', () => {
    const { value } = normalizeDatapills(`a ${pill(SPACED)} b ${pill(SPACED)} c`);
    expect(value).toBe(`a ${pill(COMPACT)} b ${pill(COMPACT)} c`);
  });

  it('keeps spaces that live inside string values', () => {
    const spaced =
      '{"pill_type": "output", "provider": "py_eval", "line": "a1", "path": ["client email"]}';
    const { value } = normalizeDatapills(pill(spaced));
    expect(value).toContain('"client email"');
    expect(value).not.toContain('": ');
  });

  it('leaves an unparseable payload untouched', () => {
    const broken = pill('{not json');
    const { value, normalized } = normalizeDatapills(broken);
    expect(value).toBe(broken);
    expect(normalized).toBe(0);
  });

  it('round-trips escaped single quotes', () => {
    const escaped = `{"pill_type": "output", "provider": "p", "line": "l", "path": ["o\\'brien"]}`;
    const { value, normalized } = normalizeDatapills(pill(escaped));
    expect(normalized).toBe(1);
    expect(value).toContain("o\\'brien");
    expect(value).not.toContain('": ');
  });
});

describe('normalizeCodeTree', () => {
  it('normalizes a tree passed as a JSON string and returns a string', () => {
    const tree = JSON.stringify({ input: { to: pill(SPACED) } });
    const { code, normalized } = normalizeCodeTree(tree);

    expect(normalized).toBe(1);
    expect(typeof code).toBe('string');
    expect(JSON.parse(code as string).input.to).toBe(pill(COMPACT));
  });

  it('returns the original string untouched when nothing needed rewriting', () => {
    const tree = JSON.stringify({ input: { to: pill(COMPACT) } });
    const { code, normalized } = normalizeCodeTree(tree);

    expect(normalized).toBe(0);
    expect(code).toBe(tree);
  });

  it('normalizes an object tree and returns an object', () => {
    const { code, normalized } = normalizeCodeTree({ input: { to: pill(SPACED) } });

    expect(normalized).toBe(1);
    expect((code as any).input.to).toBe(pill(COMPACT));
  });

  it('falls back to a string pass for a non-JSON payload', () => {
    const { code, normalized } = normalizeCodeTree(`prefix ${pill(SPACED)}`);

    expect(normalized).toBe(1);
    expect(code).toBe(`prefix ${pill(COMPACT)}`);
  });
});

describe('diffPersistedTree', () => {
  const sent = {
    number: 0,
    as: 'trigger00',
    provider: 'scheduler',
    input: { when: 'every_hour' },
    block: [
      {
        number: 1,
        as: '1616311d',
        provider: 'py_eval',
        name: 'invoke_custom_py_code',
        input: {
          code: 'def main(input):\n  return {}',
          code_input: { data: { client_email: 'a@b.c', amount: 12 } },
        },
      },
    ],
  };

  it('reports nothing when the stored tree carries everything', () => {
    const diff = diffPersistedTree(sent, structuredClone(sent));
    expect(diff.missing).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(isFullyPersisted(diff)).toBe(true);
  });

  it('catches a silently stripped dynamic input key', () => {
    const persisted = structuredClone(sent);
    delete (persisted.block[0].input as any).code_input;

    const diff = diffPersistedTree(sent, persisted);
    expect(diff.missing).toHaveLength(1);
    expect(diff.missing[0]).toMatchObject({
      kind: 'missing',
      step_number: 1,
      step_as: '1616311d',
      provider: 'py_eval',
      path: 'code_input',
    });
    expect(isFullyPersisted(diff)).toBe(false);
  });

  it('reports leaf keys when only part of a structure survives', () => {
    const persisted = structuredClone(sent);
    delete (persisted.block[0].input as any).code_input.data.client_email;

    const diff = diffPersistedTree(sent, persisted);
    expect(diff.missing.map((i) => i.path)).toEqual(['code_input.data.client_email']);
  });

  it('ignores values Workato legitimately prunes', () => {
    const withEmpties = structuredClone(sent);
    (withEmpties.block[0].input as any).custom_fields = {};
    (withEmpties.block[0].input as any).tags = [];
    (withEmpties.block[0].input as any).note = '';

    const diff = diffPersistedTree(withEmpties, sent);
    expect(diff.missing).toEqual([]);
  });

  it('ignores keys Workato adds on its own', () => {
    const persisted = structuredClone(sent);
    (persisted.block[0].input as any).server_default = 'added by workato';

    expect(isFullyPersisted(diffPersistedTree(sent, persisted))).toBe(true);
  });

  it('reports a value stored under a different value as changed, not missing', () => {
    const persisted = structuredClone(sent);
    (persisted.block[0].input as any).code_input.data.amount = 99;

    const diff = diffPersistedTree(sent, persisted);
    expect(diff.missing).toEqual([]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]).toMatchObject({ path: 'code_input.data.amount', sent: 12, saved: 99 });
  });

  it('reports a whole dropped step', () => {
    const persisted = { ...structuredClone(sent), block: [] };

    const diff = diffPersistedTree(sent, persisted);
    expect(diff.missing).toHaveLength(1);
    expect(diff.missing[0].kind).toBe('step_missing');
  });

  it('flags an identity mismatch instead of diffing two unrelated steps', () => {
    const persisted = structuredClone(sent);
    persisted.block[0].as = 'deadbeef';

    const diff = diffPersistedTree(sent, persisted);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].kind).toBe('step_mismatch');
    expect(diff.missing).toEqual([]);
  });

  it('walks nested blocks', () => {
    const nested = {
      number: 0,
      as: 't',
      block: [
        {
          number: 1,
          as: 'ifstep',
          keyword: 'if',
          block: [{ number: 2, as: 'inner', input: { parameters: { flow_code: 'X' } } }],
        },
      ],
    };
    const persisted = structuredClone(nested);
    delete (persisted.block[0].block[0].input as any).parameters;

    const diff = diffPersistedTree(nested, persisted);
    expect(diff.missing).toHaveLength(1);
    expect(diff.missing[0]).toMatchObject({ step_as: 'inner', path: 'parameters' });
  });

  it('caps the issue list and marks the diff truncated', () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < ISSUE_CAP + 10; i += 1) many[`field_${i}`] = `value ${i}`;
    const diff = diffPersistedTree({ as: 'a', input: many }, { as: 'a', input: {} });

    expect(diff.missing).toHaveLength(ISSUE_CAP);
    expect(diff.truncated).toBe(true);
    expect(isFullyPersisted(diff)).toBe(false);
  });
});

describe('describeMissing', () => {
  it('names the steps, the paths, and the fix', () => {
    const diff = diffPersistedTree(
      { as: 'a', number: 3, input: { parameters: { flow_code: 'X' } } },
      { as: 'a', number: 3, input: {} },
    );
    const text = describeMissing(diff);

    expect(text).toContain('step 3 (a)');
    expect(text).toContain('parameters');
    expect(text).toContain('extended_input_schema');
    expect(text).toContain('workato_recipe_set_extended_schema');
  });
});
