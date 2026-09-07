/**
 * @fileoverview Tests for workato_recipe_grep: the tree walk, the match modes,
 * the snippet window, the regex guards and the continuation cursor.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SNIPPET_CHARS,
  REGEX_MAX_PATTERN_CHARS,
  buildSnippet,
  compileGrepMatcher,
  grepRecipeTree,
  riskyRegexReason,
  searchableValues,
  type GrepMatcher,
} from '@/entrypoints/background/tools/workato/recipe-grep';
import { decodeCursor } from '@/entrypoints/background/tools/workato/recipe-projection';
import type { RawNode } from '@/entrypoints/background/tools/workato/recipe-view';

const PILL =
  '{"pill_type":"output","provider":"py_eval","line":"e4f443bd","path":["output","total"]}';

function sampleCode(): RawNode {
  return {
    number: 0,
    keyword: 'trigger',
    provider: 'clock',
    name: 'scheduled_event',
    as: 'trigger00',
    title: 'Every night',
    input: { interval: 'daily' },
    block: [
      {
        number: 1,
        keyword: 'action',
        provider: 'netsuite',
        name: 'create_record',
        as: 'ns01',
        description: 'Create a <span class="provider">journal entry</span>',
        input: {
          record_type: 'journalentry',
          subsidiary_id: '17',
          memo: `total #{_dp('${PILL}')}`,
        },
        extended_input_schema: [
          { name: 'subsidiary_id', label: 'Subsidiary internal id', type: 'string' },
          { name: 'memo', label: 'Memo', type: 'string' },
        ],
      },
      {
        number: 2,
        keyword: 'foreach',
        as: 'loop02',
        repeat_mode: 'simple',
        source: `#{_dp('${PILL}')}`,
        input: {},
        block: [
          {
            number: 3,
            keyword: 'action',
            provider: 'logger',
            name: 'log_message',
            as: 'log03',
            input: { message: 'subsidiary_id done' },
          },
        ],
      },
    ],
  };
}

function matcher(query: string, mode: 'substring' | 'word' | 'regex' = 'substring'): GrepMatcher {
  const compiled = compileGrepMatcher(query, mode);
  if (!compiled.ok) throw new Error(compiled.error);
  return compiled.matcher;
}

describe('searchableValues', () => {
  it('covers input, titles, descriptions, source and schemas in scope "all"', () => {
    const node = sampleCode().block![0];
    const paths = searchableValues(node, 'all').map((v) => v.path);
    expect(paths).toContain('description');
    expect(paths).toContain('input.record_type');
    expect(paths).toContain('extended_input_schema[0].label');
  });

  it('covers input only in scope "input"', () => {
    const node = sampleCode().block![0];
    const paths = searchableValues(node, 'input').map((v) => v.path);
    expect(paths.every((p) => p.startsWith('input.'))).toBe(true);
  });

  it('includes the foreach source, which is a node-root key', () => {
    const loop = sampleCode().block![1];
    expect(searchableValues(loop, 'all').map((v) => v.path)).toContain('source');
  });

  it('includes the callee name of a call_recipe step, which lives outside input', () => {
    // input.flow_id is the id; the NAME exists only in dynamicPickListSelection.
    const call: RawNode = {
      number: 4,
      keyword: 'action',
      provider: 'workato_recipe_function',
      name: 'call_recipe',
      as: 'tjexp01',
      input: { flow_id: '76902508', parameters: { DryRun: 'true' } },
      dynamicPickListSelection: { flow_id: 'Time Journal Engine (callable)' },
    };
    const values = searchableValues(call, 'all');
    expect(values.map((v) => v.path)).toContain('dynamicPickListSelection.flow_id');
    const hit = grepRecipeTree(call, matcher('Time Journal Engine'));
    expect(hit.matches.map((m) => m.path)).toEqual(['dynamicPickListSelection.flow_id']);
  });

  it('includes the job report columns on the trigger node', () => {
    const trigger: RawNode = {
      number: 0,
      keyword: 'trigger',
      provider: 'clock',
      as: 'trigger00',
      input: { interval: 'daily' },
      job_report_schema: [{ name: 'custom_column_0', label: 'Marker code' }],
      job_report_config: { custom_column_0: 'GIRAFFE-4412 static' },
    };
    const paths = searchableValues(trigger, 'all').map((v) => v.path);
    expect(paths).toContain('job_report_schema[0].label');
    expect(paths).toContain('job_report_config.custom_column_0');
    expect(grepRecipeTree(trigger, matcher('GIRAFFE-4412')).total_matches).toBe(1);
  });
});

describe('grepRecipeTree', () => {
  it('finds a field value in input with the step identity and path', () => {
    const result = grepRecipeTree(sampleCode(), matcher('journalentry'));
    expect(result.total_matches).toBe(1);
    const hit = result.matches[0];
    expect(hit.step).toMatchObject({
      number: 1,
      as: 'ns01',
      keyword: 'action',
      provider: 'netsuite',
      name: 'create_record',
    });
    expect(hit.path).toBe('input.record_type');
    expect(hit.snippet).toBe('journalentry');
    expect(hit.value_chars).toBe('journalentry'.length);
  });

  it('finds a schema label and reports its indexed path', () => {
    const result = grepRecipeTree(sampleCode(), matcher('Subsidiary internal'));
    expect(result.matches.map((m) => m.path)).toEqual(['extended_input_schema[0].label']);
    expect(result.matches[0].snippet).toBe('Subsidiary internal id');
  });

  it('matches a datapill by its raw line id', () => {
    const result = grepRecipeTree(sampleCode(), matcher('e4f443bd'));
    expect(result.matches.map((m) => m.path).sort()).toEqual(['input.memo', 'source']);
  });

  it('is case-insensitive by default', () => {
    expect(grepRecipeTree(sampleCode(), matcher('JOURNALENTRY')).total_matches).toBe(1);
  });

  it('word mode does not match inside a longer token', () => {
    const substring = grepRecipeTree(sampleCode(), matcher('subsidiary_id'));
    expect(substring.total_matches).toBeGreaterThan(1);
    const word = grepRecipeTree(sampleCode(), matcher('done', 'word'));
    expect(word.matches.map((m) => m.path)).toEqual(['input.message']);
    expect(grepRecipeTree(sampleCode(), matcher('one', 'word')).total_matches).toBe(0);
  });

  it('regex mode matches a pattern', () => {
    const result = grepRecipeTree(sampleCode(), matcher('journal\\w+', 'regex'));
    expect(result.matches.map((m) => m.path)).toEqual(['input.record_type']);
  });

  it('restricts the scope to input when asked', () => {
    const result = grepRecipeTree(sampleCode(), matcher('Subsidiary internal'), {
      scope: 'input',
    });
    expect(result.total_matches).toBe(0);
  });

  it('reports nothing but the matches', () => {
    const result = grepRecipeTree(sampleCode(), matcher('no-such-value'));
    expect(result.matches).toEqual([]);
    expect(result.total_matches).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.steps_scanned).toBe(4);
  });

  it('limits matches and continues from the cursor without repeats', () => {
    const code = sampleCode();
    const first = grepRecipeTree(code, matcher('subsidiary_id'), { maxMatches: 1 });
    expect(first.matches).toHaveLength(1);
    expect(first.truncated).toBe(true);
    const state = decodeCursor(first.next_cursor!)!;
    const second = grepRecipeTree(code, matcher('subsidiary_id'), {
      maxMatches: 50,
      offset: state.o.matches,
    });
    expect(second.truncated).toBe(false);
    const paths = [...first.matches, ...second.matches].map((m) => m.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(first.total_matches);
  });
});

describe('buildSnippet', () => {
  it('returns a short value whole', () => {
    expect(buildSnippet('short', 0, 5, DEFAULT_SNIPPET_CHARS)).toBe('short');
  });

  it('windows a long value around the match', () => {
    const value = `${'a'.repeat(500)}NEEDLE${'b'.repeat(500)}`;
    const snippet = buildSnippet(value, 500, 6, 40);
    expect(snippet).toContain('NEEDLE');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(42);
  });
});

describe('regex guards', () => {
  it('refuses a pattern longer than the limit', () => {
    const long = 'a'.repeat(REGEX_MAX_PATTERN_CHARS + 1);
    expect(riskyRegexReason(long)).toContain('the limit is');
    const compiled = compileGrepMatcher(long, 'regex');
    expect(compiled.ok).toBe(false);
  });

  it('refuses a nested quantifier', () => {
    expect(riskyRegexReason('(a+)+')).toContain('backtrack');
    expect(riskyRegexReason('(?:\\d+){2,}')).toContain('backtrack');
    expect(riskyRegexReason('(a|b)+')).toBeNull();
  });

  it('returns a clear error for an invalid regex', () => {
    const compiled = compileGrepMatcher('([unclosed', 'regex');
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.error).toContain('Invalid regex pattern');
  });

  it('refuses an empty query', () => {
    expect(compileGrepMatcher('', 'substring').ok).toBe(false);
  });
});
