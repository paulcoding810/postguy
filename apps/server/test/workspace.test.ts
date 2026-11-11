import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MASK } from '@postguy/core';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('auth guard', () => {
  it('rejects calls without the server token but allows /health', async () => {
    expect((await h.app.inject({ url: '/collections/tree' })).statusCode).toBe(401);
    expect((await h.app.inject({ url: '/health' })).statusCode).toBe(200);
  });
});

describe('collections and requests', () => {
  it('builds a tree, moves folders, rejects cycles and cascades deletes', async () => {
    const root = (await h.call('POST', '/collections', { name: 'Shop' })).body;
    expect(root).toMatchObject({ kind: 'collection', auth: { type: 'none' } });
    const folder = (await h.call('POST', '/collections', { name: 'Users', parentId: root.id })).body;
    expect(folder).toMatchObject({ kind: 'folder', auth: { type: 'inherit' } });
    const sub = (await h.call('POST', '/collections', { name: 'Sub', parentId: folder.id })).body;
    const req = (await h.call('POST', '/requests', { collectionId: sub.id, name: 'Get', method: 'GET', url: 'http://x' })).body;
    expect(req).toMatchObject({ params: [], auth: { type: 'inherit' }, body: { mode: 'none' } });

    const tree = (await h.call('GET', '/collections/tree')).body;
    expect(tree[0].children[0].children[0].requests[0].name).toBe('Get');

    expect((await h.call('PATCH', `/collections/${folder.id}`, { parentId: sub.id })).status).toBe(400);
    expect((await h.call('POST', '/requests', { collectionId: 'nope', name: 'x', method: 'GET', url: '' })).status).toBe(404);

    const dup = (await h.call('POST', `/requests/${req.id}/duplicate`, {})).body;
    expect(dup.name).toBe('Get copy');

    expect((await h.call('DELETE', `/collections/${root.id}`)).status).toBe(200);
    expect((await h.call('GET', `/requests/${req.id}`)).status).toBe(404);
  });

  it('validates input', async () => {
    const res = await h.call('POST', '/requests', { collectionId: 'x', name: '', method: 'FETCH', url: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });
});

describe('environments and variables', () => {
  it('activates one environment at a time and masks secrets', async () => {
    const dev = (await h.call('POST', '/environments', { name: 'Dev' })).body;
    const prod = (await h.call('POST', '/environments', { name: 'Prod' })).body;
    await h.call('POST', `/environments/${dev.id}/activate`, {});
    await h.call('POST', `/environments/${prod.id}/activate`, {});
    const list = (await h.call('GET', '/environments')).body;
    expect(list.filter((e: any) => e.isActive).map((e: any) => e.name)).toEqual(['Prod']);
    expect(list.find((e: any) => e.kind === 'global')).toBeTruthy();

    await h.call('PUT', `/variables/environment/${dev.id}`, {
      variables: [
        { key: 'baseUrl', value: 'http://a' },
        { key: 'token', value: 'super-secret', isSecret: true },
      ],
    });
    const masked = (await h.call('GET', `/variables/environment/${dev.id}`)).body;
    expect(masked.find((v: any) => v.key === 'token').value).toBe(MASK);

    await h.call('PUT', `/variables/environment/${dev.id}`, {
      variables: masked.map((v: any) => ({ key: v.key, value: v.value, isSecret: v.isSecret })),
    });
    const revealed = (await h.call('GET', `/variables/environment/${dev.id}?reveal=1`)).body;
    expect(revealed.find((v: any) => v.key === 'token').value).toBe('super-secret');

    expect((await h.call('PUT', `/variables/environment/${dev.id}`, { variables: [{ key: 'a', value: '' }, { key: 'a', value: '' }] })).status).toBe(400);
  });
});

describe('import / export', () => {
  it('round-trips a collection without secrets', async () => {
    const root = (await h.call('POST', '/collections', { name: 'Shop', auth: { type: 'bearer', token: 'raw-secret' } })).body;
    const folder = (await h.call('POST', '/collections', { name: 'Auth', parentId: root.id })).body;
    await h.call('POST', '/requests', {
      collectionId: folder.id,
      name: 'Login',
      method: 'POST',
      url: '{{baseUrl}}/auth/login',
      auth: { type: 'basic', username: 'john', password: 'pw' },
      body: { mode: 'json', raw: '{"a":1}' },
    });
    await h.call('PUT', `/variables/collection/${root.id}`, {
      variables: [
        { key: 'baseUrl', value: 'http://x' },
        { key: 'apiKey', value: 'k-123', isSecret: true },
      ],
    });
    const exported = (await h.call('GET', `/collections/${root.id}/export`)).body;
    const text = JSON.stringify(exported);
    expect(text).not.toContain('raw-secret');
    expect(text).not.toContain('k-123');
    expect(text).not.toContain('"pw"');

    const imported = (await h.call('POST', '/collections/import', { data: exported })).body;
    const tree = (await h.call('GET', '/collections/tree')).body;
    const copy = tree.find((c: any) => c.id === imported.id);
    expect(copy.children[0].requests[0].name).toBe('Login');
    expect((await h.call('POST', '/collections/import', { data: { nope: 1 } })).status).toBe(400);
  });
});
