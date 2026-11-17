import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('flow names and duplicates', () => {
  it('suffixes new flows whose name is taken', async () => {
    const names = [];
    for (let i = 0; i < 3; i++) names.push((await h.call('POST', '/flows', { name: 'Checkout' })).body.name);
    expect(names).toEqual(['Checkout', 'Checkout (2)', 'Checkout (3)']);
    expect((await h.call('POST', '/flows', { name: 'checkout' })).body.name).toBe('checkout (4)');
  });

  it('copies steps, scripts, connections, variables and settings, but not runs or the runner mark', async () => {
    const col = (await h.call('POST', '/collections', { name: 'Shop', parentId: null })).body;
    const req = (await h.call('POST', '/requests', { collectionId: col.id, name: 'Echo', method: 'GET', url: `${h.mockUrl}/echo` })).body;
    const flow = (await h.call('POST', '/flows', { name: 'Checkout', collectionId: col.id })).body;
    await h.call('PATCH', `/flows/${flow.id}`, { settings: { stopOnError: false, runsCollection: true } });
    await h.call('PUT', `/flows/${flow.id}/graph`, {
      steps: [
        { id: 's1', name: 'First', kind: 'request', requestId: req.id, breakpoint: true, scripts: { pre: '', post: "flow.assert(true, 'ok')" }, overrides: { url: `${h.mockUrl}/echo?a=1` } },
        { id: 's2', name: 'Second', kind: 'request', requestId: req.id },
      ],
      connections: [{ id: 'c1', source: 's1', target: 's2' }],
    });
    await h.call('PUT', `/variables/flow/${flow.id}`, { variables: [{ key: 'user', value: 'ann' }, { key: 'pw', value: 's3cret', isSecret: true }] });
    await h.call('POST', `/flows/${flow.id}/run`, {});

    const copy = (await h.call('POST', `/flows/${flow.id}/duplicate`, {})).body;
    expect(copy.id).not.toBe(flow.id);
    expect(copy.name).toBe('Checkout (copy)');
    expect(copy.collectionId).toBe(col.id);
    expect(copy.settings).toEqual({ stopOnError: false });
    expect(copy.steps.map((s: any) => [s.name, s.requestId, s.breakpoint, s.scripts.post, s.overrides.url ?? null])).toEqual([
      ['First', req.id, true, "flow.assert(true, 'ok')", `${h.mockUrl}/echo?a=1`],
      ['Second', req.id, false, '', null],
    ]);
    expect(copy.connections).toEqual([{ id: 'c1', source: 's1', target: 's2', handle: 'out' }]);
    const vars = (await h.call('GET', `/variables/flow/${copy.id}?reveal=1`)).body;
    expect(vars.map((v: any) => [v.key, v.value, v.isSecret])).toEqual([
      ['user', 'ann', false],
      ['pw', 's3cret', true],
    ]);
    expect((await h.call('GET', `/flows/${copy.id}/executions`)).body).toEqual([]);

    const again = (await h.call('POST', `/flows/${flow.id}/duplicate`, {})).body;
    expect(again.name).toBe('Checkout (copy 2)');
    expect((await h.call('POST', `/flows/${copy.id}/duplicate`, {})).body.name).toBe('Checkout (copy 3)');

    await h.call('PUT', `/flows/${copy.id}/graph`, { steps: [{ id: 's1', name: 'Changed', kind: 'request', requestId: req.id }], connections: [] });
    const original = (await h.call('GET', `/flows/${flow.id}`)).body;
    expect(original.steps.map((s: any) => s.name)).toEqual(['First', 'Second']);
    expect(original.steps[0].scripts.post).toBe("flow.assert(true, 'ok')");
  });

  it('suffixes imported flows that clash with existing ones', async () => {
    const col = (await h.call('POST', '/collections', { name: 'Shop', parentId: null })).body;
    const req = (await h.call('POST', '/requests', { collectionId: col.id, name: 'Echo', method: 'GET', url: `${h.mockUrl}/echo` })).body;
    const flow = (await h.call('POST', '/flows', { name: 'Smoke', collectionId: col.id })).body;
    await h.call('PUT', `/flows/${flow.id}/graph`, { steps: [{ id: 's1', name: 'Echo', kind: 'request', requestId: req.id }], connections: [] });
    const exported = (await h.call('GET', `/collections/${col.id}/export`)).body;
    await h.call('POST', '/collections/import', { data: exported });
    expect((await h.call('GET', '/flows')).body.map((f: any) => f.name).sort()).toEqual(['Smoke', 'Smoke (2)']);
  });
});
