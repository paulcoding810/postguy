import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture } from '@postguy/mock-api';
import { parse as parseYaml } from 'yaml';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('OpenAPI import', () => {
  it('imports pasted YAML into a tagged collection with variables and operation links', async () => {
    const res = await h.call('POST', '/openapi/import', { sourceType: 'paste', content: fixture('mock-api.openapi.yaml') });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requestCount: 6 });
    expect(res.body.warnings).toEqual([expect.stringMatching(/^baseUrl is set on the collection to .+ environment's baseUrl is ignored/)]);
    const tree = (await h.call('GET', '/collections/tree')).body;
    const root = tree.find((c: any) => c.id === res.body.collectionId);
    expect(root).toMatchObject({ name: 'Postguy Mock Shop API', openapiSpecId: res.body.spec.id, auth: { type: 'bearer' } });
    expect(root.children.map((c: any) => c.name)).toEqual(['Auth', 'Users', 'Orders']);
    const vars = (await h.call('GET', `/variables/collection/${root.id}`)).body;
    expect(vars.map((v: any) => v.key)).toEqual(['baseUrl', 'accessToken']);

    const profileId = root.children[1].requests[0].id;
    const op = (await h.call('GET', `/requests/${profileId}/operation`)).body;
    expect(op.operation).toMatchObject({ id: 'getUser', method: 'GET', path: '/users/{id}' });
    const saved = (await h.call('GET', `/requests/${profileId}`)).body;
    expect(saved).toMatchObject({ openapiOperationId: 'getUser', url: '{{baseUrl}}/users/:id' });
    expect(saved.openapiFingerprint).toBeTruthy();

    const detail = (await h.call('GET', `/openapi/${res.body.spec.id}`)).body;
    expect(detail.model.operations).toHaveLength(6);
    expect(detail.versions).toHaveLength(1);
  });

  it('imports from a URL and a generated request runs against the mock API', async () => {
    const res = await h.call('POST', '/openapi/import', { sourceType: 'url', url: `${h.mockUrl}/openapi.yaml` });
    expect(res.status).toBe(200);
    const root = (await h.call('GET', '/collections/tree')).body[0];
    await h.call('PUT', `/variables/collection/${root.id}`, { variables: [{ key: 'baseUrl', value: h.mockUrl }, { key: 'accessToken', value: '' }] });
    const loginId = root.children[0].requests[0].id;
    const login = (await h.call('GET', `/requests/${loginId}`)).body;
    const sent = (await h.call('POST', '/send', { requestId: loginId, request: login })).body;
    expect(sent.status).toBe(200);
  });

  it('rejects invalid specs and bad URLs', async () => {
    expect((await h.call('POST', '/openapi/import', { sourceType: 'paste', content: 'hello: world' })).status).toBe(422);
    expect((await h.call('POST', '/openapi/import', { sourceType: 'url', url: 'file:///etc/passwd' })).status).toBe(400);
    expect((await h.call('POST', '/openapi/import', { sourceType: 'url', url: 'http://127.0.0.1:1/x' })).status).toBe(502);
  });

  it('exports a collection to OpenAPI YAML without secrets', async () => {
    const res = await h.call('POST', '/openapi/import', { sourceType: 'paste', content: fixture('mock-api.openapi.yaml') });
    await h.call('PUT', `/variables/collection/${res.body.collectionId}`, {
      variables: [{ key: 'baseUrl', value: 'http://localhost:4780' }, { key: 'accessToken', value: 'tok-SECRET', isSecret: true }],
    });
    const out = await h.app.inject({ url: `/collections/${res.body.collectionId}/export/openapi?format=yaml`, headers: { authorization: 'Bearer test-token' } });
    expect(out.headers['content-type']).toMatch(/yaml/);
    expect(out.body).not.toContain('tok-SECRET');
    const doc = parseYaml(out.body);
    expect(Object.keys(doc.paths)).toContain('/users/{id}');
    expect(doc.tags.map((t: any) => t.name)).toEqual(['Auth', 'Users', 'Orders']);
  });

  it('deleting a spec keeps its collection', async () => {
    const res = await h.call('POST', '/openapi/import', { sourceType: 'paste', content: fixture('petstore.swagger2.json') });
    await h.call('DELETE', `/openapi/${res.body.spec.id}`);
    expect((await h.call('GET', '/openapi')).body).toEqual([]);
    expect((await h.call('GET', `/collections/${res.body.collectionId}`)).body.openapiSpecId).toBeNull();
  });
});

describe('import detection', () => {
  it('imports a Postman collection given to the OpenAPI import, and explains unknown files', async () => {
    const res = await h.call('POST', '/openapi/import', { sourceType: 'file', content: fixture('shop.postman_collection.json') });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'postman', name: 'Shop (Postman)', spec: null, requestCount: 3 });
    expect((await h.call('GET', '/openapi')).body).toEqual([]);

    const exported = (await h.call('GET', `/collections/${res.body.collectionId}/export`)).body;
    const again = (await h.call('POST', '/openapi/import', { sourceType: 'paste', content: JSON.stringify(exported), name: 'Copy' })).body;
    expect(again).toMatchObject({ kind: 'postguy', name: 'Copy', requestCount: 3 });

    const bad = await h.call('POST', '/openapi/import', { sourceType: 'paste', content: '{"hello":"world"}' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toMatch(/not an OpenAPI or Swagger file.*Postman/);
  });
});
