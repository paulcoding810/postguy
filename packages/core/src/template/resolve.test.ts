import { describe, expect, it } from 'vitest';
import { createContext, mergeScopes, type ResponseRecord } from './context.ts';
import { extractRefs, parseTemplate, soleRef } from './parse.ts';
import { resolveJsonTree, resolveTemplate, resolveValue } from './resolve.ts';

const login: ResponseRecord = {
  name: 'Login',
  status: 200,
  headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'r-1' },
  body: {
    data: {
      access_token: 'abc123',
      user: { id: 1001, name: 'John', tags: ['a', 'b'], manager: null },
      items: [
        { id: 1, active: true },
        { id: 2, active: false },
      ],
    },
  },
  source: 'execution',
};

const ctx = createContext(
  {
    runtime: { token: { value: 'runtime-token' } },
    request: { id: { value: '42' } },
    collection: [{ baseUrl: { value: 'https://inner.test' } }, { baseUrl: { value: 'https://outer.test' }, api: { value: 'v1' } }],
    environment: { baseUrl: { value: 'https://env.test' }, apiKey: { value: 'sekret-key', secret: true }, host: { value: 'h.test' } },
    global: { baseUrl: { value: 'https://global.test' }, url: { value: 'https://{{host}}/{{api}}' }, cfg: { value: '{"retries":3,"opts":{"x":true}}' } },
  },
  [login],
);

describe('parseTemplate', () => {
  it('splits text and refs and trims whitespace inside braces', () => {
    expect(parseTemplate('a {{ x }} b {{y.z}}')).toMatchObject([
      { kind: 'text', value: 'a ' },
      { kind: 'ref', ref: 'x' },
      { kind: 'text', value: ' b ' },
      { kind: 'ref', ref: 'y.z' },
    ]);
    expect(extractRefs('{{a}}{{b}}')).toEqual(['a', 'b']);
    expect(soleRef(' {{a}}')).toBeNull();
    expect(soleRef('{{a}}')).toBe('a');
  });
});

describe('scope precedence', () => {
  it('prefers runtime > request > flow > collection (inner first) > environment > global', () => {
    const vars = mergeScopes({
      global: { a: { value: 'g' }, b: { value: 'g' }, c: { value: 'g' } },
      environment: { a: { value: 'e' }, b: { value: 'e' } },
      collection: [{ a: { value: 'inner' } }, { a: { value: 'outer' }, c: { value: 'outer' } }],
      runtime: { b: { value: 'rt' } },
    });
    expect(vars.get('a')).toMatchObject({ value: 'inner', source: 'collection' });
    expect(vars.get('b')).toMatchObject({ value: 'rt', source: 'runtime' });
    expect(vars.get('c')).toMatchObject({ value: 'outer', source: 'collection' });
  });
});

describe('resolveTemplate', () => {
  it('resolves variables using precedence', () => {
    expect(resolveTemplate('{{baseUrl}}/users/{{id}}', ctx).value).toBe('https://inner.test/users/42');
  });

  it('resolves nested variable references', () => {
    expect(resolveTemplate('{{url}}', ctx).value).toBe('https://h.test/v1');
  });

  it('resolves response body references via plain syntax', () => {
    const r = resolveTemplate('Bearer {{Login.data.access_token}}', ctx);
    expect(r.value).toBe('Bearer abc123');
    expect(r.unresolved).toEqual([]);
    expect(r.refs[0]).toMatchObject({ source: 'response', responseName: 'Login' });
  });

  it('supports explicit $res syntax for status, headers and body', () => {
    expect(resolveTemplate('{{$res.Login.status}}', ctx).value).toBe('200');
    expect(resolveTemplate('{{$res.Login.headers.x-request-id}}', ctx).value).toBe('r-1');
    expect(resolveTemplate('{{$res.Login.body.data.user.name}}', ctx).value).toBe('John');
  });

  it('handles array indexes, wildcards and JSONPath filters', () => {
    expect(resolveTemplate('{{Login.data.user.tags[1]}}', ctx).value).toBe('b');
    expect(resolveValue('{{Login.data.items[*].id}}', ctx).value).toEqual([1, 2]);
    expect(resolveValue('{{Login.data.items[?(@.active)].id}}', ctx).value).toBe(1);
  });

  it('renders null and objects as JSON text', () => {
    expect(resolveTemplate('{{Login.data.user.manager}}', ctx).value).toBe('null');
    expect(resolveTemplate('x={{Login.data.user.tags}}', ctx).value).toBe('x=["a","b"]');
  });

  it('paths into JSON-valued variables', () => {
    expect(resolveValue('{{cfg.opts.x}}', ctx).value).toBe(true);
  });

  it('leaves unresolved refs in place and reports them', () => {
    const r = resolveTemplate('{{missing}}/{{Login.data.nope}}/{{Other.x}}', ctx);
    expect(r.value).toBe('{{missing}}/{{Login.data.nope}}/{{Other.x}}');
    expect(r.unresolved).toEqual(['missing', 'Login.data.nope', 'Other.x']);
    expect(r.refs.map((x) => x.error)).toEqual([
      'Variable "missing" is not defined',
      'Path "data.nope" not found in response "Login"',
      'No response named "Other"',
    ]);
  });

  it('collects secret values used', () => {
    expect(resolveTemplate('k={{apiKey}}', ctx).secrets).toEqual(['sekret-key']);
  });

  it('stops on self-referencing variables', () => {
    const loop = createContext({ global: { a: { value: '{{b}}' }, b: { value: '{{a}}' } } });
    expect(resolveTemplate('{{a}}', loop).unresolved.length).toBeGreaterThan(0);
  });

  it('supports response names with spaces', () => {
    const c = createContext({}, [{ ...login, name: 'Get Profile' }]);
    expect(resolveTemplate('{{Get Profile.data.user.id}}', c).value).toBe('1001');
  });
});

describe('resolveJsonTree', () => {
  it('keeps types for single-ref strings and interpolates others', () => {
    const r = resolveJsonTree(
      { id: '{{Login.data.user.id}}', label: 'user-{{Login.data.user.id}}', tags: '{{Login.data.user.tags}}', n: 5 },
      ctx,
    );
    expect(r.value).toEqual({ id: 1001, label: 'user-1001', tags: ['a', 'b'], n: 5 });
  });
});
