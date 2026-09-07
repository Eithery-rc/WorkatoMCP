/**
 * @fileoverview Unit tests for the post-build in-page function guard.
 *
 * The matcher is exercised against fixture strings rather than the real
 * bundle, so a failure here points at the matcher and not at the build. The
 * real bundle is checked by `pnpm --filter workatomcp-extension check:bundle`,
 * which `wxt build` chains.
 */

import { describe, expect, it } from 'vitest';
import {
  KNOWN_SERVICE_WORKER_HELPERS,
  checkBundleFile,
  findInPageWrappers,
} from '../../scripts/check-bundle.mjs';

/** The shape es2015 transpilation produces for an async in-page function. */
const TRANSPILED_OFFENDER = `
function pullInPage(_x, _x2) {
  return _pullInPage.apply(this, arguments);
}
function _pullInPage() {
  _pullInPage = _asyncToGenerator(function* (recipeId) {
    const res = yield fetch('/recipes/' + recipeId + '.json');
    return res.json();
  });
  return _pullInPage.apply(this, arguments);
}
`;

/** The two pre-existing service-worker helpers, which never reach a page. */
const KNOWN_HELPERS_SOURCE = `
function evaluateInPage(_x, _x2) { return _evaluateInPage.apply(this, arguments); }
function _evaluateInPage() { _evaluateInPage = _asyncToGenerator(function* () {}); }
function checkAssertionInPage(_x) { return _checkAssertionInPage.apply(this, arguments); }
function _checkAssertionInPage() { _checkAssertionInPage = _asyncToGenerator(function* () {}); }
`;

/** What a correctly written in-page function compiles to. */
const CLEAN_SOURCE = `
function pullInPage(recipeId) {
  function readCsrf() { return document.cookie; }
  return fetch('/recipes/' + recipeId + '.json').then(function (r) { return r.json(); });
}
var x = _asyncToGenerator(function* () { return 1; });
async function someServiceWorkerThing() { return 1; }
`;

describe('findInPageWrappers', () => {
  it('flags a transpiled in-page function by the helper name it created', () => {
    const result = findInPageWrappers(TRANSPILED_OFFENDER);
    expect(result.offenders).toEqual(['_pullInPage']);
    expect(result.helpers).toContain('_pullInPage');
  });

  it('passes a plain .then-chain in-page function', () => {
    expect(findInPageWrappers(CLEAN_SOURCE).offenders).toEqual([]);
  });

  it('does not flag _asyncToGenerator on its own, which bundled code uses everywhere', () => {
    const noise = 'var a = _asyncToGenerator(function* () {}); '.repeat(50);
    expect(findInPageWrappers(noise).offenders).toEqual([]);
  });

  it('allows the two known service-worker helpers', () => {
    const result = findInPageWrappers(KNOWN_HELPERS_SOURCE);
    expect(result.offenders).toEqual([]);
    expect(result.helpers.sort()).toEqual([...KNOWN_SERVICE_WORKER_HELPERS].sort());
  });

  it('flags a new helper even when the known ones are present', () => {
    const result = findInPageWrappers(KNOWN_HELPERS_SOURCE + TRANSPILED_OFFENDER);
    expect(result.offenders).toEqual(['_pullInPage']);
  });

  it('flags a generator named directly after an in-page function', () => {
    const source = 'var run = _asyncToGenerator(function* saveRecipeInPage() { yield 1; });';
    expect(findInPageWrappers(source).offenders).toEqual(['saveRecipeInPage']);
  });

  it('reports each offender once and sorted', () => {
    const result = findInPageWrappers(TRANSPILED_OFFENDER + TRANSPILED_OFFENDER);
    expect(result.offenders).toEqual(['_pullInPage']);
  });

  it('honours a caller-supplied allowlist', () => {
    expect(findInPageWrappers(TRANSPILED_OFFENDER, ['_pullInPage']).offenders).toEqual([]);
  });

  it('finds nothing in an empty bundle', () => {
    expect(findInPageWrappers('')).toEqual({ helpers: [], generators: [], offenders: [] });
  });
});

describe('checkBundleFile', () => {
  it('fails clearly when the bundle has not been built', () => {
    const result = checkBundleFile('/definitely/not/a/real/bundle-9d1c.js');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/could not read/);
    expect(result.message).toMatch(/pnpm build:extension/);
  });
});
