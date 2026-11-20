import { describe, expect, it } from 'vitest';
import { refAtChar } from './tokens';

describe('refAtChar', () => {
  const url = '{{baseUrl}}/users/{{ userId }}?q=1';
  it('finds the reference containing the character, braces included', () => {
    expect(refAtChar(url, 0)).toBe('baseUrl');
    expect(refAtChar(url, 5)).toBe('baseUrl');
    expect(refAtChar(url, 10)).toBe('baseUrl');
    expect(refAtChar(url, 22)).toBe('userId');
  });
  it('returns null for characters outside references', () => {
    expect(refAtChar(url, 11)).toBeNull();
    expect(refAtChar(url, url.length)).toBeNull();
    expect(refAtChar('', 0)).toBeNull();
  });
  it('tells adjacent references apart', () => {
    expect(refAtChar('{{a}}{{b}}', 4)).toBe('a');
    expect(refAtChar('{{a}}{{b}}', 5)).toBe('b');
  });
});
