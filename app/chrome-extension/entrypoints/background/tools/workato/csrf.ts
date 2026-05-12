/**
 * Decode the XSRF-TOKEN-V2 cookie into the value Workato expects as the
 * `x-csrf-token` header on mutating requests.
 *
 * This function is intended to be passed into chrome.scripting.executeScript;
 * it must be self-contained and not rely on any imports. v1 does not use it
 * (pull and job_trace are GET-only), but future push/soql/schema-derive tools
 * will.
 */
export function readCsrfFromCookieInPage(): string {
  const raw =
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('XSRF-TOKEN-V2='))
      ?.split('=')
      .slice(1)
      .join('=') ?? '';
  return decodeURIComponent(raw);
}
