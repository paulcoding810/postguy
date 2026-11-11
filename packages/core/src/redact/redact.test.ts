import { describe, expect, it } from 'vitest';
import { MASK, redactAuth, redactHeaders, redactText } from './redact.ts';

describe('redact', () => {
  it('masks secrets in text, longest first, ignoring tiny values', () => {
    expect(redactText('token=abcdef and abc and ab', ['abc', 'abcdef', 'ab'])).toBe(`token=${MASK} and ${MASK} and ab`);
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
