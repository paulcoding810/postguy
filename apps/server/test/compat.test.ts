import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('variable scopes in previews', () => {
  it('says which scope a value comes from and which environment value it hides', async () => {
    const col = (await h.call('POST', '/collections', { name: 'API', parentId: null })).body;
    await h.call('PUT', `/variables/collection/${col.id}`, { variables: [{ key: 'baseUrl', value: 'https://prod.example.com' }] });
    const env = (await h.call('POST', '/environments', { name: 'Local' })).body;
    await h.call('PUT', `/variables/environment/${env.id}`, { variables: [{ key: 'baseUrl', value: 'http://127.0.0.1:4791' }] });
    const [p] = (await h.call('POST', '/resolve-preview', { collectionId: col.id, environmentId: env.id, templates: ['{{baseUrl}}/x'] })).body;
    expect(p.refs[0]).toMatchObject({ source: 'collection', preview: 'https://prod.example.com', shadowed: [{ source: 'environment', preview: 'http://127.0.0.1:4791' }] });
  });
});

describe('built-in variables when sending', () => {
  it('sends generated values instead of the literal text', async () => {
    const res = (await h.call('POST', '/send', { request: { name: 'echo', method: 'GET', url: `${h.mockUrl}/echo?id={{$guid}}&t={{$timestamp}}` } })).body;
    expect(res.unresolved).toEqual([]);
    const q = JSON.parse(res.body).query;
    expect(q.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(q.t).toMatch(/^\d{10}$/);
  });
});

describe('collection import warnings', () => {
  it('lists Postman features that will not run', async () => {
    const data = {
      info: { name: 'P', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'A', request: { method: 'GET', url: 'https://x/{{$randomBankAccount}}' }, event: [{ listen: 'test', script: { exec: ['pm.sendRequest("https://x")'] } }] }],
    };
    const res = (await h.call('POST', '/collections/import', { data })).body;
    expect(res.name).toBe('P');
    expect(res.warnings).toHaveLength(2);
  });
});
