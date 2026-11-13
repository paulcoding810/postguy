import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitForExecution } from '../src/services/flows.ts';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

const tag = (who: string) =>
  `const prev = pm.request.headers.get('X-Order'); pm.request.headers.upsert({ key: 'X-Order', value: prev ? prev + ',${who}' : '${who}' });`;
const check = (who: string) => `pm.test('${who} saw 200', () => pm.response.to.have.status(200));`;

async function setup() {
  const col = (await h.call('POST', '/collections', { name: 'Team', parentId: null, scripts: { pre: tag('collection'), post: check('collection') } })).body;
  const folder = (await h.call('POST', '/collections', { name: 'Users', parentId: col.id })).body;
  await h.call('PATCH', `/collections/${folder.id}`, { scripts: { pre: tag('folder'), post: check('folder') } });
  const req = (
    await h.call('POST', '/requests', {
      collectionId: folder.id,
      name: 'Echo',
      method: 'GET',
      url: `${h.mockUrl}/echo`,
      scripts: { pre: tag('request'), post: check('request') },
    })
  ).body;
  return { col, folder, req };
}

const sendSaved = async (id: string) => {
  const saved = (await h.call('GET', `/requests/${id}`)).body;
  return (await h.call('POST', '/send', { requestId: id, request: saved })).body;
};

describe('collection and folder scripts', () => {
  it('runs pre-request scripts from the collection inwards, each seeing the edits before it', async () => {
    const { req } = await setup();
    const res = await sendSaved(req.id);
    expect(JSON.parse(res.body).headers['x-order']).toBe('collection,folder,request');
    expect(res.scripts.filter((s: any) => s.phase === 'pre').map((s: any) => s.source)).toEqual(['collection "Team"', 'folder "Users"', 'request']);
  });

  it('runs post-response scripts in the same order and labels their tests', async () => {
    const { req } = await setup();
    const post = (await sendSaved(req.id)).scripts.filter((s: any) => s.phase === 'post');
    expect(post.map((s: any) => [s.source, s.assertions.map((a: any) => a.message)])).toEqual([
      ['collection "Team"', ['collection saw 200']],
      ['folder "Users"', ['folder saw 200']],
      ['request', ['request saw 200']],
    ]);
  });

  it('fails the send when a collection pre-request script throws', async () => {
    const { col, req } = await setup();
    await h.call('PATCH', `/collections/${col.id}`, { scripts: { pre: 'throw new Error("nope")' } });
    const res = await sendSaved(req.id);
    expect(res.error.code).toBe('SCRIPT_ERROR');
    expect(res.error.message).toContain('collection "Team"');
    expect(res.status).toBeNull();
  });

  it('keeps the other phase when only one is updated, and shows scripts on reads', async () => {
    const { col } = await setup();
    await h.call('PATCH', `/collections/${col.id}`, { scripts: { post: '' } });
    const got = (await h.call('GET', `/collections/${col.id}`)).body;
    expect(got.scripts).toEqual({ pre: tag('collection'), post: '' });
    const tree = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === col.id);
    expect(tree.children[0].scripts.post).toBe(check('folder'));
  });

  it('runs them for flow steps too', async () => {
    const { req } = await setup();
    const flow = (await h.call('POST', '/flows', { name: 'F' })).body;
    await h.call('PUT', `/flows/${flow.id}/graph`, { steps: [{ id: 's1', name: 'Echo', kind: 'request', requestId: req.id }], connections: [] });
    const exec = (await h.call('POST', `/flows/${flow.id}/run`, {})).body;
    await waitForExecution(exec.id);
    const step = (await h.call('GET', `/executions/${exec.id}`)).body.steps[0];
    expect(step.status).toBe('success');
    expect(step.request.headers['X-Order']).toBe('collection,folder,request');
    expect(step.scripts.map((s: any) => s.source)).toContain('folder "Users"');
  });

  it('round-trips through export and import', async () => {
    const { col } = await setup();
    const exported = (await h.call('GET', `/collections/${col.id}/export`)).body;
    expect(exported.collection.scripts.pre).toBe(tag('collection'));
    expect(exported.collection.folders[0].scripts.post).toBe(check('folder'));
    const imported = (await h.call('POST', '/collections/import', { data: exported })).body;
    expect((await h.call('GET', `/collections/${imported.id}`)).body.scripts.post).toBe(check('collection'));
    const copy = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === imported.id);
    expect(copy.children[0].scripts.pre).toBe(tag('folder'));
  });

  it('imports Postman collection and folder scripts and runs them', async () => {
    const data = {
      info: { name: 'PM', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      event: [{ listen: 'prerequest', script: { exec: ["pm.request.headers.add({ key: 'X-Request-Id', value: 'rid-1' });"] } }],
      item: [
        {
          name: 'Users',
          event: [{ listen: 'test', script: { exec: ["pm.test('folder 200', () => pm.response.to.have.status(200));"] } }],
          item: [{ name: 'Echo', request: { method: 'GET', url: `${h.mockUrl}/echo` } }],
        },
      ],
    };
    const imported = (await h.call('POST', '/collections/import', { data })).body;
    expect(imported.warnings).toEqual([]);
    const tree = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === imported.id);
    const res = await sendSaved(tree.children[0].requests[0].id);
    expect(JSON.parse(res.body).headers['x-request-id']).toBe('rid-1');
    expect(res.scripts.flatMap((s: any) => s.assertions.map((a: any) => a.message))).toEqual(['folder 200']);
  });
});
