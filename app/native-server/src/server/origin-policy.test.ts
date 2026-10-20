import { describe, expect, test } from '@jest/globals';
import { EXTENSION_IDS } from '../scripts/constant';
import { isAllowedOrigin } from './origin-policy';

const OURS = `chrome-extension://${EXTENSION_IDS[0]}`;

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
});
