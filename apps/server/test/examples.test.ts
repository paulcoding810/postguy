import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

const example = (over: Record<string, unknown> = {}) => ({
  name: '200 OK',
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json', 'x-token': 'Bearer s3cret-tok' },
  contentType: 'application/json',
  body: '{"token":"s3cret-tok","user":"ann"}',
  request: { method: 'POST', url: '{{baseUrl}}/login', headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }] },
  ...over,
});

async function setup() {
  const col = (await h.call('POST', '/collections', { name: 'Shop', parentId: null })).body;
  await h.call('PUT', `/variables/collection/${col.id}`, { variables: [{ key: 'token', value: 's3cret-tok', isSecret: true }] });
  const req = (await h.call('POST', '/requests', { collectionId: col.id, name: 'Login', method: 'POST', url: '{{baseUrl}}/login' })).body;
  return { col, req };
}

describe('response examples', () => {
  it('saves an example with secret values replaced by their variables', async () => {
    const { req } = await setup();
    const saved = (await h.call('POST', `/requests/${req.id}/examples`, example())).body;
    expect(saved.body).toBe('{"token":"{{token}}","user":"ann"}');
    expect(saved.headers['x-token']).toBe('Bearer {{token}}');
    expect(saved.request.headers[0].value).toBe('Bearer {{token}}');
    const list = (await h.call('GET', `/requests/${req.id}/examples`)).body;
    expect(list).toEqual([expect.objectContaining({ id: saved.id, name: '200 OK', status: 200, size: saved.body.length })]);
    expect(list[0].body).toBeUndefined();
  });

  it('renames, deletes and keeps order', async () => {
    const { req } = await setup();
    const a = (await h.call('POST', `/requests/${req.id}/examples`, example())).body;
    await h.call('POST', `/requests/${req.id}/examples`, example({ name: '404 Not found', status: 404 }));
    expect((await h.call('PATCH', `/examples/${a.id}`, { name: 'Signed in' })).body.name).toBe('Signed in');
    expect((await h.call('GET', `/requests/${req.id}/examples`)).body.map((e: any) => e.name)).toEqual(['Signed in', '404 Not found']);
    await h.call('DELETE', `/examples/${a.id}`);
    expect((await h.call('GET', `/requests/${req.id}/examples`)).body.map((e: any) => e.name)).toEqual(['404 Not found']);
    expect((await h.call('GET', `/examples/${a.id}`)).status).toBe(404);
  });

  it('copies examples when the request is duplicated, and brings them back with a deleted request', async () => {
    const { col, req } = await setup();
    const a = (await h.call('POST', `/requests/${req.id}/examples`, example())).body;
    const copy = (await h.call('POST', `/requests/${req.id}/duplicate`, {})).body;
    expect((await h.call('GET', `/requests/${copy.id}/examples`)).body.map((e: any) => e.name)).toEqual(['200 OK']);

    await h.call('DELETE', `/requests/${req.id}`);
    const [deletion] = (await h.call('GET', `/collections/${col.id}/changes`)).body;
    expect(deletion.before.examples).toEqual([{ name: '200 OK', status: 200 }]);
    await h.call('POST', `/changes/${deletion.id}/restore`, {});
    const back = (await h.call('GET', `/examples/${a.id}`)).body;
    expect(back).toMatchObject({ requestId: req.id, body: '{"token":"{{token}}","user":"ann"}' });
  });
});
