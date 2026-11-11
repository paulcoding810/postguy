import { describe, expect, it } from 'vitest';
import { RequestDefinition, type KeyValue } from '@postguy/shared';
import { createContext } from '../template/context.ts';
import { extractPathParams, resolveRequest } from './request.ts';
import { parseSetCookie } from './cookies.ts';

const kv = (key: string, value: string, enabled = true): KeyValue => ({ id: key, key, value, enabled });

const ctx = createContext(
  {
    environment: { baseUrl: { value: 'http://localhost:4780' }, token: { value: 'tok-123', secret: true } },
  },
  [{ name: 'Login', status: 200, headers: {}, body: { data: { user: { id: 1001 } } }, source: 'snapshot' }],
);

const def = (over: Partial<RequestDefinition>) => RequestDefinition.parse({ name: 'r', method: 'GET', url: '', ...over });

describe('extractPathParams', () => {
  it('finds :params but ignores scheme and port', () => {
    expect(extractPathParams('http://localhost:8080/users/:id/orders/:orderId?x=:no')).toEqual(['id', 'orderId']);
    expect(extractPathParams('{{baseUrl}}/users/:id')).toEqual(['id']);
  });
});

describe('resolveRequest', () => {
  it('builds URL with path params, query, headers and bearer auth', () => {
    const r = resolveRequest(
      def({
        url: '{{baseUrl}}/users/:id',
        pathParams: [kv('id', '{{Login.data.user.id}}')],
        params: [kv('expand', 'orders'), kv('off', 'x', false)],
        headers: [kv('X-Trace', 'abc')],
        auth: { type: 'bearer', token: '{{token}}' },
      }),
      ctx,
    );
    expect(r.request.url).toBe('http://localhost:4780/users/1001?expand=orders');
    expect(r.request.headers).toEqual({ 'X-Trace': 'abc', Authorization: 'Bearer tok-123' });
    expect(r.secrets).toContain('tok-123');
    expect(r.unresolved).toEqual([]);
  });

  it('does not override an explicit Authorization header', () => {
    const r = resolveRequest(
      def({ url: 'http://x', headers: [kv('authorization', 'Custom 1')], auth: { type: 'bearer', token: 't' } }),
      ctx,
    );
    expect(r.request.headers).toEqual({ authorization: 'Custom 1' });
  });

  it('applies basic and api key auth', () => {
    expect(
      resolveRequest(def({ url: 'http://x', auth: { type: 'basic', username: 'u', password: 'p' } }), ctx).request.headers
        .Authorization,
    ).toBe('Basic dTpw');
    const q = resolveRequest(def({ url: 'http://x?a=1', auth: { type: 'apikey', key: 'k', value: 'v', in: 'query' } }), ctx);
    expect(q.request.url).toBe('http://x?a=1&k=v');
  });

  it('adds http:// when scheme is missing', () => {
    expect(resolveRequest(def({ url: 'localhost:3000/a' }), ctx).request.url).toBe('http://localhost:3000/a');
  });

  it('resolves JSON bodies with typed refs and invalid-JSON templates', () => {
    const typed = resolveRequest(
      def({ method: 'POST', body: { mode: 'json', raw: '{"userId":"{{Login.data.user.id}}"}' } }),
      ctx,
    );
    expect(typed.request.body).toEqual({ content: '{"userId":1001}', contentType: 'application/json' });
    expect(typed.request.headers['Content-Type']).toBe('application/json');
    const unquoted = resolveRequest(
      def({ method: 'POST', body: { mode: 'json', raw: '{"userId": {{Login.data.user.id}}}' } }),
      ctx,
    );
    expect(JSON.parse(unquoted.request.body.content!)).toEqual({ userId: 1001 });
  });

  it('encodes urlencoded forms', () => {
    const r = resolveRequest(
      def({ method: 'POST', body: { mode: 'urlencoded', form: [kv('a b', 'c&d'), kv('t', '{{token}}')] } }),
      ctx,
    );
    expect(r.request.body.content).toBe('a%20b=c%26d&t=tok-123');
  });

  it('reports unresolved refs', () => {
    expect(resolveRequest(def({ url: '{{nope}}/x' }), ctx).unresolved).toEqual(['nope']);
  });
});

describe('parseSetCookie', () => {
  it('parses attributes', () => {
    expect(parseSetCookie('sid=abc; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60')).toEqual({
      name: 'sid',
      value: 'abc',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 60,
    });
  });
});
