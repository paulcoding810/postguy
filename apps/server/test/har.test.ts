import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sampleHar } from '../../../packages/core/src/import/har.fixture.ts';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('HAR import', () => {
  it('imports API calls as requests, keeps the token secret and remembers recorded responses', async () => {
    const res = await h.call('POST', '/collections/import', { data: sampleHar() });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Shop admin');
    expect(res.body.warnings[0]).toBe('Imported 4 API calls from 2 hosts, one folder each.');

    const tree = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === res.body.id);
    expect(tree.children.map((f: any) => [f.name, f.requests.map((r: any) => r.name)])).toEqual([
      ['api.shop.test', ['GET /users/7', 'POST /orders', 'POST /login']],
      ['files.shop.test', ['POST /upload']],
    ]);
    const vars = (await h.call('GET', `/variables/collection/${res.body.id}`)).body;
    expect(vars.map((v: any) => [v.key, v.isSecret, v.value])).toEqual([['token', true, '••••••']]);

    const orders = tree.children[0].requests.find((r: any) => r.name === 'POST /orders');
    const snaps = (await h.call('GET', `/requests/${orders.id}/snapshots`)).body;
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ status: 201 });
    const [preview] = (await h.call('POST', '/resolve-preview', { collectionId: tree.children[0].id, templates: ['{{$res["POST /orders"].body.id}}'] })).body;
    expect(preview.value).toBe('ord_1');
  });

  it('works from the import dialog too, under the given name', async () => {
    const res = await h.call('POST', '/openapi/import', { sourceType: 'paste', content: JSON.stringify(sampleHar()), name: 'Recorded' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'har', name: 'Recorded', requestCount: 4 });
  });

  it('rejects a HAR with no API calls, saying why', async () => {
    const har = sampleHar();
    har.log.entries = har.log.entries.slice(0, 3);
    const res = await h.call('POST', '/collections/import', { data: har });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/No API calls found in this HAR: 3 entries/);
  });
});
