/**
 * @fileoverview Tests for workato_api_request's path guard.
 *
 * This is the only thing standing between the escape hatch and sending the
 * user's Workato session cookie to an arbitrary host, so it gets tested on its
 * own rather than through the tool.
 */

import { describe, expect, it } from 'vitest';

import { resolveWorkatoPath } from '@/entrypoints/background/tools/workato/api-request';

const ORIGIN = 'https://app.workato.com';

describe('resolveWorkatoPath', () => {
  it('accepts a plain /web_api path', () => {
    expect(resolveWorkatoPath('/web_api/lcap/apps.json', ORIGIN)).toEqual({
      url: 'https://app.workato.com/web_api/lcap/apps.json',
    });
  });

  it('keeps an existing query string', () => {
    const out = resolveWorkatoPath('/integrations/meta?name=salesforce', ORIGIN);
    expect(out).toEqual({ url: 'https://app.workato.com/integrations/meta?name=salesforce' });
  });

  it('refuses an absolute URL to another host', () => {
    const out = resolveWorkatoPath('https://evil.example.com/steal', ORIGIN) as { error: string };
    expect(out.error).toContain('must be a path');
  });

  it('refuses an absolute URL even to the Workato host, to keep one code path', () => {
    const out = resolveWorkatoPath(`${ORIGIN}/web_api/lcap/apps.json`, ORIGIN) as { error: string };
    expect(out.error).toContain('must be a path');
  });

  it('refuses a protocol-relative URL', () => {
    const out = resolveWorkatoPath('//evil.example.com/steal', ORIGIN) as { error: string };
    expect(out.error).toContain('protocol-relative');
  });

  it('refuses a path that does not start with a slash', () => {
    const out = resolveWorkatoPath('web_api/lcap/apps.json', ORIGIN) as { error: string };
    expect(out.error).toContain('must start with');
  });

  it('refuses an empty or non-string path', () => {
    expect((resolveWorkatoPath('', ORIGIN) as { error: string }).error).toContain('non-empty');
    expect((resolveWorkatoPath(undefined, ORIGIN) as { error: string }).error).toContain(
      'non-empty',
    );
  });

  it('keeps ../ traversal on the same origin', () => {
    // Traversal cannot leave an origin, so this is a normal (if odd) path.
    expect(resolveWorkatoPath('/web_api/../recipes/1.json', ORIGIN)).toEqual({
      url: 'https://app.workato.com/recipes/1.json',
    });
  });

  it('resolves against a regional Workato origin', () => {
    expect(resolveWorkatoPath('/web_api/auth_user.json', 'https://app.eu.workato.com')).toEqual({
      url: 'https://app.eu.workato.com/web_api/auth_user.json',
    });
  });
});
