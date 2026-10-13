/**
 * Output Sanitizer — redacts sensitive values and limits output size.
 *
 * Provides safe processing of JavaScript execution results:
 * 1. Sensitive-field redaction (cookie/token/password, etc.)
 * 2. Output length capping (default 50 KB)
 * 3. Deep object serialization
 */

export const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024;

export interface OutputSanitizerOptions {
  maxBytes?: number;
  maxDepth?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
}

export interface SanitizedOutput {
  text: string;
  truncated: boolean;
  redacted: boolean;
  originalBytes: number;
}

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_ARRAY_LENGTH = 200;
const DEFAULT_MAX_OBJECT_KEYS = 200;
const DEFAULT_MAX_STRING_LENGTH = 10_000;

// Sensitive key markers (values matching these keys will be redacted).
const SENSITIVE_KEY_MARKERS = [
  'cookie',
  'setcookie',
  'authorization',
  'proxyauthorization',
  'bearer',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'password',
  'passwd',
  'pwd',
  'secret',
  'clientsecret',
  'apikey',
  'session',
  'sessionid',
  'sid',
  'csrf',
  'xsrf',
  'credential',
  'privatekey',
  'accesskey',
  'auth',
  'oauth',
] as const;

/**
 * Redact sensitive fields and cap output length for an arbitrary value.
 */
export function sanitizeAndLimitOutput(
  value: unknown,
  options: OutputSanitizerOptions = {},
): SanitizedOutput {
  const maxBytes = normalizePositiveInt(options.maxBytes, DEFAULT_MAX_OUTPUT_BYTES);
  const maxDepth = normalizePositiveInt(options.maxDepth, DEFAULT_MAX_DEPTH);
  const maxArrayLength = normalizePositiveInt(options.maxArrayLength, DEFAULT_MAX_ARRAY_LENGTH);
  const maxObjectKeys = normalizePositiveInt(options.maxObjectKeys, DEFAULT_MAX_OBJECT_KEYS);
  const maxStringLength = normalizePositiveInt(options.maxStringLength, DEFAULT_MAX_STRING_LENGTH);

  const { value: sanitizedValue, redacted } = sanitizeValue(value, {
    maxDepth,
    maxArrayLength,
    maxObjectKeys,
    maxStringLength,
  });

  const formatted = formatValueForOutput(sanitizedValue);
  const truncated = truncateTextBytes(formatted, maxBytes);

  return {
    text: truncated.text,
    truncated: truncated.truncated,
    redacted,
    originalBytes: truncated.originalBytes,
  };
}

/** Cap for an unredacted value bound for a file (chrome_javascript out_file). */
export const RAW_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * Format a value for a file the caller asked for, with no redaction: a string
 * verbatim, anything else as indented JSON. Only the size is capped. Never use
 * this for text that goes back to the model inline.
 */
export function formatRawOutput(
  value: unknown,
  maxBytes: number = RAW_MAX_OUTPUT_BYTES,
): SanitizedOutput {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (value === undefined) text = '';
  else {
    try {
      text = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  const truncated = truncateTextBytes(text, normalizePositiveInt(maxBytes, RAW_MAX_OUTPUT_BYTES));
  return {
    text: truncated.text,
    truncated: truncated.truncated,
    redacted: false,
    originalBytes: truncated.originalBytes,
  };
}

/**
 * Redact sensitive information from a string.
 * Handles Bearer tokens, JWTs, Base64/Hex credentials, cookie strings, and query strings.
 */
export function sanitizeText(text: string): { text: string; redacted: boolean } {
  let out = text;
  let redacted = false;

  const replace = (
    re: RegExp,
    replacement: string | ((substring: string, ...args: any[]) => string),
  ) => {
    const next = out.replace(re, replacement as Parameters<typeof String.prototype.replace>[1]);
    if (next !== out) {
      out = next;
      redacted = true;
    }
  };

  // 1. Whole-string checks: the string IS a cookie or query string, nothing else.
  // Text that merely contains '=' and '&' (an HTML template with links, prose,
  // a full URL) is left to the targeted rules below.
  if (out.includes('=') && (out.includes(';') || out.includes('&'))) {
    if (looksLikeCookieString(out)) {
      return { text: '[BLOCKED: Cookie/query string data]', redacted: true };
    }
    if (looksLikeQueryString(out)) {
      return { text: '[BLOCKED: Cookie/query string data]', redacted: true };
    }
  }

  // Pure Base64 string (20+ chars)
  if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(out)) {
    return { text: '[BLOCKED: Base64 encoded data]', redacted: true };
  }

  // Pure hex credential (32+ chars)
  if (/^[a-f0-9]{32,}$/i.test(out)) {
    return { text: '[BLOCKED: Hex credential]', redacted: true };
  }

  // 2. Bearer token
  replace(/\bBearer\s+([A-Za-z0-9._~+/=-]+)\b/gi, 'Bearer <redacted>');

  // 3. JWT (three-part dot-delimited)
  replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<redacted_jwt>');

  // 4. Sensitive values in URL query parameters
  replace(
    /(^|[?&])(access_token|refresh_token|id_token|token|api_key|apikey|password|passwd|pwd|secret|session|sid|credential|auth|oauth)=([^&#\s]+)/gi,
    (_m, p1, p2) => `${p1}${p2}=<redacted>`,
  );

  // 5. Header-like key-value pairs
  replace(
    /\b(authorization|cookie|set-cookie|x-api-key|api_key|apikey|password|passwd|pwd|secret|token|access_token|refresh_token|id_token|session|sid|credential|private_key|oauth)\b\s*[:=]\s*([^\s,;"']+)/gi,
    (_m, key) => `${key}=<redacted>`,
  );

  // 6. Embedded Base64 data in mixed content. Encoded bytes mix upper case,
  // lower case and digits; a long URL path ("app/common/custom/...") does not,
  // and one that starts right after a '/' ("/SuiteScripts/Acme2/...") is a
  // path too. Both are left alone.
  replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, (match, offset: number, whole: string) => {
    if (offset > 0 && whole[offset - 1] === '/') return match;
    return /[A-Z]/.test(match) && /[a-z]/.test(match) && /[0-9]/.test(match)
      ? '<redacted_base64>'
      : match;
  });

  // 7. Embedded long hex strings (API keys, hashes, etc.)
  replace(/\b[a-f0-9]{40,}\b/gi, '<redacted_hex>');

  return { text: out, redacted };
}

/** A cookie name or query key: no spaces, slashes, colons or markup. */
const PLAIN_KEY = /^[\w.\-[\]%$]+$/;

/** A segment without a value: a cookie attribute (Secure, HttpOnly) or a query flag. */
const BARE_TOKEN = /^[\w.-]+$/;

/**
 * True when every non-empty segment is a `key=value` pair with a plain key and
 * a value without whitespace (or a bare token such as `Secure`), and there are
 * at least two pairs. A single segment that is anything else (a URL path, a
 * tag, a sentence) means the text is not a pair list. A Set-Cookie `Expires`
 * date is the one value allowed to hold spaces.
 */
function isPairList(text: string, separator: string): boolean {
  if (/[\r\n]/.test(text)) return false;
  let pairs = 0;
  for (const raw of text.split(separator)) {
    const part = raw.trim();
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx < 0 && BARE_TOKEN.test(part)) continue;
    if (idx <= 0) return false;
    const key = part.slice(0, idx);
    if (!PLAIN_KEY.test(key)) return false;
    if (/\s/.test(part.slice(idx + 1)) && key.toLowerCase() !== 'expires') return false;
    pairs += 1;
  }
  return pairs >= 2;
}

/**
 * Returns true if the string is a URL query string (key=value&key2=value2, with
 * an optional leading '?'). A full URL is not: its first segment carries the path.
 */
function looksLikeQueryString(text: string): boolean {
  const s = (text || '').trim().replace(/^\?/, '');
  if (!s || !s.includes('=') || !s.includes('&')) return false;
  return isPairList(s, '&');
}

function sanitizeValue(
  value: unknown,
  limits: {
    maxDepth: number;
    maxArrayLength: number;
    maxObjectKeys: number;
    maxStringLength: number;
  },
): { value: unknown; redacted: boolean } {
  const { maxDepth, maxArrayLength, maxObjectKeys, maxStringLength } = limits;
  const seen = new WeakMap<object, unknown>();
  let redacted = false;

  const walk = (v: unknown, depth: number): unknown => {
    if (depth < 0) return '[MaxDepth]';

    if (typeof v === 'string') {
      const sanitized = sanitizeText(v);
      if (sanitized.redacted) redacted = true;
      let s = sanitized.text;
      if (s.length > maxStringLength) {
        s = `${s.slice(0, maxStringLength)}... [truncated ${s.length - maxStringLength} chars]`;
      }
      return s;
    }

    if (
      v === null ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      typeof v === 'bigint' ||
      typeof v === 'undefined'
    ) {
      return v;
    }

    if (typeof v === 'symbol') return v.toString();
    if (typeof v === 'function') return `[Function${v.name ? `: ${v.name}` : ''}]`;

    if (typeof v !== 'object') return String(v);

    const obj = v as Record<string, unknown>;

    if (seen.has(obj)) return '[Circular]';

    if (Array.isArray(obj)) {
      const out: unknown[] = [];
      seen.set(obj, out);
      const len = Math.min(obj.length, maxArrayLength);
      for (let i = 0; i < len; i++) {
        out.push(walk(obj[i], depth - 1));
      }
      if (obj.length > maxArrayLength) out.push('[...truncated]');
      return out;
    }

    const out: Record<string, unknown> = {};
    seen.set(obj, out);

    const keys = Object.keys(obj);
    const len = Math.min(keys.length, maxObjectKeys);
    for (let i = 0; i < len; i++) {
      const key = keys[i];
      if (isSensitiveKey(key)) {
        out[key] = '<redacted>';
        redacted = true;
        continue;
      }
      out[key] = walk(obj[key], depth - 1);
    }
    if (keys.length > maxObjectKeys) out.__truncated__ = true;

    return out;
  };

  return { value: walk(value, maxDepth), redacted };
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_MARKERS.some((marker) => normalized.includes(marker));
}

function normalizeKey(key: string): string {
  return (key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Returns true if the string is a cookie string (key=value; key2=value2).
 */
function looksLikeCookieString(text: string): boolean {
  const s = (text || '').trim();
  if (!s) return false;
  if (!s.includes('=') || !s.includes(';')) return false;
  return isPairList(s, ';');
}

function formatValueForOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'undefined') return 'undefined';

  try {
    return safeJsonStringify(value);
  } catch {
    return String(value);
  }
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'bigint') return `${val.toString()}n`;
    if (typeof val === 'symbol') return val.toString();
    if (typeof val === 'function') return `[Function${val.name ? `: ${val.name}` : ''}]`;
    if (val && typeof val === 'object') {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  });
}

function truncateTextBytes(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean; originalBytes: number } {
  const originalBytes = byteLength(text);
  if (originalBytes <= maxBytes) {
    return { text, truncated: false, originalBytes };
  }

  const suffix = `\n... [truncated to ${maxBytes} bytes; original ${originalBytes} bytes]`;
  const suffixBytes = byteLength(suffix);
  const budget = Math.max(0, maxBytes - suffixBytes);

  // Binary search for the right truncation point.
  let lo = 0;
  let hi = text.length;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid);
    if (byteLength(candidate) <= budget) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const prefix = text.slice(0, lo);
  return { text: prefix + suffix, truncated: true, originalBytes };
}

function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, n);
}
