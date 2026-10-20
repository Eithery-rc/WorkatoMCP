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
 * One service-worker helper legitimately produces that shape and never reaches
 * a page: `evaluateInPage` (CDP Runtime.evaluate, which takes a source STRING).
 * It is allowlisted by name.
 *
 * It also fails a build that carries MCP tool schemas anywhere in the
 * extension (countToolSchemas): they belong to the bridge and cost about 300 KB
 * per bundle that picks them up.
 *
 * Run: `pnpm --filter workatomcp-extension check:bundle` (also chained after
 * `wxt build`).
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
// Imported rather than taken off the global, so the extension's browser-globals
// eslint config does not report `process` as undefined in this Node script.
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Async service-worker helpers that are never serialized into a page. */
export const KNOWN_SERVICE_WORKER_HELPERS = ['_evaluateInPage'];

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

/**
 * Count MCP tool schemas (`inputSchema: { type: "object"`) in built source.
 * The schemas belong to the bridge; the extension needs tool names only. A
 * top-level spread over the schemas in the shared package, or reading one
 * property of an object that holds them, once put all 149 into both the
 * service worker and the popup.
 *
 * @param {string} source Bundle text.
 * @returns {number}
 */
export function countToolSchemas(source) {
  return (source.match(/\binputSchema\s*:\s*\{\s*type\s*:\s*["']object["']/g) || []).length;
}

/**
 * @param {string} outputDir The built extension (dist/chrome-mv3).
 * @returns {{ ok: boolean, message: string, offenders: string[] }}
 */
export function checkNoToolSchemas(outputDir = path.dirname(DEFAULT_BUNDLE)) {
  const offenders = [];
  for (const entry of readdirSync(outputDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    const count = countToolSchemas(readFileSync(file, 'utf8'));
    if (count > 0) offenders.push(`${path.relative(outputDir, file)} (${count})`);
  }
  if (offenders.length === 0) {
    return { ok: true, offenders, message: 'check:bundle: no tool schemas in the extension.' };
  }
  return {
    ok: false,
    offenders,
    message:
      `check:bundle FAILED: tool schemas in the built extension:\n` +
      offenders.map((name) => `  ${name}`).join('\n') +
      '\n\nThe extension needs tool names only. Import names (TOOL_NAMES, WORKATO_MODULE_ID) ' +
      'rather than schemas or objects holding them, and keep top-level code in ' +
      'packages/shared free of side effects.',
  };
}

function main() {
  const bundlePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_BUNDLE;
  let failed = false;
  for (const result of [
    checkBundleFile(bundlePath),
    checkNoToolSchemas(path.dirname(bundlePath)),
  ]) {
    if (result.ok) {
      console.log(result.message);
    } else {
      console.error(result.message);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
