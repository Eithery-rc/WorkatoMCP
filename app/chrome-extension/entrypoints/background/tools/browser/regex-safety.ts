/**
 * Regex screening for tools that take a caller's pattern (chrome_search_page,
 * workato_recipe_grep). A service worker has no RegExp timeout, so a
 * catastrophic pattern would hang the extension until the dispatch timeout.
 */

/** Longest regex pattern accepted. */
export const REGEX_MAX_PATTERN_CHARS = 200;

/**
 * Reject a regex that can backtrack catastrophically. The heuristic looks for
 * a quantifier applied to a group that itself contains one (`(a+)+`,
 * `(x*)*`, `(\d+){2,}`), which is the shape behind every real hang seen in
 * the wild. It is deliberately conservative: a rejected pattern is a clear
 * error, not a hang.
 */
export function riskyRegexReason(pattern: string): string | null {
  if (pattern.length > REGEX_MAX_PATTERN_CHARS) {
    return `pattern is ${pattern.length} characters, the limit is ${REGEX_MAX_PATTERN_CHARS}`;
  }
  const nestedQuantifier = /\((?:\?:)?[^()]*[*+}][^()]*\)\s*(?:[*+]|\{\d+(?:,\d*)?\})/;
  if (nestedQuantifier.test(pattern)) {
    return 'a quantifier is applied to a group that already contains one (e.g. "(a+)+"), which can backtrack catastrophically';
  }
  return null;
}
