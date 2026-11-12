import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MASK } from '@postguy/core';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

async function setupEnv() {
  const env = (await h.call('POST', '/environments', { name: 'Local' })).body;
  await h.call('POST', `/environments/${env.id}/activate`, {});
  await h.call('PUT', `/variables/environment/${env.id}`, {
    variables: [
      { key: 'baseUrl', value: h.mockUrl },
      { key: 'password', value: 'secret', isSecret: true },
    ],
  });
  return env;
}

const login = {
  name: 'Login',
  method: 'POST',
  url: '{{baseUrl}}/auth/login',
  body: { mode: 'json', raw: '{"username":"john","password":"{{password}}"}' },
};

describe('POST /send', () => {
  it('executes a request with environment variables and records redacted history', async () => {
    await setupEnv();
    const res = (await h.call('POST', '/send', { request: login })).body;
    expect(res.status).toBe(200);
    expect(res.error).toBeNull();
    expect(res.unresolved).toEqual([]);
    expect(res.contentType).toMatch(/application\/json/);
    expect(JSON.parse(res.body).data.access_token).toMatch(/^tok_/);
    expect(res.cookies[0]).toMatchObject({ name: 'session', httpOnly: true });
    expect(res.size).toBeGreaterThan(0);
    expect(res.timing.totalMs).toBeGreaterThan(0);

    const hist = (await h.call('GET', '/history')).body;
    expect(hist).toHaveLength(1);
    const entry = (await h.call('GET', `/history/${hist[0].id}`)).body;
    expect(entry.request.body).toBe(`{"username":"john","password":"${MASK}"}`);
    expect(entry.responseHeaders['set-cookie']).toBe(MASK);
    expect(entry.status).toBe(200);
  });

  it('applies inherited collection bearer auth and path params', async () => {
    await setupEnv();
    const tokenRes = JSON.parse((await h.call('POST', '/send', { request: login })).body.body);
    const root = (
      await h.call('POST', '/collections', { name: 'Shop', auth: { type: 'bearer', token: '{{token}}' } })
    ).body;
    const folder = (await h.call('POST', '/collections', { name: 'Users', parentId: root.id })).body;
    await h.call('PUT', `/variables/collection/${root.id}`, {
      variables: [{ key: 'token', value: tokenRes.data.access_token, isSecret: true }],
    });
    const saved = (
      await h.call('POST', '/requests', {
        collectionId: folder.id,
        name: 'Profile',
        method: 'GET',
        url: '{{baseUrl}}/users/:id',
        pathParams: [{ id: 'p', key: 'id', value: '1001', enabled: true }],
      })
    ).body;
    const res = (await h.call('POST', '/send', { requestId: saved.id, request: saved })).body;
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.email).toBe('john@example.com');
    expect(res.request.headers.Authorization).toBe(`Bearer ${MASK}`);
    expect(res.request.url).toBe(`${h.mockUrl}/users/1001`);

    const perRequest = (await h.call('GET', `/history?requestId=${saved.id}`)).body;
    expect(perRequest).toHaveLength(1);
  });

  it('reports unresolved variables and network errors', async () => {
    const res = (await h.call('POST', '/send', { request: { name: 'x', method: 'GET', url: 'http://127.0.0.1:1/{{nope}}' } })).body;
    expect(res.unresolved).toEqual(['nope']);
    expect(res.status).toBeNull();
    expect(res.error.code).toBe('ECONNREFUSED');
  });

  it('honours timeout and redirect settings', async () => {
    await setupEnv();
    const slow = (
      await h.call('POST', '/send', { request: { name: 's', method: 'GET', url: '{{baseUrl}}/slow', settings: { timeoutMs: 200 } } })
    ).body;
    expect(slow.error.message).toMatch(/timed out/);
    const noFollow = (
      await h.call('POST', '/send', {
        request: { name: 'r', method: 'GET', url: '{{baseUrl}}/redirect', settings: { followRedirects: false } },
      })
    ).body;
    expect(noFollow.status).toBe(302);
    const follow = (await h.call('POST', '/send', { request: { name: 'r', method: 'GET', url: '{{baseUrl}}/redirect' } })).body;
    expect(follow.status).toBe(200);
  });

  it('previews template resolution with masked secrets', async () => {
    await setupEnv();
    const [p] = (await h.call('POST', '/resolve-preview', { templates: ['{{baseUrl}}/x?p={{password}}&q={{missing}}'] })).body;
    expect(p.value).toBe(`${h.mockUrl}/x?p=${MASK}&q={{missing}}`);
    expect(p.unresolved).toEqual(['missing']);
    expect(p.refs.find((r: any) => r.ref === 'password')).toMatchObject({ secret: true, preview: MASK, source: 'environment' });
  });
});

describe('cURL', () => {
  it('imports a command and exports a runnable one with variables resolved', async () => {
    const imp = await h.call('POST', '/import/curl', { command: `curl -X POST '${'{{baseUrl}}'}/auth/login' -H 'Content-Type: application/json' -d '{"username":"john","password":"{{password}}"}'` });
    expect(imp.status).toBe(200);
    expect(imp.body.request).toMatchObject({ method: 'POST', url: '{{baseUrl}}/auth/login', body: { mode: 'json' } });
    expect((await h.call('POST', '/import/curl', { command: 'ls -la' })).status).toBe(422);

    await setupEnv();
    const exp = (await h.call('POST', '/export/curl', { request: imp.body.request })).body;
    expect(exp.unresolved).toEqual([]);
    expect(exp.containsSecrets).toBe(true);
    expect(exp.command).toContain(`curl -X POST ${h.mockUrl}/auth/login`);
    expect(exp.command).toContain(`--data-raw '{"username":"john","password":"secret"}'`);
  });
});
