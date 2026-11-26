import { describe, expect, it } from 'vitest';
import { MASK, redactAuth, redactHeaders, redactJson, redactText } from './redact.ts';

describe('redact', () => {
  it('masks secrets in text, longest first, ignoring tiny values', () => {
    expect(redactText('token=abcdef and abc and ab', ['abc', 'abcdef', 'ab'])).toBe(`token=${MASK} and ${MASK} and ab`);
  });

  it('masks a secret once it has been URL-encoded, form-encoded or escaped in JSON', () => {
    const s = 'ab+cd/ef9==';
    expect(redactText(`/echo?k=${encodeURIComponent(s)}`, [s])).toBe(`/echo?k=${MASK}`);
    expect(redactText(`k=hello+world%26x`, ['hello world&x'])).toBe(`k=${MASK}`);
    expect(redactText(JSON.stringify({ k: 'a"b\\c' }), ['a"b\\c'])).toBe(`{"k":"${MASK}"}`);
  });

  it('masks sensitive headers and keeps the scheme', () => {
    expect(redactHeaders({ Authorization: 'Bearer xyz', 'X-Other': 'has-secret-1', Accept: '*/*' }, ['secret-1'])).toEqual({
      Authorization: `Bearer ${MASK}`,
      'X-Other': `has-${MASK}`,
      Accept: '*/*',
    });
  });

  it('strips credentials from auth but keeps variable references', () => {
    expect(redactAuth({ type: 'bearer', token: 'raw-token' })).toEqual({ type: 'bearer', token: '' });
    expect(redactAuth({ type: 'bearer', token: '{{token}}' })).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(redactAuth({ type: 'basic', username: 'u', password: 'p' })).toEqual({ type: 'basic', username: 'u', password: '' });
  });
});

describe('descriptive credential keys', () => {
  it('keeps token_type, expires_in and scope but masks the token', () => {
    expect(redactJson({ access_token: 'abc', token_type: 'Bearer', expires_in: 3600, scope: 'read', session_id: 's1' })).toEqual({
      access_token: MASK,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read',
      session_id: MASK,
    });
  });
});
