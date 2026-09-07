/**
 * Post-build guard for the in-page function rule.
 *
 * A function handed to `chrome.scripting.executeScript` is serialized and run
 * in the Workato page, where the extension's module scope does not exist. The
 * build targets es2015, so an `async` in-page function is transpiled into a
 * PAIR: a thin `fooInPage` that forwards to a module-scope helper named
 * `_fooInPage`. Only the thin half crosses into the page; the helper stays
 * behind and the call fails in the page with a bare ReferenceError that names
 * a function nobody wrote. It cost three smoke tests to find the first time.
 *
 * The rule (CONTRIBUTING.md, docs/ARCHITECTURE.md) is therefore: in-page
 * functions are plain `function name(...)` declarations using `.then()`
 * chains. This script checks the built bundle for the shape that breaks it,
 * so the rule fails the build instead of a live call.
 *
 * Two service-worker helpers legitimately produce that shape and never reach a
 * page: `evaluateInPage` (CDP Runtime.evaluate, which takes a source STRING)
 * and `checkAssertionInPage` (record-replay, which passes an inline arrow).
 * They are allowlisted by name.
 *
 * Run: `pnpm --filter workatomcp-extension check:bundle` (also chained after
 * `wxt build`).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
// Imported rather than taken off the global, so the extension's browser-globals
// eslint config does not report `process` as undefined in this Node script.
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Async service-worker helpers that are never serialized into a page. */
export const KNOWN_SERVICE_WORKER_HELPERS = ['_evaluateInPage', '_checkAssertionInPage'];

export const DEFAULT_BUNDLE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'chrome-mv3',
  'background.js',
);

/**
 * Find transpiled in-page functions in a built bundle.
 *
 * @param {string} source Bundle text.
 * @param {string[]} [known] Helper names that are allowed to appear.
 * @returns {{ helpers: string[], generators: string[], offenders: string[] }}
 *   `helpers` are every `function _<name>InPage` declaration found,
 *   `generators` every `_asyncToGenerator(function* <name>InPage)` wrapper,
 *   `offenders` the union minus the allowlist, sorted and deduplicated.
 */
export function findInPageWrappers(source, known = KNOWN_SERVICE_WORKER_HELPERS) {
  const allowed = new Set(known);
  const helpers = new Set();
  const generators = new Set();

  const helperPattern = /function\s+(_[A-Za-z0-9_$]*InPage)\b/g;
  for (const match of source.matchAll(helperPattern)) helpers.add(match[1]);

  // `_asyncToGenerator` alone is the ordinary async helper and appears
  // hundreds of times in bundled third-party code. Only a wrapper around a
  // function whose own name ends in InPage is the defect.
  const generatorPattern = /_asyncToGenerator\(\s*function\s*\*?\s*(_?[A-Za-z0-9_$]*InPage)\b/g;
  for (const match of source.matchAll(generatorPattern)) generators.add(match[1]);

  const offenders = new Set();
  for (const name of helpers) if (!allowed.has(name)) offenders.add(name);
  for (const name of generators) {
    if (!allowed.has(name) && !allowed.has(`_${name}`)) offenders.add(name);
  }

  return {
    helpers: [...helpers].sort(),
    generators: [...generators].sort(),
    offenders: [...offenders].sort(),
  };
}

/**
 * @param {string} bundlePath
 * @returns {{ ok: boolean, message: string, offenders: string[] }}
 */
export function checkBundleFile(bundlePath = DEFAULT_BUNDLE) {
  let source;
  try {
    source = readFileSync(bundlePath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      offenders: [],
      message:
        `check:bundle could not read ${bundlePath}: ${error.message}\n` +
        'Build the extension first (pnpm build:extension).',
    };
  }

  const { helpers, offenders } = findInPageWrappers(source);
  if (offenders.length === 0) {
    return {
      ok: true,
      offenders: [],
      message:
        `check:bundle: no transpiled in-page functions in ${path.basename(bundlePath)} ` +
        `(allowlisted service-worker helpers present: ${helpers.join(', ') || 'none'}).`,
    };
  }

  return {
    ok: false,
    offenders,
    message:
      `check:bundle FAILED: ${offenders.length} transpiled in-page function(s) in ` +
      `${bundlePath}:\n` +
      offenders.map((name) => `  ${name}`).join('\n') +
      '\n\nAn in-page function must be a plain `function name(...)` declaration using ' +
      '.then() chains, with every helper nested inside it and no module-scope references. ' +
      'Remove async/await from the function(s) above and rebuild. ' +
      'See CONTRIBUTING.md and docs/ARCHITECTURE.md.',
  };
}

function main() {
  const bundlePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_BUNDLE;
  const result = checkBundleFile(bundlePath);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
