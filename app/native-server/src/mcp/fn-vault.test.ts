import { afterEach, describe, expect, test } from '@jest/globals';
import { VaultError, bitwardenVault, pageMatchesVaultUris, scrubSecrets } from './fn-vault';

const ITEM = 'e3e8fa54-5d0a-492b-9c60-b40101865fbf';

describe('pageMatchesVaultUris', () => {
  const page = 'https://4699211.app.netsuite.com/app/login/secure/enterpriselogin.nl?c=4699211';

  test('the default match is the base domain', () => {
    expect(pageMatchesVaultUris(page, [{ uri: 'https://system.netsuite.com', match: null }])).toBe(
      true,
    );
    expect(pageMatchesVaultUris(page, [{ uri: 'netsuite.com', match: 0 }])).toBe(true);
    expect(
      pageMatchesVaultUris(page, [{ uri: 'https://netsuite.com.evil.example', match: null }]),
    ).toBe(false);
    expect(
      pageMatchesVaultUris('https://evil.example/netsuite.com', [
        { uri: 'netsuite.com', match: null },
      ]),
    ).toBe(false);
  });

  test('host, starts-with and exact follow Bitwarden; regex and never do not match', () => {
    expect(pageMatchesVaultUris(page, [{ uri: 'https://system.netsuite.com', match: 1 }])).toBe(
      false,
    );
    expect(
      pageMatchesVaultUris(page, [{ uri: 'https://4699211.app.netsuite.com', match: 1 }]),
    ).toBe(true);
    expect(
      pageMatchesVaultUris(page, [{ uri: 'https://4699211.app.netsuite.com/app/', match: 2 }]),
    ).toBe(true);
    expect(pageMatchesVaultUris(page, [{ uri: page, match: 3 }])).toBe(true);
    expect(pageMatchesVaultUris(page, [{ uri: '.*', match: 4 }])).toBe(false);
    expect(pageMatchesVaultUris(page, [{ uri: 'https://system.netsuite.com', match: 5 }])).toBe(
      false,
    );
  });
});

describe('pageMatchesVaultUris edges', () => {
  test('https pages only, prefixes end at a boundary, app URIs never match', () => {
    const uris = [{ uri: 'https://login.example.com', match: 2 }];
    expect(pageMatchesVaultUris('https://login.example.com/form', uris)).toBe(true);
    expect(pageMatchesVaultUris('https://login.example.com.evil.net/', uris)).toBe(false);
    expect(pageMatchesVaultUris('http://login.example.com/form', uris)).toBe(false);
    expect(
      pageMatchesVaultUris('https://app.example.com/', [
        { uri: 'androidapp://com.example.app', match: null },
      ]),
    ).toBe(false);
  });

  test('an item is named by its id, never by a search word', async () => {
    const vault = bitwardenVault(async () => ({ stdout: 'x', stderr: '' }));
    await expect(vault.get('Alafair', 'password')).rejects.toThrow(/by its id/);
  });
});

describe('scrubSecrets', () => {
  test('a numeric secret is scrubbed from strings without breaking numbers', () => {
    expect(scrubSecrets({ ms: 1234, note: 'pin 1234 typed', list: ['1234'] }, ['1234'])).toEqual({
      ms: 1234,
      note: 'pin <vault value> typed',
      list: ['<vault value>'],
    });
  });

  test('replaces every occurrence, also JSON-escaped ones', () => {
    const value = { a: 'pass "q1w2e3"', b: ['pass "q1w2e3" again'], c: 1 };
    expect(scrubSecrets(value, ['pass "q1w2e3"'])).toEqual({
      a: '<vault value>',
      b: ['<vault value> again'],
      c: 1,
    });
    expect(scrubSecrets('x', [])).toBe('x');
  });
});

describe('bitwardenVault', () => {
  const saved = process.env.BW_SESSION;
  afterEach(() => {
    if (saved === undefined) delete process.env.BW_SESSION;
    else process.env.BW_SESSION = saved;
  });

  test('passes the session through the environment and keeps only URIs of an item', async () => {
    process.env.BW_SESSION = 'session-key';
    const calls: Array<{ args: string[]; session?: string }> = [];
    const vault = bitwardenVault(async (file, args, env) => {
      if (file === 'reg') throw new Error('not set');
      calls.push({ args, session: env.BW_SESSION });
      if (args[1] === 'item') {
        return {
          stdout: JSON.stringify({
            login: {
              password: 'hunter22',
              uris: [{ uri: 'https://system.netsuite.com', match: null }],
            },
          }),
          stderr: '',
        };
      }
      return { stdout: 'hunter22\n', stderr: '' };
    });
    expect(await vault.uris(ITEM)).toEqual([{ uri: 'https://system.netsuite.com', match: null }]);
    expect(await vault.get(ITEM, 'password')).toBe('hunter22');
    expect(calls.map((c) => c.args)).toEqual([
      ['get', 'item', ITEM, '--nointeraction'],
      ['get', 'password', ITEM, '--nointeraction'],
    ]);
    expect(calls.every((c) => c.session === 'session-key' && !c.args.includes('session-key'))).toBe(
      true,
    );
  });

  // The registry lookup exists on Windows only.
  (process.platform === 'win32' ? test : test.skip)(
    'the user environment wins over a stale key this process inherited',
    async () => {
      process.env.BW_SESSION = 'stale-key';
      const tried: string[] = [];
      const vault = bitwardenVault(async (file, _args, env) => {
        if (file === 'reg') {
          return { stdout: '\r\n    BW_SESSION    REG_SZ    fresh-key\r\n', stderr: '' };
        }
        tried.push(String(env.BW_SESSION));
        if (env.BW_SESSION !== 'fresh-key') {
          const err: any = new Error('exit 1');
          err.stderr = 'Vault is locked.';
          throw err;
        }
        return { stdout: 'value\n', stderr: '' };
      });
      expect(await vault.get(ITEM, 'password')).toBe('value');
      expect(tried).toEqual(['fresh-key']);
    },
  );

  test('a locked vault is a clear error that never quotes stdout', async () => {
    process.env.BW_SESSION = 'session-key';
    const vault = bitwardenVault(async () => {
      const err: any = new Error('exit 1');
      err.stderr = 'Vault is locked.';
      err.stdout = 'hunter22';
      throw err;
    });
    await expect(vault.get(ITEM, 'password')).rejects.toThrow(VaultError);
    await expect(vault.get(ITEM, 'password')).rejects.toThrow(/locked/);
  });
});
