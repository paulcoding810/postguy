import { describe, expect, it } from 'vitest';
import { neighbourTab, normalizeDefinition, numberedTab, type Tab } from './tabs';

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
  it('drops only the invalid field and keeps the rest of the draft', () => {
    const draft = {
      name: 'Create',
      method: 'POST',
      url: 'https://api.test/items',
      params: [],
      pathParams: [],
      headers: [{ id: 'h1', key: 'X-Trace', value: '1', enabled: true }, { id: 'h2', key: 5, enabled: 'yes' }],
      auth: { type: 'inherit' },
      body: { mode: 'json', raw: '{"a":1}' },
      settings: { timeoutMs: 700000, followRedirects: false },
      scripts: { pre: 'console.log(1)', post: '' },
    };
    const d = normalizeDefinition(draft);
    expect(d).toMatchObject({ method: 'POST', url: 'https://api.test/items', body: { mode: 'json', raw: '{"a":1}' }, scripts: { pre: 'console.log(1)' } });
    expect(d.headers.map((h) => h.key)).toEqual(['X-Trace']);
    expect(d.settings).toEqual({ followRedirects: false });
  });
});

describe('tab switching', () => {
  const tabs = ['a', 'b', 'c'].map((id) => ({ kind: 'flow', id, flowId: id, name: id }) as Tab);
  it('moves to the next and previous tab, wrapping', () => {
    expect(neighbourTab(tabs, 'c', 1)?.id).toBe('a');
    expect(neighbourTab(tabs, 'a', -1)?.id).toBe('c');
    expect(neighbourTab(tabs, 'a', 1)?.id).toBe('b');
    expect(neighbourTab([], null, 1)).toBeNull();
  });
  it('picks numbered tabs, with 9 as the last', () => {
    expect(numberedTab(tabs, 2)?.id).toBe('b');
    expect(numberedTab(tabs, 9)?.id).toBe('c');
    expect(numberedTab(tabs, 5)).toBeNull();
  });
});
