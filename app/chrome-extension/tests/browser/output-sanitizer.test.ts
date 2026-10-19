import { describe, expect, it } from 'vitest';
import { isSensitiveKey, sanitizeAndLimitOutput, sanitizeText } from '@/utils/output-sanitizer';

const BLOCKED = '[BLOCKED: Cookie/query string data]';

describe('sanitizeText whole-string blocks', () => {
  it('still blocks a bare cookie string and a bare query string', () => {
    expect(sanitizeText('a=1; b=2')).toEqual({ text: BLOCKED, redacted: true });
    expect(sanitizeText('JSESSIONID=abc123; NS_ROUTING_VERSION=LAGGING; _ga=GA1.2')).toEqual({
      text: BLOCKED,
      redacted: true,
    });
    expect(sanitizeText('?x=1&y=2')).toEqual({ text: BLOCKED, redacted: true });
    expect(sanitizeText('x=1&y=2&z=3')).toEqual({ text: BLOCKED, redacted: true });
  });

  it('lets an HTML template with links through', () => {
    const template = [
      '<?xml version="1.0"?><!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">',
      '<pdf><head><link name="NotoSans" type="font" subtype="truetype" src="${nsfont.NotoSans_Regular}" />',
      '<style>td { padding: 4px; } .total { font-weight: bold; }</style></head>',
      '<body><img src="https://1234567.app.netsuite.com/core/media/media.nl?id=42&c=1234567&h=abc" />',
      '<a href="/app/accounting/transactions/custinvc.nl?id=${record.id}&whence=">${record.tranid}</a>',
      '<table><tr><td>Total</td><td class="total">${record.total}</td></tr></table></body></pdf>',
    ].join('\n');

    const result = sanitizeText(template);
    expect(result.text).toBe(template);
    expect(result.redacted).toBe(false);
  });

  it('does not block a full URL with several parameters wholesale', () => {
    const url = 'https://example.com/app/print.nl?id=7&formnumber=101&trantype=custinvc';
    expect(sanitizeText(url)).toEqual({ text: url, redacted: false });
  });

  it('still redacts sensitive parameters inside a URL', () => {
    const result = sanitizeText('https://example.com/cb?code=1&access_token=s3cr3t&state=x');
    expect(result.redacted).toBe(true);
    expect(result.text).toContain('access_token=<redacted>');
    expect(result.text).not.toContain('s3cr3t');
  });

  it('still blocks Set-Cookie shapes and query strings with flags', () => {
    expect(sanitizeText('JSESSIONID=ABCDEF123456; Path=/; Secure; HttpOnly').text).toBe(BLOCKED);
    expect(
      sanitizeText('JSESSIONID=ABCDEF123456; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/').text,
    ).toBe(BLOCKED);
    expect(sanitizeText('a=1&flag&b=2&k=SECRETVALUEXYZ').text).toBe(BLOCKED);
  });

  it('does not treat prose or JSON text as a pair list', () => {
    const prose = 'Set a=1 & b=2 before running; then c=3.';
    expect(sanitizeText(prose).text).toBe(prose);
    const json = '{"filter":"a=1&b=2","sort":"x=1;y=2"}';
    expect(sanitizeText(json).text).toBe(json);
  });

  it('applies the same rule to strings nested in a returned value', () => {
    const out = sanitizeAndLimitOutput({ src: '<a href="/x?a=1&b=2">x</a>', c: 'a=1; b=2' });
    expect(JSON.parse(out.text)).toEqual({ src: '<a href="/x?a=1&b=2">x</a>', c: BLOCKED });
  });
});

describe('sensitive keys', () => {
  it('redacts credential-shaped keys in every spelling', () => {
    for (const key of [
      'password',
      'sessionId',
      'JSESSIONID',
      'x_api_key',
      'APIKey',
      'csrftoken',
      'access_token',
      'Set-Cookie',
      'authToken',
      'client_secret',
      'auth',
      'sid',
      // Plurals and compounds, which a word-only match would miss.
      'cookies',
      'credentials',
      'tokens',
      'secrets',
      'passwords',
      'sessions',
      'authentication',
      'oauth2',
      'apikeys',
      'sessionkey',
      'secretkey',
      'passwordhash',
      'authcode',
      'cookie2',
      '.AspNetCore.Cookies',
      'PHPSESSID',
      'connect.sid',
      'sid2',
      '__Secure-3PSIDTS',
      'SAPISID',
      'x-auth-token',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it('keeps ordinary fields that merely contain a marker', () => {
    for (const key of [
      'subsidiary',
      'author',
      'authorId',
      'authority',
      'consideration',
      'insider',
      'subsidiaryId',
    ]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
    const out = sanitizeAndLimitOutput({ subsidiary: 'Parent Co', author: 'Jane', token: 'abc' });
    expect(JSON.parse(out.text)).toEqual({
      subsidiary: 'Parent Co',
      author: 'Jane',
      token: '<redacted>',
    });
  });
});

describe('sanitizeText embedded base64', () => {
  it('keeps a long URL path but redacts encoded bytes', () => {
    const path = '<img src="/app/common/custom/advancedprint/pdftemplate/logo/large"/>';
    expect(sanitizeText(path)).toEqual({ text: path, redacted: false });
    const camel = 'see /SuiteScripts/Client/Acme2/UserEvents/InvoiceUEHandlerScript here';
    expect(sanitizeText(camel)).toEqual({ text: camel, redacted: false });

    const encoded = 'key: QmFzZTY0RW5jb2RlZFNlY3JldFZhbHVlMTIzNDU2Nzg5MA end';
    expect(sanitizeText(encoded).text).toBe('key: <redacted_base64> end');
  });
});
