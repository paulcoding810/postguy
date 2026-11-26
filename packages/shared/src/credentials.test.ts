import { describe, expect, it } from 'vitest';
import { looksLikeCredential } from './credentials.ts';

describe('looksLikeCredential', () => {
  it('flags passwords, tokens and keys with a value', () => {
    for (const k of ['password', 'auth_token', 'apiKey', 'x-api-key', 'client_secret', 'SESSION_ID', 'refreshToken']) expect(looksLikeCredential(k, 'abc'), k).toBe(true);
  });
  it('leaves descriptive names, empty values and references alone', () => {
    for (const k of ['token_type', 'expires_in', 'auth_url', 'host', 'email', 'user_id', 'username']) expect(looksLikeCredential(k, 'abc'), k).toBe(false);
    expect(looksLikeCredential('password', '')).toBe(false);
    expect(looksLikeCredential('password', '{{prodPassword}}')).toBe(false);
  });
});
