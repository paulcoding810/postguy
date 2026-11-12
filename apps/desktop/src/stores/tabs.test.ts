import { describe, expect, it } from 'vitest';
import { normalizeDefinition } from './tabs';

describe('normalizeDefinition', () => {
  it('fills fields missing from tabs saved by older versions', () => {
    const old = { name: 'Login', method: 'POST', url: '{{baseUrl}}/auth/login', params: [], headers: [], auth: { type: 'inherit' }, body: { mode: 'json', raw: '{}' }, settings: {} };
    const d = normalizeDefinition(old);
    expect(d.scripts).toEqual({ pre: '', post: '' });
    expect(d.pathParams).toEqual([]);
    expect(d).toMatchObject({ name: 'Login', method: 'POST', body: { mode: 'json', raw: '{}' } });
  });
  it('recovers from damaged state', () => {
    expect(normalizeDefinition({ name: 'X', method: 'BREW' }).method).toBe('GET');
    expect(normalizeDefinition(null).name).toBe('Recovered request');
  });
});
