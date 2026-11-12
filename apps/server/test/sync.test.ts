import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

const names = (root: any): string[] => [...root.requests.map((r: any) => r.name), ...root.children.flatMap(names)];

describe('OpenAPI sync', () => {
  it('previews and applies a new version while preserving manual edits', async () => {
    const imp = (await h.call('POST', '/openapi/import', { sourceType: 'url', url: `${h.mockUrl}/openapi.yaml` })).body;
    const tree = (await h.call('GET', '/collections/tree')).body;
    const root = tree.find((c: any) => c.id === imp.collectionId);
    const byName = (n: string) => [root, ...root.children].flatMap((c: any) => c.requests).find((r: any) => r.name === n).id;
    const ordersId = byName('Get User Orders');
    const profileId = byName('Get User Profile');
    await h.call('PATCH', `/requests/${profileId}`, { headers: [{ id: 'x', key: 'X-Mine', value: 'keep', enabled: true }] });

    const same = (await h.call('POST', `/openapi/${imp.spec.id}/sync/preview`, {})).body;
    expect(same.upToDate).toBe(true);

    const preview = (await h.call('POST', `/openapi/${imp.spec.id}/sync/preview`, { url: `${h.mockUrl}/openapi.v2.yaml` })).body;
    expect(preview).toMatchObject({ upToDate: false, fromVersion: '1.0.0', toVersion: '1.1.0' });
    expect(preview.diff.added.map((o: any) => o.path)).toEqual(['/users/{id}/addresses']);
    expect(preview.diff.removed.map((o: any) => o.path)).toEqual(['/health']);
    const changed = Object.fromEntries(preview.diff.changed.map((c: any) => [c.path, c.changes]));
    expect(changed['/users/{id}/orders']).toEqual(['query param page added']);
    expect(changed['/users/{id}']).toEqual(['response 200 schema changed']);
    const actions = Object.fromEntries(preview.requests.map((r: any) => [r.name, r.action]));
    expect(actions).toMatchObject({
      'Get User Orders': 'update',
      'Get User Profile': 'keep-edited',
      'Health check': 'orphaned',
      'Get User Addresses': 'create',
      Login: 'unchanged',
    });

    const applied = (await h.call('POST', `/openapi/${imp.spec.id}/sync`, { url: `${h.mockUrl}/openapi.v2.yaml` })).body;
    expect(applied.versionId).toBeTruthy();
    const orders = (await h.call('GET', `/requests/${ordersId}`)).body;
    expect(orders.params.map((p: any) => p.key)).toEqual(['status', 'limit', 'page']);
    const profile = (await h.call('GET', `/requests/${profileId}`)).body;
    expect(profile.headers.map((p: any) => p.key)).toEqual(['X-Mine']);
    const after = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === imp.collectionId);
    expect(names(after)).toContain('Get User Addresses');
    expect(names(after)).toContain('Health check');

    const detail = (await h.call('GET', `/openapi/${imp.spec.id}`)).body;
    expect(detail.versions.map((v: any) => v.label)).toEqual(['1.1.0', '1.0.0']);
    const cmp = (await h.call('GET', `/openapi/${imp.spec.id}/compare?from=${detail.versions[1].id}&to=${detail.versions[0].id}`)).body;
    expect(cmp.added).toHaveLength(1);

    const again = (await h.call('POST', `/openapi/${imp.spec.id}/sync/preview`, { url: `${h.mockUrl}/openapi.v2.yaml` })).body;
    expect(again.upToDate).toBe(true);
    const ordersAgain = again.requests.find((r: any) => r.name === 'Get User Orders');
    expect(ordersAgain.action).toBe('unchanged');
  });
});
