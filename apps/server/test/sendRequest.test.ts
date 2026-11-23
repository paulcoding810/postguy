import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

const send = async (scripts: { pre?: string; post?: string }, collectionId: string | null = null) =>
  (
    await h.call('POST', '/send', {
      collectionId,
      request: { name: 'Main', method: 'GET', url: `${h.mockUrl}/echo`, scripts: { pre: scripts.pre ?? '', post: scripts.post ?? '' } },
    })
  ).body;

describe('pm.sendRequest', () => {
  it('fetches a token in a pre-request script and uses it on the request', async () => {
    const col = (await h.call('POST', '/collections', { name: 'Shop', parentId: null })).body;
    await h.call('PUT', `/variables/collection/${col.id}/base`, { value: h.mockUrl });
    const res = await send(
      {
        pre: `const r = await pm.sendRequest({ url: '{{base}}/echo?step=login', method: 'POST', header: { 'Content-Type': 'application/json' }, body: { mode: 'raw', raw: JSON.stringify({ user: 'ann' }) } });
pm.collectionVariables.set('who', r.json().body.user);
pm.request.headers.upsert({ key: 'X-Who', value: r.json().body.user });`,
      },
      col.id,
    );
    expect(res.error).toBeNull();
    expect(JSON.parse(res.body).headers['x-who']).toBe('ann');
    expect(res.scripts[0].logs[0].message).toMatch(/^pm\.sendRequest POST \{\{base\}\}\/echo\?step=login → 200 in \d+ ms$/);
    const history = (await h.call('GET', '/history?limit=5')).body;
    expect(history.map((e: any) => [e.method, e.source])).toEqual([
      ['GET', null],
      ['POST', 'script'],
    ]);
    expect((await h.call('GET', `/variables/collection/${col.id}`)).body.find((v: any) => v.key === 'who').value).toBe('ann');
  });

  it('works in a post-response script and reports a failed send to the callback', async () => {
    const res = await send({ post: `pm.sendRequest('http://127.0.0.1:1/nothing', (err, r) => pm.test('reached', () => pm.expect(err).to.equal(null)));` });
    expect(res.status).toBe(200);
    expect(res.scripts[0].assertions).toEqual([{ ok: false, message: expect.stringMatching(/^reached/) }]);
  });

  it('refuses a relative URL with a clear message', async () => {
    const res = await send({ pre: `await pm.sendRequest('/login');` });
    expect(res.error.message).toMatch(/needs a full http\(s\) URL/);
  });
});
