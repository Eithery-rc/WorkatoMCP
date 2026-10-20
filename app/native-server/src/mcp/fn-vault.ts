/**
 * Browser functions: secrets from the Bitwarden vault.
 *
 * A function that logs in names vault values (`vault: {password: {item, field}}`)
 * and uses them only as the value of a fill. The bridge reads them with the
 * `bw` CLI at the step that types them, so no model ever sees a password or
 * a TOTP code, and the code is fetched only once its input is on the page.
 *
 * What keeps this from becoming a way to read the vault:
 * - a value is typed only into a page whose host matches one of the vault
 *   item's own URIs, with Bitwarden's match rules (domain by default);
 * - chrome_fn_save never saves a definition with `vault`, so such a function
 *   exists only when a person wrote and committed it (checked before a run);
 * - values are scrubbed from every step value and from the reply.
 *
 * The session key comes from BW_SESSION, or on Windows from the user
 * environment in the registry (where `bw unlock` instructions put it), and is
 * handed to bw through its environment, never on the command line.
 */

import { execFile } from 'child_process';
import { readEnv } from '../env';

export type VaultField = 'username' | 'password' | 'totp';
export const VAULT_FIELDS: readonly VaultField[] = ['username', 'password', 'totp'];

export interface VaultUri {
  uri: string;
  /** Bitwarden URI match type: null/0 domain, 1 host, 2 starts with, 3 exact, 4 regex, 5 never. */
  match: number | null;
}

export interface FnVault {
  get(item: string, field: VaultField): Promise<string>;
  uris(item: string): Promise<VaultUri[]>;
}

/** A vault problem the caller can act on (locked, missing item); never carries a secret. */
export class VaultError extends Error {}

export const BW_PATH_ENV = 'MOKUTAB_BW_PATH';

type Exec = (
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<{ stdout: string; stderr: string }>;

const execBw: Exec = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { env, windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          (error as any).stderr = String(stderr || '');
          reject(error);
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });

/**
 * Session keys to try, freshest first. On Windows the user environment in the
 * registry comes first: this process inherited its environment from Chrome at
 * Chrome's start, so its BW_SESSION is whatever was set back then.
 */
async function sessionKeys(exec: Exec): Promise<string[]> {
  const keys: string[] = [];
  if (process.platform === 'win32') {
    try {
      const { stdout } = await exec(
        'reg',
        ['query', 'HKCU\\Environment', '/v', 'BW_SESSION'],
        process.env,
      );
      const match = /BW_SESSION\s+REG_\w+\s+(\S+)/.exec(stdout);
      if (match) keys.push(match[1]);
    } catch {
      // Not set there: the process environment may still have one.
    }
  }
  const fromEnv = process.env.BW_SESSION?.trim();
  if (fromEnv && !keys.includes(fromEnv)) keys.push(fromEnv);
  if (keys.length === 0) {
    throw new VaultError(
      'no Bitwarden session: unlock the vault (bw unlock) and set BW_SESSION in the user environment',
    );
  }
  return keys;
}

export function bitwardenVault(exec: Exec = execBw): FnVault {
  const bw = readEnv(BW_PATH_ENV)?.trim() || 'bw';
  const run = async (args: string[]): Promise<string> => {
    const keys = await sessionKeys(exec);
    for (let i = 0; ; i++) {
      try {
        const { stdout } = await exec(bw, [...args, '--nointeraction'], {
          ...process.env,
          BW_SESSION: keys[i],
        });
        return stdout.trim();
      } catch (err: any) {
        // A stale key reads as "locked": try the next one before giving up.
        if (/locked/i.test(String(err?.stderr || '')) && i + 1 < keys.length) continue;
        throw bwError(err, args);
      }
    }
  };
  /** Only stderr is inspected: stdout may hold a secret. */
  const bwError = (err: any, args: string[]): VaultError => {
    const stderr = String(err?.stderr || '');
    if (err?.code === 'ENOENT') {
      return new VaultError(
        `the Bitwarden CLI was not found (${bw}); install it or set ${BW_PATH_ENV}`,
      );
    }
    if (/locked/i.test(stderr)) {
      return new VaultError('the Bitwarden vault is locked: unlock it and refresh BW_SESSION');
    }
    if (/totp/i.test(stderr)) return new VaultError('the vault item has no TOTP');
    if (/not found/i.test(stderr)) {
      return new VaultError(`no vault item or value for ${args.slice(1).join(' ')}`);
    }
    return new VaultError(
      `bw ${args[0]} ${args[1]} failed: ${stderr.split('\n')[0].slice(0, 200) || 'no message'}`,
    );
  };
  return {
    async get(item, field) {
      if (!VAULT_FIELDS.includes(field)) throw new VaultError(`unknown vault field ${field}`);
      assertItemId(item);
      const value = await run(['get', field, item]);
      if (!value) throw new VaultError(`the vault item has no ${field}`);
      return value;
    },
    async uris(item) {
      assertItemId(item);
      const raw = await run(['get', 'item', item]);
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new VaultError('bw get item did not return JSON');
      }
      const uris = Array.isArray(parsed?.login?.uris) ? parsed.login.uris : [];
      // Keep only the URIs; the rest of the item (password, notes) is dropped here.
      return uris
        .filter((u: any) => typeof u?.uri === 'string' && u.uri.trim())
        .map((u: any) => ({
          uri: u.uri.trim(),
          match: typeof u.match === 'number' ? u.match : null,
        }));
    },
  };
}

/** bw also takes names and search words; only an item id picks exactly one item. */
function assertItemId(item: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item)) {
    throw new VaultError('a vault item must be named by its id (a UUID)');
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`,
    ).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Last two labels: login.netsuite.com -> netsuite.com (no public-suffix list). */
function baseDomain(host: string): string {
  const bare = host.replace(/:\d+$/, '');
  const labels = bare.split('.');
  return labels.length <= 2 ? bare : labels.slice(-2).join('.');
}

/**
 * Whether a page URL is one the vault item is for, with Bitwarden's rules.
 * Regex and "never" URIs never match here.
 */
export function pageMatchesVaultUris(pageUrl: string, uris: VaultUri[]): boolean {
  // Secrets are typed only into https pages.
  if (!/^https:\/\//i.test(pageUrl)) return false;
  const pageHost = hostOf(pageUrl);
  if (!pageHost) return false;
  return uris.some(({ uri, match }) => {
    // App URIs (androidapp://, iosapp://) say nothing about a web page.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri) && !/^https?:\/\//i.test(uri)) return false;
    const host = hostOf(uri);
    if (!host) return false;
    switch (match) {
      case null:
      case 0:
        return baseDomain(host.replace(/:\d+$/, '')) === baseDomain(pageHost);
      case 1:
        return host === pageHost;
      case 2: {
        // A prefix must end at a boundary: https://login.example.com must not match login.example.com.evil.net.
        const page = pageUrl.toLowerCase();
        const prefix = uri.toLowerCase();
        return (
          page.startsWith(prefix) &&
          (/[/?#]$/.test(prefix) || /^($|[/?#])/.test(page.slice(prefix.length)))
        );
      }
      case 3:
        return pageUrl.toLowerCase() === uri.toLowerCase();
      default:
        return false;
    }
  });
}

/**
 * Replace every occurrence of the given secrets inside the strings (values and
 * keys) of a JSON-able value. Numbers are left alone: replacing in the JSON
 * text broke it when a secret was all digits ("ms":1234).
 */
export function scrubSecrets<T>(value: T, secrets: Iterable<string>): T {
  const list = [...secrets].filter((s) => s.length >= 4);
  if (!list.length) return value;
  const scrub = (text: string) =>
    list.reduce((out, secret) => out.split(secret).join('<vault value>'), text);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(v)) out[scrub(key)] = walk(item);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
