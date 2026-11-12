import { describe, expect, it } from 'vitest';
import { runScript, type ScriptHost } from './sandbox.ts';

function host(store: Record<string, unknown> = {}, env: Record<string, unknown> = {}): ScriptHost {
  return {
    response: (name) => (name === 'Login' ? { status: 200, headers: { 'content-type': 'application/json' }, body: { data: { access_token: 'abc', user: { id: 1001 } } } } : undefined),
    get: (k) => store[k],
    set: (k, v) => void (store[k] = v),
    envGet: (k) => env[k],
    envSet: (k, v) => void (env[k] = v),
  };
}

describe('runScript', () => {
  it('runs the documented flow API', async () => {
    const store: Record<string, unknown> = {};
    const r = await runScript({
      phase: 'post',
      host: host(store),
      source: `
        const login = flow.response("Login");
        flow.set("token", login.body.data.access_token);
        flow.set("userId", login.body.data.user.id);
        flow.assert(login.body.data.access_token != null, "has token");
        flow.log("user", flow.get("userId"));
        console.warn({ a: 1 });
      `,
    });
    expect(r.ok).toBe(true);
    expect(store).toEqual({ token: 'abc', userId: 1001 });
    expect(r.assertions).toEqual([{ ok: true, message: 'has token' }]);
    expect(r.logs.map((l) => [l.level, l.message])).toEqual([['info', 'user 1001'], ['warn', '{"a":1}']]);
  });

  it('lets pre-request scripts edit the request', async () => {
    const r = await runScript({
      phase: 'pre',
      host: host(),
      request: { method: 'GET', url: 'http://x/a', headers: {}, body: null },
      source: `request.headers["X-Trace"] = "t-" + 42; request.url += "?q=1"; request.body = JSON.stringify({ n: 1 });`,
    });
    expect(r.request).toEqual({ method: 'GET', url: 'http://x/a?q=1', headers: { 'X-Trace': 't-42' }, body: '{"n":1}' });
  });

  it('exposes the current response to post scripts and fails on false assertions', async () => {
    const r = await runScript({
      phase: 'post',
      host: host(),
      response: { status: 404, headers: {}, body: { error: 'nope' } },
      source: `flow.assert(response.status === 200, "status is 200"); flow.assert(true, "always");`,
    });
    expect(r.ok).toBe(false);
    expect(r.assertions).toEqual([{ ok: false, message: 'status is 200' }, { ok: true, message: 'always' }]);
  });

  it('reports errors with line numbers', async () => {
    const r = await runScript({ phase: 'post', host: host(), source: 'const a = 1;\nnope();' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ReferenceError: .*nope.*\(line 2\)/);
  });

  it('enforces time and memory limits', async () => {
    const loop = await runScript({ phase: 'post', host: host(), source: 'while (true) {}', timeoutMs: 100 });
    expect(loop.error).toBe('Script timed out after 100 ms');
    const mem = await runScript({ phase: 'post', host: host(), source: 'const a = []; while (true) a.push("x".repeat(1e5));', memoryMb: 8, timeoutMs: 5000 });
    expect(mem.error).toMatch(/memory/i);
  });

  it('has no access to the host process, filesystem or network', async () => {
    const r = await runScript({
      phase: 'post',
      host: host(),
      source: `
        flow.log(typeof process, typeof require, typeof fetch, typeof XMLHttpRequest, typeof globalThis.Deno, typeof import.meta);
      `,
    });
    expect(r.error).toMatch(/SyntaxError/);
    const ok = await runScript({ phase: 'post', host: host(), source: `flow.log(typeof process, typeof require, typeof fetch, typeof setTimeout)` });
    expect(ok.logs[0]!.message).toBe('undefined undefined undefined undefined');
    const esc = await runScript({ phase: 'post', host: host(), source: `flow.log(String(this.constructor.constructor("return typeof process")()))` });
    expect(esc.logs[0]?.message ?? esc.error).toMatch(/undefined|TypeError/);
  });

  it('isolates runs from each other', async () => {
    await runScript({ phase: 'post', host: host(), source: 'globalThis.leak = 1;' });
    const r = await runScript({ phase: 'post', host: host(), source: 'flow.log(typeof leak)' });
    expect(r.logs[0]!.message).toBe('undefined');
  });
});

describe('Postman compatibility', () => {
  const login = { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' }, body: { data: { access_token: 'abc', user: { id: 1001, tags: ['a'] } } }, timeMs: 12 };

  it('runs typical Postman tests and variable calls', async () => {
    const env: Record<string, unknown> = {};
    const scopes: string[] = [];
    const h: ScriptHost = {
      response: () => undefined,
      get: () => undefined,
      set: () => undefined,
      envGet: (k) => env[k],
      envSet: (k, v, scope) => {
        env[k] = v;
        scopes.push(`${k}:${scope ?? 'environment'}`);
      },
    };
    const r = await runScript({
      phase: 'post',
      host: h,
      response: login,
      source: `
        pm.test("Status code is 200", function () { pm.response.to.have.status(200); });
        pm.test("Body has token", () => {
          const json = pm.response.json();
          pm.expect(json.data.access_token).to.be.a('string').and.not.be.empty;
          pm.expect(json.data.user).to.have.property('id', 1001);
          pm.expect(json.data.user.tags).to.include('a');
          pm.expect(pm.response.headers.get('content-type')).to.include('json');
          pm.expect(pm.response.responseTime).to.be.below(500);
        });
        pm.test("Fails", () => pm.expect(pm.response.code).to.eql(201));
        pm.collectionVariables.set("token", pm.response.json().data.access_token);
        pm.environment.set("userId", pm.response.json().data.user.id);
        pm.globals.set("g", 1);
        postman.setEnvironmentVariable("legacy", "x");
        tests["legacy test"] = responseCode.code === 200;
        pm.response.to.be.ok;
      `,
    });
    expect(r.error).toBeNull();
    expect(r.assertions).toEqual([
      { ok: true, message: 'Status code is 200' },
      { ok: true, message: 'Body has token' },
      { ok: false, message: 'Fails: expected 200 to deeply equal 201' },
      { ok: true, message: 'legacy test' },
    ]);
    expect(env).toEqual({ token: 'abc', userId: 1001, g: 1, legacy: 'x' });
    expect(scopes).toEqual(['token:collection', 'userId:environment', 'g:globals', 'legacy:environment']);
  });

  it('edits the request through pm.request in pre-request scripts', async () => {
    const r = await runScript({
      phase: 'pre',
      host: host(),
      request: { method: 'GET', url: 'http://x/a', headers: { A: '1' }, body: null },
      source: `
        pm.request.headers.add({ key: 'X-Ts', value: 42 });
        pm.request.headers.upsert({ key: 'a', value: '2' });
        pm.variables.set('local', pm.variables.replaceIn('{{missing}}'));
        if (pm.info.eventName !== 'prerequest') throw new Error('wrong event');
      `,
    });
    expect(r.error).toBeNull();
    expect(r.request!.headers).toEqual({ A: '2', 'X-Ts': '42' });
  });

  it('explains unsupported pm.sendRequest', async () => {
    const r = await runScript({ phase: 'post', host: host(), response: login, source: 'pm.sendRequest("http://x", () => {})' });
    expect(r.error).toMatch(/pm.sendRequest is not available/);
  });
});
