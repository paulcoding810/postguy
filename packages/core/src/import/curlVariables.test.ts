import { describe, expect, it } from 'vitest';
import { parseCurl } from './curl.ts';
import { swapInVariables, type VariableValue } from './curlVariables.ts';

const vars: VariableValue[] = [
  { key: 'baseUrl', value: 'https://api.shop.com/v2', source: 'environment' },
  { key: 'host', value: 'https://api.shop.com', source: 'environment' },
  { key: 'token', value: 'eyJhbGciOi.abc.def', source: 'environment' },
  { key: 'userId', value: 'u-4242', source: 'collection' },
  { key: 'flag', value: 'true', source: 'environment' },
  { key: 'short', value: 'abc', source: 'environment' },
];

const cmd = `curl 'https://api.shop.com/v2/users/u-4242?owner=u-4242&on=true' \\
  -H 'authorization: Bearer eyJhbGciOi.abc.def' \\
  -H 'x-api-key: Token eyJhbGciOi.abc.def' \\
  -H 'x-note: about u-4242 here' \\
  --data-raw '{"user":"u-4242","tags":["u-4242x","abc"],"n":4242}'`;

describe('swapInVariables', () => {
  it('uses variables for the URL start and whole values, and nothing else', () => {
    const { request: r, used } = swapInVariables(parseCurl(cmd).request, vars);
    expect(r.url).toBe('{{baseUrl}}/users/u-4242');
    expect(r.params.map((p) => [p.key, p.value])).toEqual([['owner', '{{userId}}'], ['on', 'true']]);
    expect(r.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(r.headers.map((h) => h.value)).toEqual(['Token {{token}}', 'about u-4242 here']);
    expect(JSON.parse(r.body.raw!)).toEqual({ user: '{{userId}}', tags: ['u-4242x', 'abc'], n: 4242 });
    expect(used).toEqual(['baseUrl', 'token', 'userId']);
  });

  it('only swaps a URL prefix at a path boundary', () => {
    const r = parseCurl(`curl https://api.shop.com/v22/x`).request;
    expect(swapInVariables(r, vars).request.url).toBe('{{host}}/v22/x');
  });

  it('prefers the narrower scope and leaves ties alone', () => {
    const r = parseCurl(`curl https://x.io -H 'a: same-value' -H 'b: tied-value'`).request;
    const out = swapInVariables(r, [
      { key: 'envOne', value: 'same-value', source: 'environment' },
      { key: 'colOne', value: 'same-value', source: 'collection' },
      { key: 't1', value: 'tied-value', source: 'environment' },
      { key: 't2', value: 'tied-value', source: 'environment' },
    ]);
    expect(out.request.headers.map((h) => h.value)).toEqual(['{{colOne}}', 'tied-value']);
    expect(out.used).toEqual(['colOne']);
  });

  it('keeps the request untouched when nothing matches', () => {
    const r = parseCurl(cmd).request;
    const out = swapInVariables(r, []);
    expect(out.request).toEqual(r);
    expect(out.used).toEqual([]);
  });
});
