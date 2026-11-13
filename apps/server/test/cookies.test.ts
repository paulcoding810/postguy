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

const login = (settings: Record<string, unknown> = {}) =>
  h.call('POST', '/send', {
    request: { name: 'Login', method: 'POST', url: `${h.mockUrl}/auth/login`, body: { mode: 'json', raw: '{"username":"john","password":"secret"}' }, settings },
  });
const echo = async (extra: Record<string, unknown> = {}) => {
  const res = (await h.call('POST', '/send', { request: { name: 'Echo', method: 'GET', url: `${h.mockUrl}/echo`, ...extra } })).body;
  return { res, headers: JSON.parse(res.body).headers as Record<string, string> };
};

describe('cookie jar', () => {
  it('sends a cookie set by an earlier response and masks it in history', async () => {
    expect((await login()).status).toBe(200);
    const { res, headers } = await echo();
    expect(headers.cookie).toMatch(/^session=tok_/);
    expect(res.request.headers.Cookie).toBe('••••••');
    const jar = (await h.call('GET', '/cookies')).body;
    expect(jar).toEqual([expect.objectContaining({ name: 'session', domain: '127.0.0.1', path: '/', httpOnly: true, environmentId: null })]);
  });

  it('keeps a Cookie header the request sets itself', async () => {
    await login();
    const { headers } = await echo({ headers: [{ id: 'c', key: 'Cookie', value: 'mine=1', enabled: true }] });
    expect(headers.cookie).toBe('mine=1');
  });

  it('can be turned off per request', async () => {
    await login({ cookies: false });
    expect((await h.call('GET', '/cookies')).body).toEqual([]);
    await login();
    const { headers } = await echo({ settings: { cookies: false } });
    expect(headers.cookie).toBeUndefined();
  });

  it('stores cookies set on redirects and sends them to the redirect target', async () => {
    const res = (await h.call('POST', '/send', { request: { name: 'Hop', method: 'GET', url: `${h.mockUrl}/cookie-redirect` } })).body;
    expect(JSON.parse(res.body).headers.cookie).toBe('hop=1');
  });

  it('removes a cookie the server expires, and clears on request', async () => {
    await login();
    await h.call('POST', '/send', { request: { name: 'Logout', method: 'GET', url: `${h.mockUrl}/logout` } });
    expect((await h.call('GET', '/cookies')).body).toEqual([]);
    await login();
    const [c] = (await h.call('GET', '/cookies')).body;
    expect((await h.call('DELETE', `/cookies/${c.id}`)).body).toEqual({ ok: true });
    await login();
    expect((await h.call('DELETE', '/cookies')).body).toEqual({ removed: 1 });
    expect((await echo()).headers.cookie).toBeUndefined();
  });

  it('keeps a separate jar per environment', async () => {
    const env = (await h.call('POST', '/environments', { name: 'Staging' })).body;
    await h.call('POST', `/environments/${env.id}/activate`, {});
    await login();
    await h.call('POST', '/environments/deactivate', {});
    expect((await echo()).headers.cookie).toBeUndefined();
    expect((await h.call('GET', '/cookies')).body.map((c: any) => c.environmentId)).toEqual([env.id]);
    expect((await h.call('DELETE', `/cookies?environmentId=${env.id}`)).body).toEqual({ removed: 1 });
  });

  it('gives scripts pm.cookies for the request URL', async () => {
    await login();
    const res = (
      await h.call('POST', '/send', {
        request: {
          name: 'Echo',
          method: 'GET',
          url: `${h.mockUrl}/echo`,
          scripts: { pre: "pm.test('pre sees it', () => pm.expect(pm.cookies.has('session')).to.equal(true))", post: "pm.test('post value', () => pm.expect(pm.cookies.get('session')).to.match(/^tok_/))" },
        },
      })
    ).body;
    expect(res.scripts.flatMap((s: any) => s.assertions)).toEqual([
      { ok: true, message: 'pre sees it' },
      { ok: true, message: 'post value' },
    ]);
  });

  it('carries the session through a flow run', async () => {
    const col = (await h.call('POST', '/collections', { name: 'Shop', parentId: null })).body;
    const loginReq = (await h.call('POST', '/requests', { collectionId: col.id, name: 'Login', method: 'POST', url: `${h.mockUrl}/auth/login`, body: { mode: 'json', raw: '{"username":"john","password":"secret"}' } })).body;
    const echoReq = (await h.call('POST', '/requests', { collectionId: col.id, name: 'Echo', method: 'GET', url: `${h.mockUrl}/echo` })).body;
    const flow = (await h.call('POST', '/flows', { name: 'Session' })).body;
    await h.call('PUT', `/flows/${flow.id}/graph`, {
      steps: [
        { id: 's1', name: 'Login', kind: 'request', requestId: loginReq.id },
        { id: 's2', name: 'Echo', kind: 'request', requestId: echoReq.id },
      ],
      connections: [{ id: 'c1', source: 's1', target: 's2' }],
    });
    const exec = (await h.call('POST', `/flows/${flow.id}/run`, {})).body;
    await waitForExecution(exec.id);
    const detail = (await h.call('GET', `/executions/${exec.id}`)).body;
    expect(detail.status).toBe('success');
    const echoStep = detail.steps.find((s: any) => s.stepName === 'Echo');
    expect(echoStep.response.body.headers.cookie).toMatch(/^session=tok_/);
  });
});
