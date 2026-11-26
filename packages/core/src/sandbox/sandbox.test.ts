import { describe, expect, it } from 'vitest';
import { runScript, type ScriptHost } from './sandbox.ts';
import type { ScriptRequest } from '@postguy/shared';

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
    expect(r.request).toEqual({ method: 'GET', url: 'http://x/a?q=1', headers: { 'X-Trace': 't-42' }, body: '{"n":1}', bodyMode: 'raw' });
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
    const mem = await runScript({ phase: 'post', host: host(), source: 'const a = []; for (let i = 0; ; i++) a.push({ i, s: "y" + i });', memoryMb: 8, timeoutMs: 5000 });
    expect(mem.error).toMatch(/memory/i);
  });

  it('has no access to the host process or filesystem, and no network except through the host', async () => {
    const r = await runScript({
      phase: 'post',
      host: host(),
      source: `
        flow.log(typeof process, typeof require, typeof fetch, typeof XMLHttpRequest, typeof globalThis.Deno, typeof import.meta);
      `,
    });
    expect(r.error).toMatch(/SyntaxError/);
    const ok = await runScript({ phase: 'post', host: host(), source: `flow.log(typeof process, typeof fetch, typeof require)` });
    expect(ok.logs[0]!.message).toBe('undefined function function');
    // fetch only reaches the network through the host's sendRequest.
    expect((await runScript({ phase: 'post', host: host(), source: `await fetch('http://x')` })).error).toMatch(/not available here/);
    expect((await runScript({ phase: 'post', host: host(), source: `require('fs')` })).error).toMatch(/not available/);
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

  it('supports pm.expect.fail in both forms', async () => {
    const r = await runScript({
      phase: 'post',
      host: host(),
      response: login,
      source: `
        pm.test('message form', () => pm.expect.fail('token was missing'));
        pm.test('no arguments', () => pm.expect.fail());
        pm.test('actual and expected', () => pm.expect.fail(404, 200));
        pm.test('custom message and operator', () => pm.expect.fail(1, 2, 'numbers differ', '==='));
        pm.test('operator only', () => pm.expect.fail(1, 2, undefined, '>'));
        pm.test('branch not taken', () => { if (pm.response.code !== 200) pm.expect.fail('unexpected status'); });
      `,
    });
    expect(r.assertions).toEqual([
      { ok: false, message: 'message form: token was missing' },
      { ok: false, message: 'no arguments: expect.fail()' },
      { ok: false, message: 'actual and expected: expected 404 to not equal 200' },
      { ok: false, message: 'custom message and operator: numbers differ' },
      { ok: false, message: 'operator only: expected 1 to > 2' },
      { ok: true, message: 'branch not taken' },
    ]);
  });

  it('explains pm.sendRequest where the host can’t send', async () => {
    const r = await runScript({ phase: 'post', host: host(), response: login, source: 'await pm.sendRequest("http://x")' });
    expect(r.error).toMatch(/Sending requests from a script is not available here/);
  });
});

describe('pm.sendRequest', () => {
  const sent: ScriptRequest[] = [];
  const sender = (over: Partial<ScriptHost> = {}): ScriptHost => ({
    ...host(),
    async sendRequest(req) {
      sent.push(req);
      await new Promise((r) => setTimeout(r, 5));
      if (req.url.includes('down')) throw new Error('connect ECONNREFUSED');
      return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: { token: 'tok-9', echo: req.body } };
    },
    ...over,
  });
  const pre = (source: string, h: ScriptHost = sender()) =>
    runScript({ phase: 'pre', host: h, request: { method: 'GET', url: 'http://api/x', headers: {}, body: null }, source, timeoutMs: 1000 });

  it('runs the callback form and lets it change the outgoing request', async () => {
    sent.length = 0;
    const r = await pre(`pm.sendRequest({ url: 'http://auth/login', method: 'POST', header: [{ key: 'X-A', value: '1' }], body: { mode: 'raw', raw: '{"u":"ann"}' } }, (err, res) => {
      pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer ' + res.json().token });
      pm.test('login ok', () => pm.expect(res.code).to.equal(200));
    });`);
    expect(r.error).toBeNull();
    expect(sent[0]).toEqual({ method: 'POST', url: 'http://auth/login', headers: { 'X-A': '1' }, body: '{"u":"ann"}' });
    expect(r.request?.headers.Authorization).toBe('Bearer tok-9');
    expect(r.assertions).toEqual([{ ok: true, message: 'login ok' }]);
  });

  it('supports await, urlencoded bodies and several calls in a row', async () => {
    sent.length = 0;
    const r = await pre(`const a = await pm.sendRequest({ url: 'http://auth/token', method: 'POST', body: { mode: 'urlencoded', urlencoded: [{ key: 'grant_type', value: 'client credentials' }] } });
      const b = await pm.sendRequest('http://api/me');
      pm.environment.set('tok', a.json().token + '/' + b.code);`);
    expect(r.error).toBeNull();
    expect(sent.map((x) => [x.url, x.body, x.headers['Content-Type']])).toEqual([
      ['http://auth/token', 'grant_type=client%20credentials', 'application/x-www-form-urlencoded'],
      ['http://api/me', null, undefined],
    ]);
  });

  it('sends GraphQL variables written as a string as an object, and sets Content-Type from raw.language', async () => {
    sent.length = 0;
    const r = await pre(`await pm.sendRequest({ url: 'http://api/graphql', method: 'POST', body: { mode: 'graphql', graphql: { query: '{ a }', variables: '{"id":"1"}' } } });
      await pm.sendRequest({ url: 'http://api/echo', method: 'POST', body: { mode: 'raw', raw: '{"x":1}', options: { raw: { language: 'json' } } } });
      await pm.sendRequest({ url: 'http://api/echo', method: 'POST', header: { 'content-type': 'text/x' }, body: { mode: 'raw', raw: 'a', options: { raw: { language: 'json' } } } });`);
    expect(r.error).toBeNull();
    expect(JSON.parse(sent[0]!.body!)).toEqual({ query: '{ a }', variables: { id: '1' } });
    expect(sent[1]!.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(sent[2]!.headers).toEqual({ 'content-type': 'text/x' });
  });

  it('passes network errors to the callback, and fails the script when an awaited send fails', async () => {
    const cb = await pre(`pm.sendRequest('http://down/x', (err, res) => { console.log(err.message, res === null); });`);
    expect(cb.error).toBeNull();
    expect(cb.logs.map((l) => l.message)).toEqual(['pm.sendRequest GET http://down/x → failed: connect ECONNREFUSED', 'connect ECONNREFUSED true']);
    const awaited = await pre(`await pm.sendRequest('http://down/x');`);
    expect(awaited.error).toMatch(/ECONNREFUSED/);
  });

  it('limits the number of calls, and waiting doesn’t count against the CPU time limit', async () => {
    const many = await pre(`for (let i = 0; i < 11; i++) await pm.sendRequest('http://api/' + i);`);
    expect(many.error).toMatch(/at most 10 requests/);
    const slow = await pre(`await pm.sendRequest('http://api/slow');`, sender({ sendRequest: () => new Promise((r) => setTimeout(() => r({ status: 204, headers: {}, body: '' }), 1300)) }));
    expect(slow.error).toBeNull();
  });

  it('offers the usual parts of fetch, sharing the same limits', async () => {
    sent.length = 0;
    const r = await pre(`const res = await fetch('http://auth/login', { method: 'post', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ u: 1 }) });
      const data = await res.json();
      pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer ' + data.token });
      console.log(res.ok, res.status, res.headers.get('Content-Type'), (await res.text()).length > 0);`);
    expect(r.error).toBeNull();
    expect(sent[0]).toEqual({ method: 'POST', url: 'http://auth/login', headers: { 'Content-Type': 'application/json' }, body: '{"u":1}' });
    expect(r.request?.headers.Authorization).toBe('Bearer tok-9');
    expect(r.logs.map((l) => l.message)).toEqual([expect.stringMatching(/^fetch POST http:\/\/auth\/login → 200/), 'true 200 application/json true']);

    const down = await pre(`try { await fetch('http://down/x'); } catch (e) { console.log(e.name, e.message); }`);
    expect(down.logs.at(-1)!.message).toBe('TypeError Failed to fetch: connect ECONNREFUSED');
    const blob = await pre(`await (await fetch('http://api/x')).blob();`);
    expect(blob.error).toMatch(/blob\(\) is not available/);
    const mixed = await pre(`for (let i = 0; i < 6; i++) { await fetch('http://api/' + i); await pm.sendRequest('http://api/' + i); }`);
    expect(mixed.error).toMatch(/at most 10 requests/);
  });

  it('reports errors thrown in a callback', async () => {
    const thrown = await pre(`pm.sendRequest('http://api/x', () => { throw new Error('boom'); });`);
    expect(thrown.error).toMatch(/boom/);
  });
});

describe('pm.request.body.update', () => {
  const pre = (source: string, body: string | null = null) =>
    runScript({ phase: 'pre', host: host(), request: { method: 'POST', url: 'http://x/a', headers: {}, body }, source });

  it('sets raw bodies from a string, an object or JSON.stringify', async () => {
    const r = await pre(`const body = { name: 'Ann', tags: [1] }; pm.request.body.update({ mode: "raw", raw: JSON.stringify(body) });`);
    expect(r.request).toMatchObject({ body: '{"name":"Ann","tags":[1]}', bodyMode: 'raw' });
    expect((await pre(`pm.request.body.update('plain text')`)).request!.body).toBe('plain text');
    expect((await pre(`pm.request.body.update({ mode: 'raw', raw: { a: 1 } })`)).request!.body).toBe('{"a":1}');
    const xml = await pre(`pm.request.body.update({ mode: 'raw', raw: '<a/>', options: { raw: { language: 'xml' } } })`);
    expect(xml.request).toMatchObject({ body: '<a/>', headers: { 'Content-Type': 'application/xml' } });
  });

  it('reads and edits the current body', async () => {
    const r = await pre(`const b = JSON.parse(pm.request.body.raw); b.n += 1; pm.request.body.update({ mode: 'raw', raw: JSON.stringify(b) }); flow.log(pm.request.body.mode, pm.request.body.isEmpty());`, '{"n":1}');
    expect(r.request!.body).toBe('{"n":2}');
    expect(r.logs[0]!.message).toBe('raw false');
  });

  it('builds urlencoded and GraphQL bodies and rejects form-data', async () => {
    const form = await pre(`pm.request.body.update({ mode: 'urlencoded', urlencoded: [{ key: 'a b', value: 'c&d' }, { key: 'off', value: 'x', disabled: true }, { key: 'n', value: 2 }] })`);
    expect(form.request).toMatchObject({ body: 'a%20b=c%26d&n=2', bodyMode: 'urlencoded' });
    const gql = await pre(`pm.request.body.update({ mode: 'graphql', graphql: { query: '{ me { id } }', variables: '{"x":1}' } })`);
    expect(JSON.parse(gql.request!.body!)).toEqual({ query: '{ me { id } }', variables: { x: 1 } });
    expect(gql.request!.headers['Content-Type']).toBe('application/json');
    const bad = await pre(`pm.request.body.update({ mode: 'formdata', formdata: [] })`);
    expect(bad.error).toMatch(/formdata bodies cannot be set from a script/);
  });
});

describe('CryptoJS and base64 in scripts', () => {
  const run = (source: string) => runScript({ phase: 'post', host: host(), response: { status: 200, headers: {}, body: {} }, source });
  it('hashes, signs and encodes like CryptoJS', async () => {
    const r = await run(`
      flow.log(CryptoJS.SHA256('abc').toString());
      flow.log(CryptoJS.MD5('abc').toString(CryptoJS.enc.Hex));
      flow.log(CryptoJS.HmacSHA256('msg', 'key').toString(CryptoJS.enc.Base64));
      flow.log(CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse('héllo')));
      flow.log(CryptoJS.enc.Base64.parse('aMOpbGxv').toString(CryptoJS.enc.Utf8));
      flow.log('' + require('crypto-js').SHA1('abc'));
      flow.log(btoa('user:pass') + ' ' + atob('dXNlcjpwYXNz'));
      flow.log(CryptoJS.lib.WordArray.random(16).toString().length);
    `);
    expect(r.error).toBeNull();
    expect(r.logs.map((l) => l.message)).toEqual([
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      '900150983cd24fb0d6963f7d28e17f72',
      'LZPLwb4We8sWN6SiPL/wGnh48MUO6DOVTqUiG7G4xig=',
      'aMOpbGxv',
      'héllo',
      'a9993e364706816aba3e25717850c26c9cd0d89d',
      'dXNlcjpwYXNz user:pass',
      '32',
    ]);
  });
  it('explains what is missing', async () => {
    expect((await run(`CryptoJS.AES.encrypt('a', 'k')`)).error).toMatch(/CryptoJS.AES is not available/);
    expect((await run(`require('moment')`)).error).toMatch(/require\('moment'\) is not available/);
  });
  it('replaces built-in variables in pm.variables.replaceIn', async () => {
    const r = await run(`flow.log(pm.variables.replaceIn('{{$guid}}|{{$timestamp}}|{{$nope}}'))`);
    expect(r.logs[0]!.message).toMatch(/^[0-9a-f-]{36}\|\d{10}\|\{\{\$nope\}\}$/);
  });
});

describe('more Postman script support', () => {
  const response = { status: 200, headers: {}, body: { id: 7, name: 'Ann' }, timeMs: 12 };
  const run = (source: string, extra: object = {}) => runScript({ phase: 'post', host: host(), response, source, ...extra });
  it('exposes the sent request, the response size and a test.skip', async () => {
    const r = await run(
      `pm.test('url', () => pm.expect(pm.request.url.toString()).to.include('/users/7'));
       flow.log(pm.response.responseSize, pm.info.eventName);
       pm.test.skip('later', () => { throw new Error('should not run'); });`,
      { request: { method: 'GET', url: 'http://x/users/7', headers: {}, body: null } },
    );
    expect(r.error).toBeNull();
    expect(r.assertions).toEqual([{ ok: true, message: 'url' }]);
    expect(r.logs.map((l) => l.message)).toEqual(['21 test', 'Skipped test: later']);
  });
  it('validates against a JSON Schema', async () => {
    const r = await run(`
      pm.test('ok', () => pm.response.to.have.jsonSchema({ type: 'object', required: ['id'], properties: { id: { type: 'integer' } } }));
      pm.test('bad', () => pm.response.to.have.jsonSchema({ type: 'object', required: ['email'] }));`);
    expect(r.assertions[0]).toEqual({ ok: true, message: 'ok' });
    expect(r.assertions[1]!.ok).toBe(false);
    expect(r.assertions[1]!.message).toMatch(/missing required property "email"/);
  });
  it('runs setTimeout callbacks after the script, without waiting', async () => {
    const r = await run(`setTimeout(() => flow.log('later', 2), 1000); const t = setTimeout(() => flow.log('never'), 5); clearTimeout(t); flow.log('first');`);
    expect(r.logs.map((l) => l.message)).toEqual(['first', 'later 2']);
    expect((await run(`setInterval(() => {}, 10)`)).error).toMatch(/setInterval is not available/);
  });
});
