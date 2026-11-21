import { describe, expect, it } from 'vitest';
import { refRangeAt } from './tokens';

describe('refRangeAt', () => {
  const url = '{{baseUrl}}/users/{{ userId }}?q=1';
  it('finds the reference containing the character, braces included', () => {
    expect(refRangeAt(url, 0)).toEqual({ name: 'baseUrl', start: 0 });
    expect(refRangeAt(url, 10)?.name).toBe('baseUrl');
    expect(refRangeAt(url, 22)).toEqual({ name: 'userId', start: 18 });
  });
  it('returns null for characters outside references', () => {
    expect(refRangeAt(url, 11)).toBeNull();
    expect(refRangeAt(url, url.length)).toBeNull();
    expect(refRangeAt('', 0)).toBeNull();
  });
  it('tells adjacent references apart', () => {
    expect(refRangeAt('{{a}}{{b}}', 4)?.name).toBe('a');
    expect(refRangeAt('{{a}}{{b}}', 5)).toEqual({ name: 'b', start: 5 });
  });
});
