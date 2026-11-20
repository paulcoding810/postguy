import { describe, expect, it } from 'vitest';
import { sampleHar } from './har.fixture.ts';
import { harToCollection, isHar } from './har.ts';

describe('harToCollection', () => {
  it('recognises HAR files', () => {
    expect(isHar(sampleHar())).toBe(true);
    expect(isHar({ info: {}, item: [] })).toBe(false);
  });

  it('keeps API calls, groups them by host and maps URLs, queries and bodies', () => {
    const { collection, warnings } = harToCollection(sampleHar());
    const root = collection.collection;
    expect(root.name).toBe('Shop admin');
    expect(root.folders.map((f) => [f.name, f.variables[0]])).toEqual([
      ['api.shop.test', { key: 'baseUrl', value: 'https://api.shop.test', isSecret: false }],
      ['files.shop.test', { key: 'baseUrl', value: 'https://files.shop.test', isSecret: false }],
    ]);
    const api = root.folders[0]!.requests;
    expect(api.map((r) => r.name)).toEqual(['GET /users/7', 'POST /orders', 'POST /login']);
    expect(api[0]).toMatchObject({ method: 'GET', url: '{{baseUrl}}/users/7', auth: { type: 'inherit' } });
    expect(api[0]!.params.map((p) => [p.key, p.value])).toEqual([['expand', 'orders'], ['page', '2']]);
    expect(api[0]!.headers.map((x) => x.key)).toEqual(['accept', 'x-tenant']);
    expect(api[1]!.body).toEqual({ mode: 'json', raw: '{\n  "sku": "A1",\n  "qty": 2\n}' });
    expect(api[2]!.body.mode).toBe('urlencoded');
    expect(api[2]!.body.form!.map((p) => [p.key, p.value])).toEqual([['user', 'ann'], ['pass', 'p w']]);
    const upload = root.folders[1]!.requests[0]!;
    expect(upload.body.form!.map((p) => p.key)).toEqual(['title']);
    expect(upload.headers.map((x) => [x.key, x.value])).toEqual([['authorization', 'Basic YTpi']]);
    expect(warnings).toEqual(
      expect.arrayContaining([
        'Imported 4 API calls from 2 hosts, one folder each.',
        "Skipped 4 entries that aren't API calls (pages, scripts, styles, images, fonts).",
        'Collapsed 1 repeated call.',
        '1 request kept a non-bearer Authorization header as recorded.',
        expect.stringMatching(/^The recorded bearer token is in the secret collection variable \{\{token\}\}/),
        expect.stringMatching(/^Cookie headers were not imported \(3 requests\)/),
        expect.stringMatching(/^File fields aren't in HAR recordings.*POST \/upload \(file\)/),
      ]),
    );
  });

  it('moves the bearer token into a secret collection variable', () => {
    const root = harToCollection(sampleHar()).collection.collection;
    expect(root.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(root.variables).toEqual([{ key: 'token', value: 'tok-123', isSecret: true }]);
    const all = root.folders.flatMap((f) => f.requests);
    expect(all.some((r) => r.headers.some((x) => x.key.toLowerCase() === 'authorization' && x.value.startsWith('Bearer')))).toBe(false);
  });

  it('puts a single host in a baseUrl variable on the collection', () => {
    const har = sampleHar();
    har.log.entries = har.log.entries.filter((e) => e.request.url.startsWith('https://api.'));
    const root = harToCollection(har, { name: 'API' }).collection.collection;
    expect(root.name).toBe('API');
    expect(root.folders).toEqual([]);
    expect(root.variables[0]).toEqual({ key: 'baseUrl', value: 'https://api.shop.test', isSecret: false });
    expect(root.requests).toHaveLength(3);
  });

  it('returns recorded text responses for remembering', () => {
    const { responses, collection } = harToCollection(sampleHar());
    const orders = collection.collection.folders[0]!.requests[1]!;
    expect(responses.find((r) => r.ref === orders.ref)).toEqual({ ref: orders.ref, status: 201, contentType: 'application/json', body: '{"id":"ord_1"}' });
  });

  it('explains when there are no API calls', () => {
    const har = sampleHar();
    har.log.entries = har.log.entries.slice(0, 3);
    expect(() => harToCollection(har)).toThrow(/No API calls found in this HAR: 3 entries/);
  });
});
