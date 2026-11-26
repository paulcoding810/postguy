import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture } from '@postguy/mock-api';
import { createHarness, TOKEN, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

/** A call as the desktop app makes it, so changes are attributed to "app". */
async function app(method: string, url: string, body?: unknown) {
  const res = await h.app.inject({ method: method as 'GET', url, headers: { authorization: `Bearer ${TOKEN}`, 'x-postguy-client': 'w1' }, ...(body !== undefined && { payload: body as object }) });
  return JSON.parse(res.body || 'null');
}

const changes = async (collectionId: string, entityId?: string) =>
  (await h.call('GET', `/collections/${collectionId}/changes${entityId ? `?entityId=${entityId}` : ''}`)).body as any[];

async function setup() {
  const col = await app('POST', '/collections', { name: 'Shop', parentId: null });
  const folder = await app('POST', '/collections', { name: 'Users', parentId: col.id });
  const req = await app('POST', '/requests', { collectionId: folder.id, name: 'Login', method: 'POST', url: '{{baseUrl}}/login', scripts: { pre: '', post: "pm.test('ok', () => {})" } });
  return { col, folder, req };
}

describe('collection change history', () => {
  it('records who changed what, ignoring reorders and merging quick edits', async () => {
    const { col, req } = await setup();
    await app('PATCH', `/requests/${req.id}`, { url: '{{baseUrl}}/v2/login' });
    await app('PATCH', `/requests/${req.id}`, { url: '{{baseUrl}}/v3/login' });
    await app('PATCH', `/requests/${req.id}`, { sortOrder: 9 });
    await h.call('PATCH', `/requests/${req.id}`, { name: 'Sign in' });
    const list = await changes(col.id);
    expect(list.map((c) => [c.entityType, c.action, c.source, c.label])).toEqual([
      ['request', 'update', 'api', 'Sign in'],
      ['request', 'update', 'app', 'Login'],
      ['request', 'create', 'app', 'Login'],
      ['collection', 'create', 'app', 'Users'],
      ['collection', 'create', 'app', 'Shop'],
    ]);
    const merged = list[1];
    expect(merged.before.request.url).toBe('{{baseUrl}}/login');
    expect(merged.after.request.url).toBe('{{baseUrl}}/v3/login');
    expect((await changes(col.id, req.id)).length).toBe(3);
  });

  it('restores an earlier version, and the restore can itself be undone', async () => {
    const { col, req } = await setup();
    await app('PATCH', `/requests/${req.id}`, { url: 'http://wrong', scripts: { post: '' } });
    const [edit] = await changes(col.id);
    expect((await h.call('POST', `/changes/${edit.id}/restore`, {})).body.message).toBe('Restored the earlier version of "Login".');
    const back = (await h.call('GET', `/requests/${req.id}`)).body;
    expect(back.url).toBe('{{baseUrl}}/login');
    expect(back.scripts.post).toBe("pm.test('ok', () => {})");
    const [restore] = await changes(col.id);
    expect(restore).toMatchObject({ action: 'update', source: 'api', restorable: true });
    expect(restore.before.request.url).toBe('http://wrong');
  });

  it('brings back a deleted request with its id, scripts, variables and flow steps', async () => {
    const { col, req } = await setup();
    await h.call('PUT', `/variables/request/${req.id}`, { variables: [{ key: 'user', value: 'ann' }] });
    const flow = (await h.call('POST', '/flows', { name: 'F' })).body;
    await h.call('PUT', `/flows/${flow.id}/graph`, { steps: [{ id: 's1', name: 'Login', kind: 'request', requestId: req.id }], connections: [] });
    await app('DELETE', `/requests/${req.id}`);
    expect((await h.call('GET', `/flows/${flow.id}`)).body.steps[0].requestId).toBeNull();
    const [deletion] = await changes(col.id);
    expect(deletion).toMatchObject({ action: 'delete', entityId: req.id, restorable: true });
    await h.call('POST', `/changes/${deletion.id}/restore`, {});
    const back = (await h.call('GET', `/requests/${req.id}`)).body;
    expect(back).toMatchObject({ id: req.id, name: 'Login', url: '{{baseUrl}}/login' });
    expect(back.scripts.post).toBe("pm.test('ok', () => {})");
    expect((await h.call('GET', `/variables/request/${req.id}`)).body.map((v: any) => v.key)).toEqual(['user']);
    expect((await h.call('GET', `/flows/${flow.id}`)).body.steps[0].requestId).toBe(req.id);
  });

  it('restoring an edit leaves examples and flow links as they are now, even after an undelete', async () => {
    const { col, req } = await setup();
    const ex = (await h.call('POST', `/requests/${req.id}/examples`, { name: '200 OK', status: 200, headers: {}, body: '{}' })).body;
    const flow = (await h.call('POST', '/flows', { name: 'F' })).body;
    await h.call('PUT', `/flows/${flow.id}/graph`, { steps: [{ id: 's1', name: 'Login', kind: 'request', requestId: req.id }], connections: [] });
    await app('DELETE', `/requests/${req.id}`);
    await h.call('POST', `/changes/${(await changes(col.id))[0].id}/restore`, {});
    await h.call('DELETE', `/examples/${ex.id}`);
    await h.call('PUT', `/flows/${flow.id}/graph`, { steps: [{ id: 's1', name: 'Login', kind: 'request', requestId: null }], connections: [] });
    await app('PATCH', `/requests/${req.id}`, { url: '{{baseUrl}}/login2' });
    const edit = (await changes(col.id, req.id)).find((c) => c.action === 'update');
    await h.call('POST', `/changes/${edit.id}/restore`, {});
    expect((await h.call('GET', `/requests/${req.id}`)).body.url).toBe('{{baseUrl}}/login');
    expect((await h.call('GET', `/requests/${req.id}/examples`)).body).toEqual([]);
    expect((await h.call('GET', `/flows/${flow.id}`)).body.steps[0].requestId).toBeNull();
  });

  it('brings back a deleted folder and a deleted collection with everything in them', async () => {
    const { col, folder, req } = await setup();
    await app('DELETE', `/collections/${folder.id}`);
    const [folderDeletion] = await changes(col.id);
    expect(folderDeletion).toMatchObject({ entityType: 'collection', action: 'delete', label: 'Users' });
    await h.call('POST', `/changes/${folderDeletion.id}/restore`, {});
    expect((await h.call('GET', `/requests/${req.id}`)).body.collectionId).toBe(folder.id);

    const flow = (await h.call('POST', '/flows', { name: 'Checkout', collectionId: col.id })).body;
    await app('DELETE', `/collections/${col.id}`);
    expect((await h.call('GET', `/flows/${flow.id}`)).body.collectionId).toBeNull();
    const deleted = (await h.call('GET', '/changes/deleted')).body;
    expect(deleted.map((d: any) => d.label)).toEqual(['Shop']);
    expect((await h.call('POST', `/changes/${deleted[0].id}/restore`, {})).body.message).toBe('Brought back "Shop" and everything in it.');
    const tree = (await h.call('GET', '/collections/tree')).body;
    expect(tree[0]).toMatchObject({ id: col.id, children: [{ id: folder.id, requests: [{ id: req.id }] }] });
    expect((await h.call('GET', '/changes/deleted')).body).toEqual([]);
    expect((await h.call('GET', `/flows/${flow.id}`)).body.collectionId).toBe(col.id);
  });

  it('records collection variables with secrets masked, and restores them', async () => {
    const { col } = await setup();
    await app('PUT', `/variables/collection/${col.id}`, { variables: [{ key: 'token', value: 's3cret', isSecret: true }, { key: 'baseUrl', value: 'http://a' }] });
    await app('PUT', `/variables/collection/${col.id}`, { variables: [{ key: 'baseUrl', value: 'http://b' }] });
    const [vars] = await changes(col.id);
    expect(vars).toMatchObject({ entityType: 'variables', label: 'Shop' });
    expect(JSON.stringify(vars)).not.toContain('s3cret');
    expect(vars.before).toEqual([]);
    expect(vars.after.map((v: any) => [v.key, v.value])).toEqual([['baseUrl', 'http://b']]);
    await h.call('POST', `/changes/${vars.id}/restore`, {});
    expect((await h.call('GET', `/variables/collection/${col.id}`)).body).toEqual([]);
  });

  it('logs an import as one entry and ignores values set by scripts', async () => {
    const imp = (await h.call('POST', '/openapi/import', { sourceType: 'paste', content: fixture('mock-api.openapi.yaml') })).body;
    await h.call('PUT', `/variables/collection/${imp.collectionId}/baseUrl`, { value: h.mockUrl });
    const before = (await changes(imp.collectionId)).length;
    expect((await changes(imp.collectionId)).at(-1)).toMatchObject({ action: 'create', source: 'import' });
    const tree = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === imp.collectionId);
    const login = [tree, ...tree.children].flatMap((c: any) => c.requests).find((r: any) => r.name === 'Login');
    await h.call('PATCH', `/requests/${login.id}`, { scripts: { post: "pm.collectionVariables.set('accessToken', pm.response.json().data.access_token)" } });
    const saved = (await h.call('GET', `/requests/${login.id}`)).body;
    await h.call('POST', '/send', { requestId: login.id, request: saved });
    const after = await changes(imp.collectionId);
    expect(after.length).toBe(before + 1);
    expect(after[0]).toMatchObject({ entityType: 'request', label: 'Login' });
  });
});
