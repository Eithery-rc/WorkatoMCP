import { describe, expect, test } from '@jest/globals';

import {
  checkPyEvalSource,
  collectAssignedNames,
  compilePythonSource,
  describePyEvalFailure,
  lintPyEvalSource,
  stripPythonSource,
} from './pyeval-lint';

describe('stripPythonSource', () => {
  test('blanks strings and comments so brackets inside them do not count', () => {
    const { bracketDepth, unbalancedAt } = stripPythonSource('x = "((("  # )))\ny = 1\n');
    expect(bracketDepth).toBe(0);
    expect(unbalancedAt).toBeNull();
  });

  test('tracks triple-quoted strings across lines', () => {
    const res = stripPythonSource('doc = """\nnot code (\n"""\ny = 1\n');
    expect(res.unterminatedString).toBeNull();
    expect(res.bracketDepth).toBe(0);
  });

  test('reports an unterminated triple quote', () => {
    expect(stripPythonSource('doc = """\nstill open\n').unterminatedString).toBe(1);
  });

  test('marks continuation lines so they are not indent-checked', () => {
    const { lines } = stripPythonSource('x = [\n    1,\n    2,\n]\n');
    expect(lines[1].depthBefore).toBeGreaterThan(0);
  });

  test('expands tabs to the next multiple of 8, as CPython does', () => {
    const { lines } = stripPythonSource('if x:\n\ty = 1\n');
    expect(lines[1].indent).toBe(8);
    expect(lines[1].leadingTab).toBe(true);
  });
});

describe('collectAssignedNames', () => {
  test('finds plain, augmented, tuple and loop bindings at statement level', () => {
    const { lines } = stripPythonSource(
      ['rows = []', 'total += 1', 'a, b = 1, 2', 'for item in xs:', '    pass'].join('\n'),
    );
    const names = collectAssignedNames(lines);
    expect([...names.keys()].sort()).toEqual(['a', 'b', 'item', 'rows', 'total']);
  });

  test('does not mistake a comparison for an assignment', () => {
    const { lines } = stripPythonSource('if rows == []:\n    pass\n');
    expect(collectAssignedNames(lines).has('rows')).toBe(false);
  });
});

describe('lintPyEvalSource', () => {
  test('accepts ordinary code', () => {
    const src = [
      'rows = data.get("rows", [])',
      'out = []',
      'for r in rows:',
      '    out.append(r)',
    ].join('\n');
    expect(lintPyEvalSource(src).errors).toEqual([]);
  });

  test('catches the bad-indent injection a wrong string replace produces', () => {
    // `rows = []` landed inside the if-suite at the wrong level.
    const src = ['if flag:', '    a = 1', '  rows = []', ''].join('\n');
    const { errors } = lintPyEvalSource(src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/unindent does not match/);
    expect(errors[0].line).toBe(3);
  });

  test('catches an unexpected indent, an empty block, and unbalanced brackets', () => {
    expect(lintPyEvalSource('a = 1\n    b = 2\n').errors[0].message).toMatch(/unexpected indent/);
    expect(lintPyEvalSource('if x:\n').errors[0].message).toMatch(/no body/);
    expect(lintPyEvalSource('if x:\ny = 1\n').errors[0].message).toMatch(/empty/);
    expect(lintPyEvalSource('x = foo(1, 2\n').errors[0].message).toMatch(/left open/);
    expect(lintPyEvalSource('x = 1)\n').errors[0].message).toMatch(/no matching opener/);
  });

  test('flags tabs and spaces only where CPython raises TabError', () => {
    const tabError = (src: string) =>
      lintPyEvalSource(src).errors.some((e) => /tabs and spaces/.test(e.message));
    // A tab and eight spaces in one block: equal at tab size 8, not at tab size 1.
    expect(tabError(['if a:', '        x = 1', '\ty = 2', ''].join('\n'))).toBe(true);
    // Separate blocks, and spaces followed by a tab one level deeper: CPython accepts both.
    expect(tabError(['if a:', '    x = 1', 'if b:', '\ty = 2', ''].join('\n'))).toBe(false);
    expect(
      lintPyEvalSource(['if a:', '  if b:', '  \tx = 1', '  \ty = 2', ''].join('\n')).errors,
    ).toEqual([]);
  });

  test('a block opened by a multi-line or backslash-continued statement is not an unexpected indent', () => {
    const multiLine = [
      'for x in rows:',
      '    if (x.get("a") not in [None, ""] and',
      '        x.get("b") not in [None, ""]):',
      '        out.append(x)',
      '    elif (',
      '        x.get("c")',
      '    ):',
      '        pass',
      '',
    ].join('\n');
    expect(lintPyEvalSource(multiLine).errors).toEqual([]);
    const backslash = ['if a and \\', '        b:', '    x = 1', ''].join('\n');
    expect(lintPyEvalSource(backslash).errors).toEqual([]);
  });

  test('a real Python decides; the lint only decides when there is none', () => {
    const flagged = 'a = 1\n    b = 2\n';
    const accepted = checkPyEvalSource(flagged, [], 'step 1', () => ({
      available: true,
      ok: true,
      interpreter: 'python3',
    }));
    expect(accepted.refusal).toBeNull();
    expect(accepted.notes[0].message).toMatch(/structural lint only; python3 compiled it/);
    const noPython = checkPyEvalSource(flagged, [], 'step 1', () => ({
      available: false,
      ok: false,
    }));
    expect(noPython.refusal).toMatch(/unexpected indent/);
    const rejected = checkPyEvalSource('x = (', [], 'step 1', () => ({
      available: true,
      ok: false,
      interpreter: 'python3',
      error: "'(' was never closed",
      line: 1,
    }));
    expect(rejected.refusal).toMatch(/Python \(python3\) rejected step 1/);
  });

  test('empty source is an error, not a silent no-op', () => {
    expect(lintPyEvalSource('   ').errors[0].message).toMatch(/empty/);
  });

  test('warns when an output shadows a code_input key — the `rows` incident', () => {
    const src = ['total = 0', 'rows = [{"a": 1}]', ''].join('\n');
    const { errors, warnings } = lintPyEvalSource(src, ['rows', 'ns_employees']);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/"rows" is a declared code_input/);
    expect(warnings[0].message).toMatch(/rows_out/);
    expect(warnings[0].line).toBe(2);
  });

  test('does not warn when the input is only read', () => {
    const { warnings } = lintPyEvalSource('table_rows = [r for r in rows]\n', ['rows']);
    expect(warnings).toEqual([]);
  });
});

describe('compilePythonSource', () => {
  const compiled = compilePythonSource('x = 1\n');

  test('either compiles for real or says it could not check', () => {
    if (compiled.available) {
      expect(compiled.ok).toBe(true);
      expect(compiled.interpreter).toBeTruthy();
    } else {
      // No interpreter on this machine: `available:false` must never read as a pass.
      expect(compiled.ok).toBe(false);
    }
  });

  test('reports a syntax error with its line number when Python is available', () => {
    if (!compiled.available) return;
    const bad = compilePythonSource('def f(:\n    pass\n');
    expect(bad.ok).toBe(false);
    expect(bad.line).toBe(1);
    expect(bad.error).toBeTruthy();
  });
});

describe('describePyEvalFailure', () => {
  test('names the refusal reason and what it means', () => {
    const text = describePyEvalFailure(
      { errors: [{ line: 3, message: 'unindent does not match' }], warnings: [] },
      { available: true, ok: false, error: 'invalid syntax', line: 3, interpreter: 'python3' },
      'step 5',
    );
    expect(text).toMatch(/refusing the save/i);
    expect(text).toMatch(/python3/);
    expect(text).toMatch(/line 3/);
  });
});
