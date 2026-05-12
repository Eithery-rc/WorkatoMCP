/**
 * Strip auth material from a Workato connection response.
 *
 * Applied recursively to all nested objects/arrays. Drops:
 *   - Object keys matching an exact-name denylist (e.g. auth_token, password, jwt).
 *   - Object keys ending in known secret-suffixes (_token, _secret, _key, ...).
 *   - Object keys starting with known secret-prefixes (encrypted_, hashed_).
 *   - String values whose shape matches a known secret format (JWT, long hex,
 *     long opaque base64) — even when the key looks innocent.
 *
 * Stripped fields are REMOVED (not nulled/redacted) so agents can test
 * `key in obj` to detect their absence cleanly.
 */

const SECRET_EXACT_KEYS = new Set<string>([
  'auth_token',
  'refresh_token',
  'access_token',
  'oauth_token',
  'id_token',
  'client_secret',
  'client_id',
  'api_key',
  'api_secret',
  'private_key',
  'password',
  'passphrase',
  'secret',
  'signature',
  'signing_key',
  'jwt',
  'bearer',
  'session_token',
  'certificate',
  'cert',
  'encrypted_data',
  'ssh_key',
  'totp_secret',
  'mfa_secret',
  // Database / cloud-storage connection URIs that embed credentials
  // (e.g. `postgresql://user:pass@host/db`, Azure blob SAS strings).
  'connection_string',
  'connection_uri',
  'dsn',
  'uri',
  'url',
]);

const SECRET_SUFFIXES = [
  '_token',
  '_secret',
  '_key',
  '_password',
  '_signature',
  '_credential',
  '_credentials',
  '_passphrase',
  '_cert',
  '_certificate',
  '_jwt',
  '_bearer',
  '_hash',
];

const SECRET_PREFIXES = ['encrypted_', 'hashed_'];

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HEX_RE = /^[A-Fa-f0-9]{40,}$/;
const BASE64ISH_RE = /^[A-Za-z0-9_+/=]{60,}$/;

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SECRET_EXACT_KEYS.has(lower)) return true;
  if (SECRET_SUFFIXES.some((s) => lower.endsWith(s))) return true;
  if (SECRET_PREFIXES.some((p) => lower.startsWith(p))) return true;
  return false;
}

function isSecretShapedString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return JWT_RE.test(value) || HEX_RE.test(value) || BASE64ISH_RE.test(value);
}

export function stripConnectionSecrets(value: unknown): unknown {
  return stripWithSeen(value, new WeakSet<object>());
}

/**
 * Internal recursive worker. The `seen` WeakSet guards against cyclic
 * references; cycles are reported as the sentinel string '[Circular]'
 * rather than crashing with a stack-overflow RangeError.
 */
function stripWithSeen(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value as object)) {
    return '[Circular]';
  }
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((item) => stripWithSeen(item, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(k)) continue;
    if (typeof v === 'string' && isSecretShapedString(v)) continue;
    out[k] = stripWithSeen(v, seen);
  }
  return out;
}
