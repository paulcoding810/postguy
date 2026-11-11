import { describe, expect, it } from 'vitest';
import { canonicalJson, extractPaths, inferSchema, mergeSchemas, validateJson } from '../index.ts';

const login = { data: { access_token: 'abc123', user: { id: 1001, name: 'John', tags: [], manager: null } } };

describe('extractPaths', () => {
  it('lists nested paths with types and samples', () => {
    const paths = extractPaths(login);
    expect(paths.map((p) => p.path)).toEqual([
      'data',
      'data.access_token',
      'data.user',
      'data.user.id',
      'data.user.name',
      'data.user.tags',
      'data.user.manager',
    ]);
    expect(paths.find((p) => p.path === 'data.user.id')).toEqual({ path: 'data.user.id', type: 'integer', sample: 1001 });
    expect(paths.find((p) => p.path === 'data.user.manager')).toEqual({ path: 'data.user.manager', type: 'null', sample: null });
  });

  it('emits concrete first-element and wildcard paths for arrays, unioning keys', () => {
    const paths = extractPaths({ items: [{ id: 1 }, { id: 2, extra: true }] }).map((p) => `${p.path}${p.wildcard ? '*' : ''}`);
    expect(paths).toEqual(['items', 'items[0]', 'items[0].id', 'items[*]*', 'items[*].id*', 'items[*].extra*']);
  });

  it('handles root arrays, odd keys and limits', () => {
    expect(extractPaths([{ 'a b': 1 }]).map((p) => p.path)).toEqual(['[0]', '[0]["a b"]', '[*]', '[*]["a b"]']);
    expect(extractPaths({ a: { b: { c: 1 } } }, { maxDepth: 1 }).map((p) => p.path)).toEqual(['a']);
    expect(extractPaths(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i])), { maxEntries: 10 })).toHaveLength(10);
  });
});

describe('inferSchema / mergeSchemas', () => {
  it('infers types, formats and required keys without storing values', () => {
    const s = inferSchema({ id: 1, price: 1.5, at: '2025-01-01T10:00:00Z', email: 'a@b.co', on: true, x: null, list: [1, 2.5] });
    expect(s).toEqual({
      type: 'object',
      required: ['at', 'email', 'id', 'list', 'on', 'price', 'x'],
      properties: {
        at: { type: 'string', format: 'date-time' },
        email: { type: 'string', format: 'email' },
        id: { type: 'integer' },
        list: { type: 'array', items: { type: 'number' } },
        on: { type: 'boolean' },
        price: { type: 'number' },
        x: { type: 'null' },
      },
    });
    expect(JSON.stringify(s)).not.toContain('a@b.co');
  });

  it('merges array elements with missing fields and nulls', () => {
    const s = inferSchema([{ id: 1, zip: 'A1' }, { id: 2, zip: null, extra: 'x' }]) as any;
    expect(s.items.required).toEqual(['id', 'zip']);
    expect(s.items.properties.zip.type).toEqual(['string', 'null']);
    expect(s.items.properties.extra).toEqual({ type: 'string' });
  });

  it('uses anyOf for incompatible structures and is order independent for equal input', () => {
    expect(mergeSchemas(inferSchema({ a: 1 }), inferSchema([1]))).toEqual({ anyOf: [inferSchema({ a: 1 }), inferSchema([1])] });
    expect(canonicalJson(inferSchema({ b: 1, a: 2 }))).toBe(canonicalJson(inferSchema({ a: 3, b: 4 })));
  });
});

describe('validateJson', () => {
  const schema = { type: 'object', required: ['data'], properties: { data: { type: 'object', required: ['id'], properties: { id: { type: 'integer' }, zip: { type: ['string', 'null'] } } } } };
  it('reports readable issues', () => {
    expect(validateJson(schema, { data: { id: 1, zip: null } })).toEqual([]);
    expect(validateJson(schema, { data: { id: 'x' } })).toEqual([{ path: 'data.id', message: 'must be integer' }]);
    expect(validateJson(schema, {})).toEqual([{ path: '(root)', message: 'missing required property "data"' }]);
  });
});
