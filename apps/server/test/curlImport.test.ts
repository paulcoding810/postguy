import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

const command = `curl https://api.shop.com/v2/users -H 'Authorization: Bearer s3cret-token-1'`;

describe('POST /import/curl', () => {
  it("uses the collection's variables, secrets included, and keeps the pasted request", async () => {
    const col = (await h.call('POST', '/collections', { name: 'Shop', parentId: null })).body;
    await h.call('PUT', `/variables/collection/${col.id}`, {
      variables: [
        { key: 'baseUrl', value: 'https://api.shop.com/v2' },
        { key: 'token', value: 's3cret-token-1', isSecret: true },
      ],
    });
    const r = (await h.call('POST', '/import/curl', { command, collectionId: col.id })).body;
    expect(r.request.url).toBe('{{baseUrl}}/users');
    expect(r.request.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(r.variables).toEqual(['baseUrl', 'token']);
    expect(r.raw.url).toBe('https://api.shop.com/v2/users');
  });

  it('leaves values alone outside the collection or when asked to', async () => {
    const col = (await h.call('POST', '/collections', { name: 'Shop', parentId: null })).body;
    await h.call('PUT', `/variables/collection/${col.id}`, { variables: [{ key: 'baseUrl', value: 'https://api.shop.com/v2' }] });
    const outside = (await h.call('POST', '/import/curl', { command })).body;
    expect(outside).toMatchObject({ variables: [], request: { url: 'https://api.shop.com/v2/users' } });
    expect(outside.raw).toBeUndefined();
    const off = (await h.call('POST', '/import/curl', { command, collectionId: col.id, useVariables: false })).body;
    expect(off.request.url).toBe('https://api.shop.com/v2/users');
  });
});
