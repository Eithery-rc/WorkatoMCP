/**
 * Python validation for `py_eval` steps.
 *
 * Two failures motivated this, both of which saved cleanly and then blew up (or
 * worse, silently produced wrong data) at runtime:
 *
 *  1. **IndentationError from a string replace that hit the wrong occurrence.**
 *     Replacing `'    rows = []\n'` also matched `'        rows = []'` at a
 *     deeper indent, injecting a statement into the middle of an `if`.
 *  2. **An output variable shadowing a `code_input` key.** The step declared an
 *     input `rows`, the output-building code reused the name `rows`, and the
 *     result was wrong data with no error anywhere.
 *
 * ## Where each check runs
 *
 * Everything in this file runs in the **native-server** (Node), not in the
 * extension: the extension's page context has no Python and no `child_process`.
 *
 *  - `lintPyEvalSource` is pure TypeScript and always runs.
 *  - `compilePythonSource` shells out to a real `python3`/`python` when one is
 *    on PATH. That is the only check that can claim "this compiles"; when no
 *    interpreter is found it reports `available: false` and says so rather than
 *    implying the source was verified.
 */

import { execFileSync } from 'child_process';

export interface PyLintIssue {
  line: number;
  message: string;
}

export interface PyLintResult {
  /** Hard failures — the source will not run. */
  errors: PyLintIssue[];
  /** Suspicious but legal — reported, never blocking. */
  warnings: PyLintIssue[];
}

/** A source line with strings and comments blanked out, for structural checks. */
interface StrippedLine {
  /** 1-based line number. */
  line: number;
  /** Original text. */
  raw: string;
  /** Code with string bodies and comments replaced by spaces. */
  code: string;
  /** Leading-whitespace width, tabs expanded to 8 (CPython's rule). */
  indent: number;
  /** True when the line is blank or comment-only. */
  ignorable: boolean;
  /** Bracket depth *before* this line — >0 means it continues the previous one. */
  depthBefore: number;
  /** True when this line uses a tab in its leading whitespace. */
  leadingTab: boolean;
}

const TRIPLE_QUOTES = ['"""', "'''"];

/**
 * Blank out string literals and comments so bracket/indent analysis is not
 * fooled by a `#` or a `(` inside a string. Tracks triple-quoted strings and
 * bracket continuation across lines.
 */
export function stripPythonSource(source: string): {
  lines: StrippedLine[];
  unterminatedString: number | null;
  bracketDepth: number;
  unbalancedAt: number | null;
} {
  const rawLines = source.split(/\r?\n/);
  const out: StrippedLine[] = [];
  let inTriple: string | null = null;
  let tripleStartLine = 0;
  let depth = 0;
  let unbalancedAt: number | null = null;

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const depthBefore = depth;
    let code = '';
    let j = 0;
    let quote: string | null = null; // single-line string delimiter

    while (j < raw.length) {
      const rest = raw.slice(j);

      if (inTriple) {
        const end = rest.indexOf(inTriple);
        if (end === -1) {
          code += ' '.repeat(rest.length);
          j = raw.length;
        } else {
          code += ' '.repeat(end + inTriple.length);
          j += end + inTriple.length;
          inTriple = null;
        }
        continue;
      }

      if (quote) {
        if (rest.startsWith('\\')) {
          code += '  ';
          j += 2;
          continue;
        }
        if (rest.startsWith(quote)) {
          code += ' ';
          j += 1;
          quote = null;
          continue;
        }
        code += ' ';
        j += 1;
        continue;
      }

      const triple = TRIPLE_QUOTES.find((q) => rest.startsWith(q));
      if (triple) {
        inTriple = triple;
        tripleStartLine = i + 1;
        code += ' '.repeat(triple.length);
        j += triple.length;
        continue;
      }

      const ch = raw[j];
      if (ch === '#') {
        code += ' '.repeat(raw.length - j);
        break;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        code += ' ';
        j += 1;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      if (ch === ')' || ch === ']' || ch === '}') {
        depth -= 1;
        if (depth < 0 && unbalancedAt === null) unbalancedAt = i + 1;
      }
      code += ch;
      j += 1;
    }

    // An unclosed single-line quote is a syntax error unless the line is a
    // backslash continuation; treat it as one and let Python confirm.
    if (quote !== null && !raw.trimEnd().endsWith('\\')) {
      out.push({
        line: i + 1,
        raw,
        code,
        indent: 0,
        ignorable: false,
        depthBefore,
        leadingTab: false,
      });
      return {
        lines: out,
        unterminatedString: i + 1,
        bracketDepth: depth,
        unbalancedAt,
      };
    }

    const leading = /^[ \t]*/.exec(raw)?.[0] ?? '';
    let indent = 0;
    for (const ch of leading) indent += ch === '\t' ? 8 - (indent % 8) : 1;

    out.push({
      line: i + 1,
      raw,
      code,
      indent,
      ignorable: code.trim().length === 0,
      depthBefore,
      leadingTab: leading.includes('\t'),
    });
  }

  return {
    lines: out,
    unterminatedString: inTriple ? tripleStartLine : null,
    bracketDepth: depth,
    unbalancedAt,
  };
}

/** Names assigned at statement level, with the line each assignment sits on. */
export function collectAssignedNames(lines: StrippedLine[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const record = (name: string, line: number): void => {
    const hits = out.get(name) ?? [];
    hits.push(line);
    out.set(name, hits);
  };

  for (const l of lines) {
    if (l.ignorable || l.depthBefore > 0) continue;
    const code = l.code;

    // `name = ...` / `name: type = ...` / `name += ...`, one target or several.
    const assign =
      /^\s*([A-Za-z_][\w\s,]*?)\s*(?::[^=]+)?(?:\+|-|\*|\/|\/\/|%|\*\*|\||&|\^|>>|<<)?=(?!=)/.exec(
        code,
      );
    if (assign) {
      for (const part of assign[1].split(',')) {
        const name = part.trim();
        if (/^[A-Za-z_]\w*$/.test(name)) record(name, l.line);
      }
      continue;
    }
    // `for name in ...` binds too, and is a common accidental shadow.
    const loop = /^\s*for\s+([A-Za-z_][\w\s,]*?)\s+in\s/.exec(code);
    if (loop) {
      for (const part of loop[1].split(',')) {
        const name = part.trim();
        if (/^[A-Za-z_]\w*$/.test(name)) record(name, l.line);
      }
    }
  }
  return out;
}

/**
 * Structural + shadowing lint. Pure, so it runs everywhere and is testable
 * without a Python interpreter.
 *
 * `codeInputKeys` are the step's declared inputs; in a py_eval step those
 * arrive as variables of the same name, so any re-assignment shadows the input.
 */
export function lintPyEvalSource(source: string, codeInputKeys: string[] = []): PyLintResult {
  const errors: PyLintIssue[] = [];
  const warnings: PyLintIssue[] = [];

  if (source.trim().length === 0) {
    return { errors: [{ line: 1, message: 'py_eval code is empty' }], warnings };
  }

  const { lines, unterminatedString, bracketDepth, unbalancedAt } = stripPythonSource(source);

  if (unbalancedAt !== null) {
    errors.push({ line: unbalancedAt, message: 'closing bracket with no matching opener' });
  }
  if (unterminatedString !== null) {
    errors.push({ line: unterminatedString, message: 'unterminated string literal' });
  }
  if (bracketDepth > 0 && unbalancedAt === null) {
    errors.push({
      line: lines.length,
      message: `${bracketDepth} bracket(s) left open at end of file`,
    });
  }

  // Indentation. CPython rejects a dedent that lands between levels, and
  // rejects tabs mixed with spaces — both are exactly what a bad string
  // replace produces.
  const usesSpaces = lines.some((l) => !l.ignorable && !l.leadingTab && l.indent > 0);
  const stack: number[] = [0];
  let expectIndent = 0; // line number of a `:` awaiting its suite
  for (const l of lines) {
    if (l.ignorable || l.depthBefore > 0) continue;

    if (l.leadingTab && usesSpaces) {
      errors.push({
        line: l.line,
        message: 'inconsistent use of tabs and spaces in indentation',
      });
    }

    const top = stack[stack.length - 1];
    if (l.indent > top) {
      if (expectIndent === 0) {
        errors.push({
          line: l.line,
          message: `unexpected indent (line is indented ${l.indent}, enclosing block is ${top}, and the previous statement does not open a block)`,
        });
      }
      stack.push(l.indent);
    } else {
      while (stack.length > 1 && l.indent < stack[stack.length - 1]) stack.pop();
      if (l.indent !== stack[stack.length - 1]) {
        errors.push({
          line: l.line,
          message: `unindent does not match any outer indentation level (got ${l.indent}, open levels are ${stack.join(', ')})`,
        });
        stack.push(l.indent);
      }
      if (expectIndent !== 0) {
        errors.push({
          line: expectIndent,
          message: `block opened here is empty — line ${l.line} is not indented under it`,
        });
      }
    }

    const trimmed = l.code.trimEnd();
    expectIndent = trimmed.endsWith(':') ? l.line : 0;
  }
  if (expectIndent !== 0) {
    errors.push({ line: expectIndent, message: 'block opened here has no body' });
  }

  // Shadowing: the input variable and the output variable sharing a name is
  // legal Python and silently wrong data.
  if (codeInputKeys.length > 0) {
    const assigned = collectAssignedNames(lines);
    for (const key of codeInputKeys) {
      const hits = assigned.get(key);
      if (!hits || hits.length === 0) continue;
      warnings.push({
        line: hits[0],
        message:
          `"${key}" is a declared code_input, and this code assigns to it` +
          (hits.length > 1 ? ` (lines ${hits.join(', ')})` : '') +
          '. The input value is lost from that point on — rename the output variable ' +
          `(e.g. "${key}_out") if the input is still needed below.`,
      });
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Real compile
// ---------------------------------------------------------------------------

export interface PyCompileResult {
  /** False when no interpreter was found — NOT a pass. */
  available: boolean;
  ok: boolean;
  error?: string;
  line?: number;
  interpreter?: string;
}

/** Interpreters to try, in order. */
const PYTHON_CANDIDATES = ['python3', 'python'];

/**
 * Compile the source with a real Python, when one is available.
 *
 * The source is passed on stdin, never interpolated into the command line, and
 * `compile()` only parses — it does not execute the recipe's code.
 */
export function compilePythonSource(source: string): PyCompileResult {
  const script =
    'import sys\n' +
    'src = sys.stdin.read()\n' +
    'try:\n' +
    "    compile(src, 'py_eval', 'exec')\n" +
    'except SyntaxError as e:\n' +
    "    sys.stderr.write('%s|%s' % (e.lineno or 0, e.msg))\n" +
    '    sys.exit(2)\n';

  for (const interpreter of PYTHON_CANDIDATES) {
    try {
      execFileSync(interpreter, ['-c', script], {
        input: source,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10_000,
      });
      return { available: true, ok: true, interpreter };
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer | string; code?: string };
      // ENOENT means this interpreter is not installed — try the next one.
      if (err.code === 'ENOENT') continue;
      if (err.status === 2) {
        const raw = (err.stderr ?? '').toString();
        const [lineNo, ...msg] = raw.split('|');
        return {
          available: true,
          ok: false,
          interpreter,
          line: Number(lineNo) || undefined,
          error: msg.join('|').trim() || raw.trim() || 'SyntaxError',
        };
      }
      // Anything else (timeout, spawn failure) — treat as unavailable rather
      // than as a compile failure, so a broken toolchain cannot block a save.
      continue;
    }
  }
  return { available: false, ok: false };
}

/** Format lint + compile output into the error text a refusal carries. */
export function describePyEvalFailure(
  lint: PyLintResult,
  compiled: PyCompileResult | null,
  label: string,
): string {
  const parts: string[] = [];
  if (compiled && compiled.available && !compiled.ok) {
    parts.push(
      `Python (${compiled.interpreter}) rejected ${label}: ` +
        `${compiled.error}${compiled.line ? ` at line ${compiled.line}` : ''}`,
    );
  }
  for (const issue of lint.errors) parts.push(`line ${issue.line}: ${issue.message}`);
  return (
    `py_eval source does not compile — refusing the save.\n${parts.map((p) => `  ${p}`).join('\n')}\n` +
    'A save here would store code that raises at runtime, and the recipe would look ' +
    'saved-and-fine until the next job.'
  );
}
