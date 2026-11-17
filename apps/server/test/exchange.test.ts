import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

const postmanEnv = {
  id: 'e1',
  name: 'Staging',
  values: [
    { key: 'baseUrl', value: 'https://staging.example.com', type: 'default', enabled: true },
    { key: 'token', value: '', type: 'secret', enabled: true },
    { key: 'old', value: 'x', type: 'default', enabled: false },
  ],
  _postman_variable_scope: 'environment',
};

describe('Postman environments', () => {
  it('imports an environment and exports it back in Postman format', async () => {
    const res = (await h.call('POST', '/environments/import', { data: postmanEnv })).body;
    expect(res.environment.name).toBe('Staging');
    expect(res.warnings).toEqual(['Secret values were empty in the file; fill them in: token.']);
    const vars = (await h.call('GET', `/variables/environment/${res.environment.id}?reveal=1`)).body;
    expect(vars.map((v: any) => [v.key, v.value, v.isSecret, v.enabled])).toEqual([
      ['baseUrl', 'https://staging.example.com', false, true],
      ['token', '', true, true],
      ['old', 'x', false, false],
    ]);
    const again = (await h.call('POST', '/environments/import', { data: postmanEnv })).body;
    expect(again.environment.name).toBe('Staging (2)');
    const out = (await h.call('GET', `/environments/${res.environment.id}/export`)).body;
    expect(out).toMatchObject({ name: 'Staging', _postman_variable_scope: 'environment' });
    expect(out.values).toEqual([
      { key: 'baseUrl', value: 'https://staging.example.com', type: 'default', enabled: true },
      { key: 'token', value: '', type: 'secret', enabled: true },
      { key: 'old', value: 'x', type: 'default', enabled: false },
    ]);
  });

  it('merges Postman globals into the global environment', async () => {
    const global = (await h.call('GET', '/environments')).body.find((e: any) => e.kind === 'global');
    await h.call('PUT', `/variables/global/${global.id}`, { variables: [{ key: 'keep', value: '1' }, { key: 'over', value: 'old' }] });
    await h.call('POST', '/environments/import', { data: { name: 'Globals', values: [{ key: 'over', value: 'new' }], _postman_variable_scope: 'globals' } });
    const vars = (await h.call('GET', `/variables/global/${global.id}?reveal=1`)).body;
    expect(Object.fromEntries(vars.map((v: any) => [v.key, v.value]))).toEqual({ keep: '1', over: 'new' });
  });

  it('rejects other files', async () => {
    expect((await h.call('POST', '/environments/import', { data: { info: {}, item: [] } })).status).toBe(400);
  });
});

describe('collection export with flows', () => {
  it('carries flows built from the collection and remaps their requests on import', async () => {
    const col = (await h.call('POST', '/collections', { name: 'Shop', parentId: null })).body;
    const folder = (await h.call('POST', '/collections', { name: 'Auth', parentId: col.id })).body;
    const login = (await h.call('POST', '/requests', { collectionId: folder.id, name: 'Login', method: 'POST', url: '{{baseUrl}}/login' })).body;
    const me = (await h.call('POST', '/requests', { collectionId: col.id, name: 'Me', method: 'GET', url: '{{baseUrl}}/me' })).body;
    const outside = (await h.call('POST', '/collections', { name: 'Other', parentId: null })).body;
    const stray = (await h.call('POST', '/requests', { collectionId: outside.id, name: 'Stray', method: 'GET', url: 'http://x' })).body;
    const flow = (await h.call('POST', '/flows', { name: 'Sign in' })).body;
    await h.call('PUT', `/flows/${flow.id}/graph`, {
      steps: [
        { id: 's1', name: 'Login', kind: 'request', requestId: login.id, scripts: { pre: '', post: "flow.set('t', 1)" } },
        { id: 's2', name: 'Me', kind: 'request', requestId: me.id, overrides: { auth: { type: 'bearer', token: 'secret-token' } } },
      ],
      connections: [{ id: 'c1', source: 's1', target: 's2' }],
    });
    await h.call('PUT', `/variables/flow/${flow.id}`, { variables: [{ key: 'user', value: 'ann' }] });
    const unrelated = (await h.call('POST', '/flows', { name: 'Elsewhere' })).body;
    await h.call('PUT', `/flows/${unrelated.id}/graph`, { steps: [{ id: 'x', name: 'Stray', kind: 'request', requestId: stray.id }], connections: [] });

    const exported = (await h.call('GET', `/collections/${col.id}/export`)).body;
    expect(exported.collection.flows.map((f: any) => f.name)).toEqual(['Sign in']);
    expect(JSON.stringify(exported)).not.toContain('secret-token');

    const imported = (await h.call('POST', '/collections/import', { data: exported })).body;
    expect(imported.warnings).toEqual([]);
    const flows = (await h.call('GET', '/flows')).body.filter((f: any) => f.name.startsWith('Sign in'));
    expect(flows.map((f: any) => f.name).sort()).toEqual(['Sign in', 'Sign in (2)']);
    const copy = (await h.call('GET', `/flows/${flows.find((f: any) => f.id !== flow.id).id}`)).body;
    expect(copy.collectionId).toBe(imported.id);
    const tree = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === imported.id);
    const newLogin = tree.children[0].requests[0];
    expect(copy.steps.map((s: any) => s.requestId)).toEqual([newLogin.id, tree.requests[0].id]);
    expect(copy.steps[0].scripts.post).toBe("flow.set('t', 1)");
    expect(copy.connections).toHaveLength(1);
    const vars = (await h.call('GET', `/variables/flow/${copy.id}`)).body;
    expect(vars.map((v: any) => v.key)).toEqual(['user']);
  });
});
