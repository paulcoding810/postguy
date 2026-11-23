import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

async function setup() {
  const col = (await h.call('POST', '/collections', { name: 'Shop', parentId: null })).body;
  await h.call('PUT', `/variables/collection/${col.id}/base`, { value: h.mockUrl });
  const req = (
    await h.call('POST', '/requests', {
      collectionId: col.id,
      name: 'GetUser',
      method: 'POST',
      url: '{{base}}/graphql',
      body: { mode: 'graphql', raw: 'query GetUser($id: ID!) { user(id: $id) { name role } }', variables: '{ "id": "1001" }' },
    })
  ).body;
  return { col, req };
}

describe('GraphQL requests', () => {
  it('sends the query and variables, and remembers the response for references', async () => {
    const { col, req } = await setup();
    const res = (await h.call('POST', '/send', { requestId: req.id, collectionId: col.id, request: req })).body;
    expect(JSON.parse(res.body)).toEqual({ data: { user: { name: 'John Carter', role: 'customer' } } });
    const preview = (await h.call('POST', '/resolve-preview', { templates: ['{{GetUser.data.user.name}}'], collectionId: col.id })).body;
    expect(preview[0].value).toBe('John Carter');
  });

  it('fetches the schema with the request’s own settings and keeps it, without replacing the remembered response', async () => {
    const { col, req } = await setup();
    await h.call('POST', '/send', { requestId: req.id, collectionId: col.id, request: req });
    const got = (await h.call('POST', '/graphql/schema', { request: req, collectionId: col.id, requestId: req.id })).body;
    const types = got.schema.__schema.types.map((t: any) => t.name);
    expect(types).toEqual(expect.arrayContaining(['Query', 'Mutation', 'User', 'Order', 'Role']));
    expect(got.url).toBe(`${h.mockUrl}/graphql`);
    expect((await h.call('GET', `/requests/${req.id}/graphql-schema`)).body.fetchedAt).toBe(got.fetchedAt);
    const preview = (await h.call('POST', '/resolve-preview', { templates: ['{{GetUser.data.user.name}}'], collectionId: col.id })).body;
    expect(preview[0].value).toBe('John Carter');
  });

  it('explains when the endpoint isn’t GraphQL', async () => {
    const { req } = await setup();
    const res = await h.call('POST', '/graphql/schema', { request: { ...req, url: `${h.mockUrl}/text` } });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/doesn't look like GraphQL|without a schema/);
  });
});
