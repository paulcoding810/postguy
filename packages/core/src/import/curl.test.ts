import { describe, expect, it } from 'vitest';
import { createContext } from '../template/context.ts';
import { resolveRequest } from '../http/request.ts';
import { CurlParseError, parseCurl, shellSplit, toCurl } from './curl.ts';

const pairs = (list: { key: string; value: string; enabled?: boolean }[]) => list.map((p) => [p.key, p.value]);

describe('shellSplit', () => {
  it('handles quotes, escapes and continuations', () => {
    expect(shellSplit(`curl 'a b' "c \\"d\\"" $'e\\nf' g\\ h \\\n  -k`)).toEqual(['curl', 'a b', 'c "d"', 'e\nf', 'g h', '-k']);
    expect(() => shellSplit(`curl 'oops`)).toThrow(CurlParseError);
  });
});

describe('parseCurl', () => {
  it('parses Chrome "Copy as cURL (bash)" with JSON body and bearer token', () => {
    const cmd = `curl 'https://api.example.com/v1/users/42/orders?status=paid&limit=10' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer eyJhbGciOi.abc.def' \\
  -H 'content-type: application/json' \\
  -H 'cookie: sid=abc; theme=dark' \\
  --data-raw '{"items":[{"sku":"MUG","quantity":2}],"note":"it'\\''s fine"}' \\
  --compressed`;
    const { request: r, warnings } = parseCurl(cmd);
    expect(warnings).toEqual([]);
    expect(r).toMatchObject({ method: 'POST', url: 'https://api.example.com/v1/users/42/orders', name: 'POST /v1/users/42/orders' });
    expect(pairs(r.params)).toEqual([['status', 'paid'], ['limit', '10']]);
    expect(r.auth).toEqual({ type: 'bearer', token: 'eyJhbGciOi.abc.def' });
    expect(pairs(r.headers)).toEqual([['accept', 'application/json'], ['cookie', 'sid=abc; theme=dark']]);
    expect(r.body.mode).toBe('json');
    expect(JSON.parse(r.body.raw!)).toEqual({ items: [{ sku: 'MUG', quantity: 2 }], note: "it's fine" });
  });

  it('parses Chrome "Copy as cURL (cmd)" escaping', () => {
    const cmd = `curl ^"https://example.com/search?q=a^%^20b^" ^
  -H ^"accept: */*^" ^
  --data-raw ^"^{^\\^"x^\\^":1^}^"`;
    const { request: r } = parseCurl(cmd);
    expect(r.url).toBe('https://example.com/search');
    expect(pairs(r.params)).toEqual([['q', 'a b']]);
    expect(pairs(r.headers)).toEqual([['accept', '*/*']]);
    expect(JSON.parse(r.body.raw!)).toEqual({ x: 1 });
  });

  it('parses urlencoded data, -G, basic auth, flags with attached values and options', () => {
    const form = parseCurl(`curl -XPUT https://x.test/form -d 'a=1' --data-urlencode 'msg=hello world&more' -u john:secret -k -m 2.5 -A agent/1`);
    expect(form.request).toMatchObject({ method: 'PUT', auth: { type: 'basic', username: 'john', password: 'secret' }, settings: { rejectUnauthorized: false, timeoutMs: 2500 } });
    expect(form.request.body.mode).toBe('urlencoded');
    expect(pairs(form.request.body.form!)).toEqual([['a', '1'], ['msg', 'hello world&more']]);
    expect(pairs(form.request.headers)).toEqual([['User-Agent', 'agent/1']]);

    const get = parseCurl(`curl -G https://x.test/s -d q=postguy -d page=2`);
    expect(get.request).toMatchObject({ method: 'GET', body: { mode: 'none' } });
    expect(pairs(get.request.params)).toEqual([['q', 'postguy'], ['page', '2']]);
  });

  it('parses multipart forms, --json, plain text bodies and HEAD', () => {
    const multi = parseCurl(`curl https://x.test/up -F name=Ann -F 'file=@photo.png' -H 'Content-Type: multipart/form-data'`);
    expect(multi.request.body.mode).toBe('form');
    expect(pairs(multi.request.body.form!)).toEqual([['name', 'Ann']]);
    expect(multi.request.headers).toEqual([]);
    expect(multi.warnings).toEqual(['File field file was not attached']);

    const json = parseCurl(`curl --json '{"a":1}' https://x.test/j`);
    expect(json.request).toMatchObject({ method: 'POST', body: { mode: 'json' } });
    expect(pairs(json.request.headers)).toEqual([['Accept', 'application/json']]);

    const text = parseCurl(`curl https://x.test/t -H 'Content-Type: text/plain' -d 'hello there'`);
    expect(text.request.body).toEqual({ mode: 'text', raw: 'hello there', contentType: 'text/plain' });

    expect(parseCurl(`curl -I example.com`).request).toMatchObject({ method: 'HEAD', url: 'http://example.com' });
  });

  it('keeps {{variables}}, warns about unsupported options and rejects non-curl input', () => {
    const r = parseCurl(`curl {{baseUrl}}/users/1 -o out.json --proxy http://p:1 --weird`);
    expect(r.request.url).toBe('{{baseUrl}}/users/1');
    expect(r.warnings).toEqual(['Ignored option --weird', 'Proxy settings are not supported and were ignored']);
    expect(() => parseCurl('wget https://x')).toThrow(/cURL/);
    expect(() => parseCurl('curl -H x:y')).toThrow(/no URL/);
  });
});

describe('toCurl', () => {
  it('round-trips through parseCurl', () => {
    const { request } = parseCurl(`curl -X POST 'https://x.test/a?b=1' -H 'X-A: it'\\''s' --data-raw '{"n":1}' -H 'Content-Type: application/json'`);
    const resolved = resolveRequest(request, createContext({}));
    const cmd = toCurl(resolved.request);
    expect(cmd).toContain(`-H 'X-A: it'\\''s'`);
    const again = parseCurl(cmd).request;
    expect(again).toMatchObject({ method: 'POST', url: 'https://x.test/a' });
    expect(pairs(again.params)).toEqual([['b', '1']]);
    expect(JSON.parse(again.body.raw!)).toEqual({ n: 1 });
  });
});
