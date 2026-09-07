/**
 * Types for the post-build bundle guard, so the vitest suite can import the
 * matcher without turning it into `any`. The implementation is plain ESM
 * JavaScript because it also runs as a standalone node script from
 * package.json, before anything is compiled.
 */

export declare const KNOWN_SERVICE_WORKER_HELPERS: string[];
export declare const DEFAULT_BUNDLE: string;

export interface InPageWrapperReport {
  /** Every `function _<name>InPage` declaration found in the bundle. */
  helpers: string[];
  /** Every `_asyncToGenerator(function* <name>InPage)` wrapper found. */
  generators: string[];
  /** The union of the two, minus the allowlist, sorted and deduplicated. */
  offenders: string[];
}

export declare function findInPageWrappers(source: string, known?: string[]): InPageWrapperReport;

export interface BundleCheckResult {
  ok: boolean;
  message: string;
  offenders: string[];
}

export declare function checkBundleFile(bundlePath?: string): BundleCheckResult;
