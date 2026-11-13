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

const v1 = fixture('mock-api.openapi.yaml');
const v2 = v1
  .replace('version: 1.0.0', 'version: 2.0.0')
  .replace(
    `        - $ref: '#/components/parameters/UserId'
        - name: status`,
    `        - $ref: '#/components/parameters/UserId'
        - name: page
          in: query
          required: true
          schema:
            type: integer
        - name: X-Tenant
          in: header
          required: true
          schema:
            type: string
        - name: status`,
  )
  .replace('  /orders/{orderId}:', '  /v2/orders/{orderId}:');

async function setup() {
  const imp = (await h.call('POST', '/openapi/import', { sourceType: 'paste', content: v1 })).body;
  const all = async () => {
    const root = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === imp.collectionId);
    return [root, ...root.children].flatMap((c: any) => c.requests);
  };
  const id = async (name: string) => (await all()).find((r: any) => r.name === name).id;
  const get = async (rid: string) => (await h.call('GET', `/requests/${rid}`)).body;
  return { imp, all, id, get };
}

describe('OpenAPI sync with edited and moved requests', () => {
  it('pairs a moved operation by operationId in the diff', async () => {
    const { imp } = await setup();
    const preview = (await h.call('POST', `/openapi/${imp.spec.id}/sync/preview`, { sourceType: 'paste', content: v2 })).body;
    expect(preview.diff.added).toEqual([]);
    expect(preview.diff.removed).toEqual([]);
    const moved = preview.diff.changed.find((c: any) => c.id === 'getOrder');
    expect(moved.path).toBe('/v2/orders/{orderId}');
    expect(moved.changes[0]).toBe('path moved /orders/{orderId} → /v2/orders/{orderId}');
  });

  it('adds new required params to an edited request, follows moved paths, and creates no duplicate', async () => {
    const { imp, all, id, get } = await setup();
    const ordersId = await id('Get User Orders');
    const detailId = await id('Get Order Details');
    const orders = await get(ordersId);
    await h.call('PATCH', `/requests/${ordersId}`, { params: [...orders.params, { id: 'dbg', key: 'debug', value: '1', enabled: true }] });
    const detail = await get(detailId);
    await h.call('PATCH', `/requests/${detailId}`, {
      pathParams: detail.pathParams.map((p: any) => ({ ...p, value: 'ord_42' })),
      headers: [{ id: 'm', key: 'X-Mine', value: 'keep', enabled: true }],
    });

    const preview = (await h.call('POST', `/openapi/${imp.spec.id}/sync/preview`, { sourceType: 'paste', content: v2 })).body;
    const row = (rid: string) => preview.requests.find((r: any) => r.requestId === rid);
    expect(row(ordersId)).toMatchObject({ action: 'merge-edited', adds: ['query page', 'header X-Tenant'] });
    expect(row(detailId)).toMatchObject({ action: 'merge-edited', moved: true, adds: ['URL /v2/orders/:orderId'] });
    expect(preview.requests.filter((r: any) => r.action === 'create' || r.action === 'orphaned')).toEqual([]);

    await h.call('POST', `/openapi/${imp.spec.id}/sync`, { sourceType: 'paste', content: v2 });
    const after = await get(ordersId);
    expect(after.params.map((p: any) => p.key)).toEqual(['status', 'limit', 'debug', 'page']);
    expect(after.headers.map((p: any) => p.key)).toEqual(['X-Tenant']);
    const moved = await get(detailId);
    expect(moved.url).toBe('{{baseUrl}}/v2/orders/:orderId');
    expect(moved.pathParams.map((p: any) => [p.key, p.value])).toEqual([['orderId', 'ord_42']]);
    expect(moved.headers.map((p: any) => p.key)).toEqual(['X-Mine']);
    expect((await all()).filter((r: any) => r.name === 'Get Order Details')).toHaveLength(1);

    const again = (await h.call('POST', `/openapi/${imp.spec.id}/sync/preview`, { sourceType: 'paste', content: v2 })).body;
    expect(again.upToDate).toBe(true);
  });

  it('still regenerates unedited requests, including moved ones', async () => {
    const { imp, id, get } = await setup();
    const ordersId = await id('Get User Orders');
    const detailId = await id('Get Order Details');
    const preview = (await h.call('POST', `/openapi/${imp.spec.id}/sync/preview`, { sourceType: 'paste', content: v2 })).body;
    expect(preview.requests.find((r: any) => r.requestId === ordersId).action).toBe('update');
    expect(preview.requests.find((r: any) => r.requestId === detailId)).toMatchObject({ action: 'update', moved: true });
    await h.call('POST', `/openapi/${imp.spec.id}/sync`, { sourceType: 'paste', content: v2 });
    expect((await get(ordersId)).headers.map((p: any) => p.key)).toEqual(['X-Tenant']);
    expect((await get(detailId)).url).toBe('{{baseUrl}}/v2/orders/:orderId');
  });

  it('adds missing required params to one request from its Docs tab', async () => {
    const { imp, id, get } = await setup();
    const ordersId = await id('Get User Orders');
    await h.call('POST', `/openapi/${imp.spec.id}/sync`, { sourceType: 'paste', content: v2 });
    await h.call('PATCH', `/requests/${ordersId}`, { params: [], headers: [] });
    expect((await h.call('GET', `/requests/${ordersId}/spec-merge`)).body).toEqual({ added: ['query page', 'header X-Tenant'] });
    const saved = (await h.call('POST', `/requests/${ordersId}/spec-merge`, {})).body;
    expect(saved.params.map((p: any) => p.key)).toEqual(['page']);
    expect(saved.headers.map((p: any) => p.key)).toEqual(['X-Tenant']);
    expect((await h.call('GET', `/requests/${ordersId}/spec-merge`)).body).toEqual({ added: [] });
    const plain = await h.call('POST', '/requests', { collectionId: (await get(ordersId)).collectionId, name: 'Manual', method: 'GET', url: 'http://x' });
    expect((await h.call('GET', `/requests/${plain.body.id}/spec-merge`)).body).toBeNull();
  });
});
