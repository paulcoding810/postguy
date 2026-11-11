import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSpec, normalizeSpec, generateCollection, sampleFromSchema, toJsonSchema, parseSpecText, SpecError } from '../index.ts';

const fixtures = join(import.meta.dirname, '../../../mock-api/fixtures');
const read = (f: string) => readFileSync(join(fixtures, f), 'utf8');

async function model(file: string) {
  const loaded = await loadSpec(read(file));
  return { loaded, model: normalizeSpec(loaded.dereferenced, loaded.specVersion) };
}

describe('OpenAPI 3.0 (YAML)', () => {
  it('extracts servers, security, tags and operations with resolved refs', async () => {
    const { loaded, model: m } = await model('mock-api.openapi.yaml');
    expect(loaded.warnings).toEqual([]);
    expect(m.title).toBe('Postguy Mock Shop API');
    expect(m.servers[0]!.url).toBe('http://localhost:4780');
    expect(m.securitySchemes).toEqual([expect.objectContaining({ name: 'bearerAuth', type: 'http', scheme: 'bearer' })]);
    expect(m.operations.map((o) => o.id)).toEqual(['login', 'getUser', 'listUserOrders', 'createOrder', 'getOrder', 'health']);
    const getUser = m.operations.find((o) => o.id === 'getUser')!;
    expect(getUser.params).toEqual([expect.objectContaining({ name: 'id', in: 'path', required: true, example: 1001 })]);
    const login = m.operations.find((o) => o.id === 'login')!;
    expect(login.security).toEqual([]);
    expect(login.requestBody?.schema).toMatchObject({ required: ['username', 'password'] });
  });

  it('converts nullable and keeps allOf/oneOf in response schemas', async () => {
    const { model: m } = await model('mock-api.openapi.yaml');
    const order = m.operations.find((o) => o.id === 'getOrder')!.responses.find((r) => r.status === '200')!.schema as any;
    const data = order.properties.data;
    expect(data.allOf).toHaveLength(2);
    expect(data.allOf[1].properties.payment.oneOf).toHaveLength(2);
    const user = m.operations.find((o) => o.id === 'getUser')!.responses[0]!.schema as any;
    expect(user.properties.data.allOf[1].properties.address.properties.zip.type).toEqual(['string', 'null']);
  });

  it('generates requests grouped by tag with sample bodies and auth', async () => {
    const { model: m } = await model('mock-api.openapi.yaml');
    const c = generateCollection(m);
    expect(c.auth).toEqual({ type: 'bearer', token: '{{accessToken}}' });
    expect(c.variables).toEqual([
      { key: 'baseUrl', value: 'http://localhost:4780', isSecret: false },
      { key: 'accessToken', value: '', isSecret: true },
    ]);
    expect(c.folders.map((f) => [f.name, f.requests.map((r) => r.def.name)])).toEqual([
      ['Auth', ['Login']],
      ['Users', ['Get User Profile']],
      ['Orders', ['Get User Orders', 'Create Order', 'Get Order Details']],
    ]);
    expect(c.requests.map((r) => r.def.name)).toEqual(['Health check']);
    const login = c.folders[0]!.requests[0]!;
    expect(login.def.auth).toEqual({ type: 'none' });
    expect(JSON.parse(login.def.body.raw!)).toEqual({ username: 'john', password: 'secret' });
    const profile = c.folders[1]!.requests[0]!;
    expect(profile.def.url).toBe('{{baseUrl}}/users/:id');
    expect(profile.def.auth).toEqual({ type: 'inherit' });
    expect(profile.def.pathParams[0]).toMatchObject({ key: 'id', value: '1001' });
    const orders = c.folders[2]!.requests[0]!;
    expect(orders.def.params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['status', 'pending', false],
      ['limit', '20', false],
    ]);
    expect(JSON.parse(c.folders[2]!.requests[1]!.def.body.raw!)).toEqual({ items: [{ sku: 'MUG', quantity: 1 }], notes: 'string' });
    expect(profile.fingerprint).toMatch(/^[0-9a-f]{14}$/);
  });

  it('produces stable fingerprints across imports', async () => {
    const a = generateCollection((await model('mock-api.openapi.yaml')).model);
    const b = generateCollection((await model('mock-api.openapi.yaml')).model);
    expect(a.folders[1]!.requests[0]!.fingerprint).toBe(b.folders[1]!.requests[0]!.fingerprint);
  });
});

describe('OpenAPI 3.1 (JSON)', () => {
  it('supports type arrays and examples', async () => {
    const { model: m } = await model('mock-api.openapi-3.1.json');
    expect(m.specVersion).toBe('3.1.0');
    const c = generateCollection(m);
    expect(JSON.parse(c.folders[0]!.requests[0]!.def.body.raw!)).toEqual({ username: 'john', password: 'secret' });
    const zip = (m.operations[1]!.responses[0]!.schema as any).properties.data.properties.address.properties.zip;
    expect(zip.type).toEqual(['string', 'null']);
    expect(c.folders[1]!.requests[0]!.def.auth).toEqual({ type: 'inherit' });
  });
});

describe('Swagger 2.0', () => {
  it('maps host/basePath, body params, query arrays and apiKey security', async () => {
    const { model: m } = await model('petstore.swagger2.json');
    expect(m.servers).toEqual([{ url: 'https://petstore.example.com/v2' }]);
    const c = generateCollection(m);
    expect(c.auth).toEqual({ type: 'apikey', key: 'api_key', value: '{{apiKey}}', in: 'header' });
    const add = c.folders[0]!.requests.find((r) => r.operationId === 'addPet')!;
    expect(JSON.parse(add.def.body.raw!)).toMatchObject({ name: 'doggie', photoUrls: ['string'], status: 'available' });
    const find = c.folders[0]!.requests.find((r) => r.operationId === 'findPetsByStatus')!;
    expect(find.def.params[0]).toMatchObject({ key: 'status', value: 'available', enabled: true });
    expect(c.folders.map((f) => f.name)).toEqual(['pet', 'store']);
  });
});

describe('errors and helpers', () => {
  it('rejects invalid input', async () => {
    expect(() => parseSpecText('')).toThrow(SpecError);
    expect(() => parseSpecText('foo: bar')).toThrow(/Missing/);
    await expect(loadSpec('openapi: 4.0.0\ninfo: {}\npaths: {}')).rejects.toThrow(/Unsupported/);
  });

  it('does not follow external refs', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: { '/x': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: 'file:///etc/passwd' } } } } } } } },
    });
    const loaded = await loadSpec(spec).catch((e) => e);
    expect(JSON.stringify(loaded)).not.toContain('root:');
  });

  it('cuts circular schemas', () => {
    const node: any = { type: 'object', properties: {} };
    node.properties.child = node;
    expect(toJsonSchema(node)).toEqual({ type: 'object', properties: { child: {} } });
  });

  it('samples oneOf, allOf and formats', () => {
    expect(sampleFromSchema({ oneOf: [{ type: 'null' }, { type: 'string', format: 'email' }] })).toBe('user@example.com');
    expect(sampleFromSchema({ allOf: [{ properties: { a: { type: 'integer' } } }, { properties: { b: { type: 'boolean' } } }] })).toEqual({ a: 0, b: true });
  });
});
