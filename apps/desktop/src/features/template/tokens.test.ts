import { describe, expect, it } from 'vitest';
import { refAt } from './tokens';

describe('refAt', () => {
  const url = '{{baseUrl}}/users/{{ userId }}?q=1';
  it('finds the reference around the caret, braces included', () => {
    expect(refAt(url, 0)).toBe('baseUrl');
    expect(refAt(url, 5)).toBe('baseUrl');
    expect(refAt(url, 11)).toBe('baseUrl');
    expect(refAt(url, 22)).toBe('userId');
  });
  it('returns null outside references', () => {
    expect(refAt(url, 14)).toBeNull();
    expect(refAt(url, url.length)).toBeNull();
    expect(refAt('', 0)).toBeNull();
  });
});
