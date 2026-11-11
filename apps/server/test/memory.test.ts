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

async function importShop() {
  const imp = (await h.call('POST', '/openapi/import', { sourceType: 'paste', content: fixture('mock-api.openapi.yaml') })).body;
  const root = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === imp.collectionId);
  await h.call('PUT', `/variables/collection/${root.id}`, {
    variables: [
      { key: 'baseUrl', value: h.mockUrl },
      { key: 'accessToken', value: '{{Login.data.access_token}}', isSecret: true },
    ],
  });
  const byName = (name: string) =>
    [root, ...root.children].flatMap((c: any) => c.requests).find((r: any) => r.name === name).id as string;
  const send = async (name: string, patch: Record<string, unknown> = {}) => {
    const id = byName(name);
    const saved = (await h.call('GET', `/requests/${id}`)).body;
    return { id, res: (await h.call('POST', '/send', { requestId: id, request: { ...saved, ...patch } })).body };
  };
  return { root, byName, send };
}

describe('smart response memory', () => {
  it('remembers login, then resolves token and user id references with no manual copying', async () => {
    const { send } = await importShop();

    const login = await send('Login');
    expect(login.res.status).toBe(200);
    expect(login.res.snapshotId).toBeTruthy();
    expect(login.res.validation).toMatchObject({ ok: true, schemaSource: 'login 200' });

    const profile = await send('Get User Profile', {
      pathParams: [{ id: 'p', key: 'id', value: '{{Login.data.user.id}}', enabled: true }],
    });
    expect(profile.res.unresolved).toEqual([]);
    expect(profile.res.status).toBe(200);
    expect(profile.res.request.url).toBe(`${h.mockUrl}/users/1001`);
    expect(profile.res.validation.ok).toBe(true);

    const login2 = await send('Login');
    const token1 = JSON.parse(login.res.body).data.access_token;
    const token2 = JSON.parse(login2.res.body).data.access_token;
    expect(token2).not.toBe(token1);
    const [preview] = (await h.call('POST', '/resolve-preview', { templates: ['{{Login.data.access_token}}'] })).body;
    expect(preview.value).toBe(token2);
  });

  it('keeps history, shares schemas by hash, tracks latest success and pins', async () => {
    const { send, byName } = await importShop();
    await send('Login');
    await send('Login');
    const bad = await send('Login', { body: { mode: 'json', raw: '{"username":"john","password":"nope"}' } });
    expect(bad.res.status).toBe(401);
    expect(bad.res.validation).toMatchObject({ ok: true, schemaSource: 'login 401' });

    const loginId = byName('Login');
    const snaps = (await h.call('GET', `/requests/${loginId}/snapshots`)).body;
    expect(snaps).toHaveLength(3);
    expect(snaps.map((s: any) => s.isSuccess)).toEqual([false, true, true]);
    expect(snaps[1].schemaId).toBe(snaps[2].schemaId);
    expect(snaps[0].schemaId).not.toBe(snaps[1].schemaId);

    const req = (await h.call('GET', `/requests/${loginId}`)).body;
    expect(req.latestSuccessSnapshotId).toBe(snaps[1].id);

    const oldest = (await h.call('GET', `/snapshots/${snaps[2].id}`)).body;
    expect(oldest.paths.map((p: any) => p.path)).toContain('data.user.id');
    await h.call('POST', `/requests/${loginId}/pin-snapshot`, { snapshotId: snaps[2].id });
    const [preview] = (await h.call('POST', '/resolve-preview', { templates: ['{{Login.data.access_token}}'] })).body;
    expect(preview.value).toBe(oldest.body.data.access_token);

    const sources = (await h.call('GET', '/reference-sources')).body;
    expect(sources[0]).toMatchObject({ name: 'Login', pinned: true, shadowed: false });
    expect(sources[0].paths.some((p: any) => p.path === 'data.access_token')).toBe(true);

    const schema = (await h.call('GET', `/requests/${loginId}/schema`)).body;
    expect(schema.snapshotCount).toBe(2);
    expect(schema.inferred.properties.data.properties.user.required).toEqual(['id', 'name', 'role']);
    expect(schema.expected.map((e: any) => e.status)).toEqual(['200', '401']);
  });

  it('flags schema violations and skips non-JSON or unsaved responses', async () => {
    const { send } = await importShop();
    await send('Login');
    const health = await send('Health check');
    expect(health.res.validation.ok).toBe(true);
    const text = (await h.call('POST', '/send', { request: { name: 't', method: 'GET', url: `${h.mockUrl}/text` } })).body;
    expect(text.snapshotId).toBeNull();
    const unsaved = (await h.call('POST', '/send', { request: { name: 'h', method: 'GET', url: `${h.mockUrl}/health` } })).body;
    expect(unsaved.snapshotId).toBeNull();
    const wrong = await send('Get User Profile', { url: '{{baseUrl}}/health', pathParams: [] });
    expect(wrong.res.validation.ok).toBe(false);
    expect(wrong.res.validation.errors[0]).toEqual({ path: '(root)', message: 'missing required property "data"' });
  });
});
