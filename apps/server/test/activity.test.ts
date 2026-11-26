import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestHistory } from '../src/db/schema.ts';
import { createHarness, TOKEN, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

/** A call as the desktop app makes it, so changes are attributed to you. */
async function app(method: string, url: string, body?: unknown) {
  const res = await h.app.inject({ method: method as 'GET', url, headers: { authorization: `Bearer ${TOKEN}`, 'x-postguy-client': 'w1' }, ...(body !== undefined && { payload: body as object }) });
  return JSON.parse(res.body || 'null');
}
const activity = async (query = '') => (await h.call('GET', `/activity${query}`)).body as { items: any[]; next: number | null };

describe('activity log', () => {
  it('merges sends, changes and flow runs, newest first, saying who did each', async () => {
    const col = await app('POST', '/collections', { name: 'Shop', parentId: null });
    const req = await app('POST', '/requests', { collectionId: col.id, name: 'Echo', method: 'GET', url: `${h.mockUrl}/echo`, scripts: { pre: `await fetch('${h.mockUrl}/health')`, post: '' } });
    await app('POST', '/send', { requestId: req.id, collectionId: col.id, request: req });
    const flow = (await h.call('POST', '/flows', { name: 'Check', collectionId: col.id })).body;
    await h.call('PUT', `/flows/${flow.id}/graph`, { steps: [{ id: 's1', name: 'Echo', kind: 'request', requestId: req.id }], connections: [] });
    const run = (await h.call('POST', `/flows/${flow.id}/run`, {})).body;
    for (let i = 0; i < 50 && (await h.call('GET', `/executions/${run.id}`)).body.status === 'running'; i++) await new Promise((r) => setTimeout(r, 50));

    const { items } = await activity();
    const kinds = items.map((i) => `${i.kind}:${i.who}`);
    expect(kinds).toEqual(expect.arrayContaining(['send:you', 'send:script', 'change:you', 'flow:you']));
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort((a, b) => b - a));
    const flowItem = items.find((i) => i.kind === 'flow');
    expect(flowItem).toMatchObject({ flow: 'Check', passed: 1, failed: 0, total: 1 });
    const change = items.find((i) => i.kind === 'change' && i.change.entityType === 'request');
    expect(change).toMatchObject({ collection: 'Shop', change: { label: 'Echo', action: 'create' } });

    // The request's script ran twice: once for the send, once in the flow.
    expect((await activity('?kinds=send&who=script')).items.map((i) => i.url)).toEqual([`${h.mockUrl}/health`, `${h.mockUrl}/health`]);
    expect((await activity('?q=Echo&kinds=change')).items.every((i) => i.change.label === 'Echo')).toBe(true);
  });

  it('pages by time', async () => {
    const col = await app('POST', '/collections', { name: 'Shop', parentId: null });
    for (let i = 0; i < 5; i++) await app('POST', '/requests', { collectionId: col.id, name: `R${i}`, method: 'GET', url: 'http://x' });
    const first = await activity('?limit=3');
    expect(first.items.length).toBeGreaterThanOrEqual(3);
    const second = await activity(`?limit=3&before=${first.next}`);
    const names = [...first.items, ...second.items].map((i) => i.change.label);
    expect(names.sort()).toEqual(['R0', 'R1', 'R2', 'R3', 'R4', 'Shop']);
  });

  it('records environment variable changes and switches, with secrets masked, and can undo them', async () => {
    const env = (await h.call('POST', '/environments', { name: 'Local' })).body;
    await app('PUT', `/variables/environment/${env.id}`, { variables: [{ key: 'token', value: 'env-s3cret', isSecret: true }] });
    await app('POST', `/environments/${env.id}/activate`, {});
    const { items } = await activity('?kinds=change');
    const [switched, vars] = items.map((i) => i.change);
    expect(switched).toMatchObject({ entityType: 'active-environment', label: 'Local', before: null, after: { id: env.id, name: 'Local' }, restorable: true });
    expect(vars).toMatchObject({ entityType: 'environment', label: 'Local', before: [] });
    expect(JSON.stringify(items)).not.toContain('env-s3cret');
    await h.call('POST', `/changes/${switched.id}/restore`, {});
    expect((await h.call('GET', '/environments')).body.find((e: any) => e.id === env.id).isActive).toBe(false);
  });

  it('masks secret values in collection variable changes', async () => {
    const col = await app('POST', '/collections', { name: 'Shop', parentId: null });
    await app('PUT', `/variables/collection/${col.id}`, { variables: [{ key: 'token', value: 'col-s3cret', isSecret: true }] });
    await new Promise((r) => setTimeout(r, 5));
    await h.call('PUT', `/variables/collection/${col.id}`, { variables: [{ key: 'token', value: 'col-s3cret', isSecret: true }, { key: 'b', value: '1' }] });
    const changes = (await h.call('GET', `/collections/${col.id}/changes`)).body;
    expect(JSON.stringify(changes)).not.toContain('col-s3cret');
  });

  it('pages without skipping entries that share a millisecond', async () => {
    const at = Date.now() - 1000;
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: `h${i}`,
      method: 'GET',
      url: `http://x.test/${i}`,
      request: { headers: {}, body: null },
      timing: { totalMs: 1 },
      createdAt: i < 3 ? at : i < 6 ? at - 1 : at - 2,
    }));
    h.db.insert(requestHistory).values(rows).run();
    const seen: string[] = [];
    let next: number | null | undefined;
    for (let pages = 0; pages < 10 && next !== null; pages++) {
      const page = await activity(`?kinds=send&limit=2${next ? `&before=${next}` : ''}`);
      seen.push(...page.items.map((i) => i.id));
      next = page.next;
    }
    expect(seen.sort()).toEqual(rows.map((r) => r.id).sort());
  });
});
