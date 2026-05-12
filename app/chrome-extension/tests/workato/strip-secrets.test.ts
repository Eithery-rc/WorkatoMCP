import { describe, it, expect } from 'vitest';
import { stripConnectionSecrets } from '../../entrypoints/background/tools/workato/strip-secrets';

describe('stripConnectionSecrets', () => {
  describe('exact-match keys', () => {
    it('drops auth_token, refresh_token, password, client_secret', () => {
      const input = {
        id: 1,
        auth_token: 'abc',
        refresh_token: 'def',
        password: 'hunter2',
        client_secret: 'shh',
      };
      const out = stripConnectionSecrets(input) as Record<string, unknown>;
      expect(out).toEqual({ id: 1 });
    });

    it('matches case-insensitively', () => {
      const input = { id: 1, AUTH_TOKEN: 'abc', Password: 'hunter2' };
      const out = stripConnectionSecrets(input) as Record<string, unknown>;
      expect(out).toEqual({ id: 1 });
    });

    it('drops jwt, bearer, certificate, signing_key', () => {
      const input = {
        id: 1,
        jwt: 'x',
        bearer: 'y',
        certificate: 'z',
        signing_key: 'k',
      };
      expect(stripConnectionSecrets(input)).toEqual({ id: 1 });
    });
  });

  describe('suffix match', () => {
    it('drops keys ending in _token, _secret, _key, _password', () => {
      const input = {
        id: 1,
        api_secret_key: 'x',
        webhook_signature: 'y',
        my_token: 'z',
        admin_password: 'w',
      };
      expect(stripConnectionSecrets(input)).toEqual({ id: 1 });
    });

    it('keeps signing_key_algorithm (does not end in _key)', () => {
      const input = { id: 1, signing_key_algorithm: 'RS256' };
      expect(stripConnectionSecrets(input)).toEqual({ id: 1, signing_key_algorithm: 'RS256' });
    });

    it('drops signing_key (ends in _key)', () => {
      const input = { id: 1, signing_key: 'long-secret-stuff' };
      expect(stripConnectionSecrets(input)).toEqual({ id: 1 });
    });
  });

  describe('prefix match', () => {
    it('drops encrypted_* and hashed_*', () => {
      const input = {
        id: 1,
        encrypted_blob: 'abc',
        hashed_password: 'def',
        regular_field: 'kept',
      };
      expect(stripConnectionSecrets(input)).toEqual({ id: 1, regular_field: 'kept' });
    });
  });

  describe('value-shape guard', () => {
    it('drops innocent-keyed JWT strings', () => {
      const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_part_here_abc';
      const input = { id: 1, hint: jwt };
      const out = stripConnectionSecrets(input) as Record<string, unknown>;
      expect(out).toEqual({ id: 1 });
    });

    it('drops innocent-keyed long hex strings', () => {
      const hex = 'a'.repeat(40);
      const input = { id: 1, fingerprint: hex };
      const out = stripConnectionSecrets(input) as Record<string, unknown>;
      expect(out).toEqual({ id: 1 });
    });

    it('keeps ordinary URL strings (have colons/dots not in base64 alphabet)', () => {
      const input = { id: 1, instance_url: 'https://acme.my.salesforce.com/services/data/v62.0' };
      expect(stripConnectionSecrets(input)).toEqual(input);
    });

    it('keeps short opaque strings (under threshold)', () => {
      const input = { id: 1, sandbox_id: 'sbx_123' };
      expect(stripConnectionSecrets(input)).toEqual(input);
    });
  });

  describe('nested objects and arrays', () => {
    it('recurses into nested objects', () => {
      const input = {
        id: 1,
        auth: { client_id: 'public', client_secret: 'shh', expires_at: '2026-01-01' },
      };
      // client_id is in the EXACT_KEYS denylist, so it gets stripped along with client_secret.
      expect(stripConnectionSecrets(input)).toEqual({
        id: 1,
        auth: { expires_at: '2026-01-01' },
      });
    });

    it('recurses into arrays of objects', () => {
      const input = {
        id: 1,
        accounts: [
          { id: 'a', api_key: 'secret-a' },
          { id: 'b', api_key: 'secret-b' },
        ],
      };
      expect(stripConnectionSecrets(input)).toEqual({
        id: 1,
        accounts: [{ id: 'a' }, { id: 'b' }],
      });
    });

    it('preserves non-secret primitives', () => {
      expect(stripConnectionSecrets({ a: 1, b: true, c: null, d: 'short' })).toEqual({
        a: 1,
        b: true,
        c: null,
        d: 'short',
      });
    });

    it('keeps recipe_count (numeric field with non-secret name)', () => {
      expect(stripConnectionSecrets({ id: 1, recipe_count: 42 })).toEqual({
        id: 1,
        recipe_count: 42,
      });
    });

    it('strips connection_string and dsn (database credentials)', () => {
      const input = {
        id: 1,
        connection_string: 'postgresql://user:pass@host/db',
        dsn: 'Server=h;Uid=u;Pwd=p',
        uri: 'amqp://guest:guest@host',
      };
      expect(stripConnectionSecrets(input)).toEqual({ id: 1 });
    });

    it('handles cyclic references without crashing', () => {
      const obj: Record<string, unknown> = { id: 1 };
      obj.self = obj;
      const out = stripConnectionSecrets(obj) as Record<string, unknown>;
      expect(out.id).toBe(1);
      expect(out.self).toBe('[Circular]');
    });
  });
});
