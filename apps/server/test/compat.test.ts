import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture } from '@postguy/mock-api';
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
    expect(p.refs[0]).toMatchObject({
      source: 'collection',
      ownerId: col.id,
      preview: 'https://prod.example.com',
      shadowed: [{ source: 'environment', preview: 'http://127.0.0.1:4791', ownerId: env.id }],
    });
  });

  it('sets one variable without touching the others', async () => {
    const env = (await h.call('POST', '/environments', { name: 'Dev' })).body;
    await h.call('PUT', `/variables/environment/${env.id}`, { variables: [{ key: 'a', value: '1' }, { key: 'token', value: 's3cret', isSecret: true }, { key: 'off', value: 'x', enabled: false }] });
    const edited = await h.call('PUT', `/variables/environment/${env.id}/a`, { value: '2' });
    expect(edited.body).toMatchObject({ key: 'a', value: '2', enabled: true });
    await h.call('PUT', `/variables/environment/${env.id}/off`, { value: 'y' });
    await h.call('PUT', `/variables/environment/${env.id}/added`, { value: 'new' });
    const vars = (await h.call('GET', `/variables/environment/${env.id}?reveal=1`)).body;
    expect(vars.map((v: any) => [v.key, v.value, v.isSecret, v.enabled])).toEqual([
      ['a', '2', false, true],
      ['token', 's3cret', true, true],
      ['off', 'y', false, true],
      ['added', 'new', false, true],
    ]);
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

describe('empty auth credentials', () => {
  it('warns when the bearer token is empty and suggests the token from a remembered Login', async () => {
    const imp = (await h.call('POST', '/openapi/import', { sourceType: 'paste', content: fixture('mock-api.openapi.yaml') })).body;
    await h.call('PUT', `/variables/collection/${imp.collectionId}/baseUrl`, { value: h.mockUrl });
    const tree = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === imp.collectionId);
    const all = [tree, ...tree.children].flatMap((c: any) => c.requests);
    const login = all.find((r: any) => r.name === 'Login');
    const profile = all.find((r: any) => r.name === 'Get User Profile');
    const send = async (id: string) => {
      const saved = (await h.call('GET', `/requests/${id}`)).body;
      return (await h.call('POST', '/send', { requestId: id, request: saved })).body;
    };
    expect((await send(login.id)).status).toBe(200);
    const res = await send(profile.id);
    expect(res.status).toBe(401);
    expect(res.emptyAuth).toEqual({
      field: 'Bearer token',
      template: '{{accessToken}}',
      variable: { name: 'accessToken', scope: 'collection', ownerId: imp.collectionId },
      suggestion: { ref: 'Login.data.access_token', source: 'Login', path: 'data.access_token' },
    });
    await h.call('PUT', `/variables/collection/${imp.collectionId}/accessToken`, { value: `{{${res.emptyAuth.suggestion.ref}}}` });
    const fixed = await send(profile.id);
    expect(fixed.status).toBe(200);
    expect(fixed.emptyAuth).toBeUndefined();
  });

  it('sends a Postguy User-Agent unless the request sets one', async () => {
    const echo = async (headers: unknown[]) =>
      JSON.parse((await h.call('POST', '/send', { request: { name: 'e', method: 'GET', url: `${h.mockUrl}/echo`, headers } })).body.body).headers['user-agent'];
    expect(await echo([])).toMatch(/^Postguy\//);
    expect(await echo([{ id: '1', key: 'User-Agent', value: 'mine', enabled: true }])).toBe('mine');
  });
});
