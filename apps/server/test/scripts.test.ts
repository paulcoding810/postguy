import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture } from '@postguy/mock-api';
import { MASK } from '@postguy/core';
import { waitForExecution } from '../src/services/flows.ts';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

async function setup() {
  const imp = (await h.call('POST', '/openapi/import', { sourceType: 'paste', content: fixture('mock-api.openapi.yaml') })).body;
  const root = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === imp.collectionId);
  await h.call('PUT', `/variables/collection/${root.id}`, { variables: [{ key: 'baseUrl', value: h.mockUrl }] });
  const req = (name: string) => [root, ...root.children].flatMap((c: any) => c.requests).find((r: any) => r.name === name).id as string;
  return { root, req };
}

describe('scripts on requests', () => {
  it('stores scripts, edits the request before sending and runs assertions after', async () => {
    const { req } = await setup();
    const id = req('Login');
    await h.call('PATCH', `/requests/${id}`, {
      scripts: {
        pre: `request.headers['X-Trace'] = 'trace-' + (1 + 1); flow.log('about to', request.method);`,
        post: `flow.assert(response.status === 200, 'logged in'); flow.assert(response.body.data.user.id === 1, 'user is 1'); env.set('token', response.body.data.access_token);`,
      },
    });
    const saved = (await h.call('GET', `/requests/${id}`)).body;
    expect(saved.scripts.pre).toContain('X-Trace');
    const res = (await h.call('POST', '/send', { requestId: id, request: saved })).body;
    expect(res.status).toBe(200);
    expect(res.request.headers['X-Trace']).toBe('trace-2');
    expect(res.scripts.map((s: any) => [s.phase, s.source, s.ok])).toEqual([['pre', 'request', true], ['post', 'request', false]]);
    expect(res.scripts[1].assertions).toEqual([{ ok: true, message: 'logged in' }, { ok: false, message: 'user is 1' }]);
    const globals = (await h.call('GET', '/environments')).body.find((e: any) => e.kind === 'global');
    const vars = (await h.call('GET', `/variables/global/${globals.id}?reveal=1`)).body;
    expect(vars.find((v: any) => v.key === 'token').value).toBe(JSON.parse(res.body).data.access_token);
  });

  it('does not send when a pre-request script throws and masks secrets in logs', async () => {
    const { root, req } = await setup();
    await h.call('PUT', `/variables/collection/${root.id}`, { variables: [{ key: 'baseUrl', value: h.mockUrl }, { key: 'pw', value: 'secret', isSecret: true }] });
    const id = req('Health check');
    const saved = (await h.call('GET', `/requests/${id}`)).body;
    const bad = (await h.call('POST', '/send', { requestId: id, request: { ...saved, scripts: { pre: 'throw new Error("boom")', post: '' } } })).body;
    expect(bad.status).toBeNull();
    expect(bad.error).toEqual({ code: 'SCRIPT_ERROR', message: 'Pre-request script (request): Error: boom (line 1)' });
    expect(bad.historyId).toBeNull();
    const logged = (await h.call('POST', '/send', { requestId: id, request: { ...saved, scripts: { pre: '', post: 'flow.log("pw is", flow.get("pw"))' } } })).body;
    expect(logged.scripts[0].logs[0].message).toBe(`pw is ${MASK}`);
  });
});

describe('scripts in flows', () => {
  it('shares flow.set values between steps and fails steps on assertions', async () => {
    const { req } = await setup();
    const flow = (await h.call('POST', '/flows', { name: 'Scripted' })).body;
    await h.call('PUT', `/flows/${flow.id}/graph`, {
      steps: [
        {
          id: 's1',
          name: 'Login',
          kind: 'request',
          requestId: req('Login'),
          position: { x: 0, y: 0 },
          scripts: {
            pre: '',
            post: `const login = flow.response("Login"); flow.set("token", login.body.data.access_token); flow.set("userId", login.body.data.user.id); flow.assert(login.body.data.access_token != null);`,
          },
        },
        {
          id: 's2',
          name: 'Profile',
          kind: 'request',
          requestId: req('Get User Profile'),
          position: { x: 0, y: 100 },
          overrides: {
            pathParams: [{ id: 'p', key: 'id', value: '{{userId}}', enabled: true }],
            auth: { type: 'bearer', token: '{{token}}' },
          },
          scripts: { pre: '', post: `flow.assert(response.body.data.role === 'admin', 'is admin');` },
        },
      ],
      connections: [{ id: 'c1', source: 's1', target: 's2' }],
    });
    const graph = (await h.call('GET', `/flows/${flow.id}`)).body;
    expect(graph.steps[0].scripts.post).toContain('flow.set("token"');
    const exec = (await h.call('POST', `/flows/${flow.id}/run`, {})).body;
    await waitForExecution(exec.id);
    const detail = (await h.call('GET', `/executions/${exec.id}`)).body;
    expect(detail.steps.map((s: any) => [s.stepName, s.status, s.response?.status])).toEqual([['Login', 'success', 200], ['Profile', 'failed', 200]]);
    expect(detail.steps[1].error).toBe('Assertion failed: is admin');
    expect(detail.steps[1].request.url).toBe(`${h.mockUrl}/users/1001`);
    expect(detail.steps[1].logs.some((l: any) => l.message === '✗ is admin')).toBe(true);
    expect(detail.runtime).toBeUndefined();

    const rerun = (await h.call('POST', `/executions/${exec.id}/steps/s2/rerun`, {})).body;
    await waitForExecution(rerun.id);
    const after = (await h.call('GET', `/executions/${exec.id}`)).body;
    expect(after.steps.at(-1).request.url).toBe(`${h.mockUrl}/users/1001`);
  });
});

describe('Postman scripts', () => {
  it('runs an imported Postman test script and stores collection variables', async () => {
    const res = await h.call('POST', '/collections/import', {
      data: {
        info: { name: 'PM', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        variable: [{ key: 'baseUrl', value: h.mockUrl }],
        item: [
          {
            name: 'Login',
            event: [{ listen: 'test', script: { exec: ["pm.test('status 200', () => pm.response.to.have.status(200));", "pm.collectionVariables.set('token', pm.response.json().data.access_token);"] } }],
            request: { method: 'POST', url: '{{baseUrl}}/auth/login', body: { mode: 'raw', raw: '{"username":"john","password":"secret"}', options: { raw: { language: 'json' } } } },
          },
          { name: 'Me', request: { method: 'GET', url: '{{baseUrl}}/users/1001', auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] } } },
        ],
      },
    });
    const root = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === res.body.id);
    const [loginRow, meRow] = root.requests;
    const login = (await h.call('GET', `/requests/${loginRow.id}`)).body;
    const sent = (await h.call('POST', '/send', { requestId: login.id, request: login })).body;
    expect(sent.scripts[0].assertions).toEqual([{ ok: true, message: 'status 200' }]);
    const me = (await h.call('GET', `/requests/${meRow.id}`)).body;
    expect((await h.call('POST', '/send', { requestId: me.id, request: me })).body.status).toBe(200);
  });
});

describe('pm.request.body.update when sending', () => {
  it('sends the body a pre-request script set, as JSON or form-encoded', async () => {
    const send = (pre: string, body: Record<string, unknown> = { mode: 'none' }) =>
      h.call('POST', '/send', { request: { name: 'echo', method: 'POST', url: `${h.mockUrl}/echo`, body, scripts: { pre, post: '' } } }).then((r) => JSON.parse(r.body.body));
    const json = await send(`const body = { user: 'ann', n: 1 }; pm.request.body.update({ mode: "raw", raw: JSON.stringify(body) });`);
    expect(json.body).toEqual({ user: 'ann', n: 1 });
    expect(json.headers['content-type']).toBe('application/json');
    const form = await send(`pm.request.body.update({ mode: 'urlencoded', urlencoded: [{ key: 'a', value: 'x y' }] })`);
    expect(form.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(form.body).toEqual({ a: 'x y' });
    const edited = await send(`const f = pm.request.body.urlencoded; pm.request.body.update({ mode: 'urlencoded', urlencoded: [...f, { key: 'added', value: '1' }] })`, {
      mode: 'urlencoded',
      form: [{ id: '1', key: 'kept', value: 'yes', enabled: true }],
    });
    expect(edited.body).toEqual({ kept: 'yes', added: '1' });
  });
  const echo = (pre: string, body: Record<string, unknown>) =>
    h.call('POST', '/send', { request: { name: 'echo', method: 'POST', url: `${h.mockUrl}/echo`, body, scripts: { pre, post: '' } } }).then((r) => r.body);
  const annForm = { mode: 'urlencoded', form: [{ id: '1', key: 'user', value: 'ann', enabled: true }, { id: '2', key: 'pass', value: 'p+w d', enabled: true }] };

  it('sends JSON when request.body is assigned on a form-encoded request', async () => {
    const res = await echo(`request.body = JSON.stringify({ a: 1 })`, annForm);
    const got = JSON.parse(res.body);
    expect(got.headers['content-type']).toBe('application/json');
    expect(got.body).toEqual({ a: 1 });
  });

  it('keeps the form when the body is written back from toJSON()', async () => {
    const res = await echo(`pm.request.body.update(pm.request.body.toJSON())`, annForm);
    expect(JSON.parse(res.body).body).toEqual({ user: 'ann', pass: 'p+w d' });
  });

  it('supports add, upsert, push and remove on pm.request.body.urlencoded', async () => {
    const res = await echo(
      `const u = pm.request.body.urlencoded; u.add({ key: 'a', value: '1' }); u.upsert({ key: 'user', value: 'bob' }); u.push({ key: 'b', value: '2' }); u.remove('pass');`,
      annForm,
    );
    expect(res.scripts?.[0]?.error ?? null).toBeNull();
    expect(JSON.parse(res.body).body).toEqual({ user: 'bob', a: '1', b: '2' });
  });

  it('reports form-data bodies to scripts and leaves them untouched', async () => {
    const res = await echo(
      `pm.test('mode', () => pm.expect(pm.request.body.mode).to.equal('formdata')); pm.test('not empty', () => pm.expect(pm.request.body.isEmpty()).to.equal(false)); pm.test('fields', () => pm.expect(pm.request.body.formdata[0].key).to.equal('f'));`,
      { mode: 'form', form: [{ id: '1', key: 'f', value: 'v', enabled: true }] },
    );
    expect(res.scripts.flatMap((s: { assertions: { ok: boolean }[] }) => s.assertions).every((a: { ok: boolean }) => a.ok)).toBe(true);
    const contentType = Object.entries(res.request.headers as Record<string, string>).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
    expect(contentType).toMatch(/multipart\/form-data/);
  });
});
