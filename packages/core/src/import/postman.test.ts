import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPostmanCollection, postmanToCollection } from './postman.ts';

const data = JSON.parse(readFileSync(join(import.meta.dirname, '../../../mock-api/fixtures/shop.postman_collection.json'), 'utf8'));

describe('Postman import', () => {
  it('detects and converts folders, requests, auth, bodies, params and variables', () => {
    expect(isPostmanCollection(data)).toBe(true);
    expect(isPostmanCollection({ format: 'postguy-collection' })).toBe(false);
    const { collection: c } = postmanToCollection(data);
    expect(c).toMatchObject({ name: 'Shop (Postman)', description: 'Exported from Postman', auth: { type: 'bearer', token: '{{token}}' } });
    expect(c.variables).toEqual([
      { key: 'baseUrl', value: 'http://localhost:4780', isSecret: false },
      { key: 'token', value: '', isSecret: true },
    ]);
    const login = c.folders[0]!.requests[0]!;
    expect(login).toMatchObject({ name: 'Login', method: 'POST', url: '{{baseUrl}}/auth/login', auth: { type: 'none' }, body: { mode: 'json' } });
    expect(login.scripts.post).toContain("pm.test('ok', () => pm.response.to.have.status(200));");
    expect(login.scripts.post).not.toContain("// pm.test");
    const orders = c.requests[0]!;
    expect(orders.url).toBe('{{baseUrl}}/users/:id/orders');
    expect(orders.auth).toEqual({ type: 'inherit' });
    expect(orders.params.map((p) => [p.key, p.value, p.enabled])).toEqual([['status', 'paid', true], ['limit', '10', false]]);
    expect(orders.pathParams[0]).toMatchObject({ key: 'id', value: '1001', description: 'User id' });
    expect(orders.headers[0]).toMatchObject({ key: 'X-Debug', enabled: false });
    const form = c.requests[1]!;
    expect(form).toMatchObject({ url: '{{baseUrl}}/orders', auth: { type: 'apikey', key: 'X-Key', value: 'abc', in: 'header' }, body: { mode: 'urlencoded' } });
    expect(form.params).toMatchObject([{ key: 'dry', value: '1' }]);
  });
});
