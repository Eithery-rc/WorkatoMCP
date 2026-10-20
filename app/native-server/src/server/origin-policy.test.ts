import { describe, expect, test } from '@jest/globals';
import { EXTENSION_IDS } from '../scripts/constant';
import { isAllowedHost, isAllowedOrigin, isAllowedWsOrigin, requestRefusal } from './origin-policy';

const OURS = `chrome-extension://${EXTENSION_IDS[0]}`;

describe('EXTENSION_IDS', () => {
  test('holds only this project id, not the upstream Web Store one', () => {
    expect(EXTENSION_IDS).toEqual(['bpjpdgkeelhkijkllcmogemkmndgeana']);
  });
});

describe('isAllowedWsOrigin (the profile socket)', () => {
  test('no Origin, or this extension', () => {
    expect(isAllowedWsOrigin(undefined)).toBe(true);
    expect(isAllowedWsOrigin('')).toBe(true);
    expect(isAllowedWsOrigin(OURS)).toBe(true);
  });

  test('never a local page, another extension or a look-alike', () => {
    expect(isAllowedWsOrigin('http://127.0.0.1')).toBe(false);
    expect(isAllowedWsOrigin('http://127.0.0.1:12306')).toBe(false);
    expect(isAllowedWsOrigin('chrome-extension://hbdgbgagpkpjffpklnamcljpakneikee')).toBe(false);
    expect(isAllowedWsOrigin('chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh')).toBe(false);
    expect(isAllowedWsOrigin(`${OURS}/`)).toBe(false);
    expect(isAllowedWsOrigin('null')).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  test('no Origin header is allowed: local MCP clients send none', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin(null)).toBe(true);
    expect(isAllowedOrigin('')).toBe(true);
  });

  test('our extension ids are allowed, any other extension is not', () => {
    for (const id of EXTENSION_IDS) expect(isAllowedOrigin(`chrome-extension://${id}`)).toBe(true);
    expect(isAllowedOrigin('chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh')).toBe(false);
    expect(isAllowedOrigin(`${OURS}.evil`)).toBe(false);
    expect(isAllowedOrigin(`${OURS}/path`)).toBe(false);
    expect(isAllowedOrigin('moz-extension://0b1c2d3e-0000-0000-0000-000000000000')).toBe(false);
  });

  test('the local http host is allowed on any port', () => {
    expect(isAllowedOrigin('http://127.0.0.1')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:12306')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
  });

  test('a host that only starts like the local one is refused', () => {
    expect(isAllowedOrigin('http://127.0.0.1.attacker.tld')).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1.attacker.tld:12306')).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.10')).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1@attacker.tld')).toBe(false);
  });

  test('other schemes, other hosts and malformed values are refused', () => {
    expect(isAllowedOrigin('https://127.0.0.1')).toBe(false);
    expect(isAllowedOrigin('http://localhost:12306')).toBe(false);
    expect(isAllowedOrigin('https://app.workato.com')).toBe(false);
    expect(isAllowedOrigin('null')).toBe(false);
    expect(isAllowedOrigin('file://')).toBe(false);
    expect(isAllowedOrigin('not a url')).toBe(false);
  });

  // Each of these parses to hostname 127.0.0.1, so only the comparison with the
  // normalized url.origin refuses them: a header that is not the canonical
  // origin string is not a real Origin.
  test('a value that only normalizes to the local origin is refused', () => {
    for (const origin of [
      'http://127.0.0.1.', // trailing dot
      'http://user@127.0.0.1', // credentials
      'HTTP://127.0.0.1', // scheme case
      'http://127.1', // IPv4 shorthand
      'http://0x7f.0.0.1', // hex octet
      ' http://127.0.0.1', // leading whitespace
      'http://127.0.0.1 ', // trailing whitespace
      'http://127.0.0.1/', // trailing slash
      'http://127.0.0.1:80', // the default port spelled out
      'http://127.0.0.1:012306', // a padded port
    ]) {
      expect([origin, isAllowedOrigin(origin)]).toEqual([origin, false]);
    }
  });
});

describe('isAllowedHost', () => {
  test('a local name on the port the request came in on', () => {
    expect(isAllowedHost('127.0.0.1:12306', 12306)).toBe(true);
    expect(isAllowedHost('localhost:12306', 12306)).toBe(true);
    expect(isAllowedHost('LocalHost:12306', 12306)).toBe(true);
  });

  test('a rebinding domain, another port or a malformed value is refused', () => {
    expect(isAllowedHost('attacker.example:12306', 12306)).toBe(false);
    expect(isAllowedHost('127.0.0.1.attacker.tld:12306', 12306)).toBe(false);
    expect(isAllowedHost('127.0.0.1:12307', 12306)).toBe(false);
    expect(isAllowedHost('127.0.0.1', 12306)).toBe(false);
    expect(isAllowedHost('localhost.:12306', 12306)).toBe(false);
    expect(isAllowedHost('[::1]:12306', 12306)).toBe(false);
    expect(isAllowedHost('127.0.0.1:12306:1', 12306)).toBe(false);
  });

  test('no Host header (an injected request) and an unknown local port only check the name', () => {
    expect(isAllowedHost(undefined, 12306)).toBe(true);
    expect(isAllowedHost('127.0.0.1:1', null)).toBe(true);
    expect(isAllowedHost('attacker.example', null)).toBe(false);
  });

  test('requestRefusal names what it refused', () => {
    expect(requestRefusal({ host: '127.0.0.1:12306', port: 12306 })).toBeNull();
    expect(requestRefusal({ host: 'evil.example', port: 12306 })).toBe('host "evil.example"');
    expect(
      requestRefusal({ host: '127.0.0.1:12306', port: 12306, origin: 'https://evil.example' }),
    ).toBe('origin "https://evil.example"');
  });
});
