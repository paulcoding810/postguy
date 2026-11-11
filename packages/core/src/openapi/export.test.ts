import { describe, expect, it } from 'vitest';
import { RequestDefinition } from '@postguy/shared';
import { collectionToOpenApi } from './export.ts';

const req = (o: Partial<RequestDefinition>) => ({ ...RequestDefinition.parse({ name: 'r', method: 'GET', url: '', ...o }), description: null });

describe('collectionToOpenApi', () => {
  it('builds paths, tags, params, bodies and security without secrets', () => {
    const doc = collectionToOpenApi({
      name: 'Shop',
      description: null,
      auth: { type: 'bearer', token: '' },
      variables: [{ key: 'baseUrl', value: 'http://localhost:4780', isSecret: false }, { key: 'token', value: '', isSecret: true }],
      requests: [],
      folders: [
        {
          name: 'Users',
          description: null,
          auth: { type: 'inherit' },
          variables: [],
          folders: [],
          requests: [
            req({ name: 'Get User', url: '{{baseUrl}}/users/:id', pathParams: [{ id: '1', key: 'id', value: '{{Login.data.user.id}}', enabled: true }], params: [{ id: '2', key: 'expand', value: 'orders', enabled: false }] }),
            req({ name: 'Create User', method: 'POST', url: '{{baseUrl}}/users', body: { mode: 'json', raw: '{"name":"Ann","age":3}' } }),
          ],
        },
      ],
    }) as any;
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.servers).toEqual([{ url: 'http://localhost:4780' }]);
    expect(doc.tags).toEqual([{ name: 'Users' }]);
    const get = doc.paths['/users/{id}'].get;
    expect(get).toMatchObject({ operationId: 'getUser', tags: ['Users'], security: [{ bearerAuth: [] }] });
    expect(get.parameters[0]).toEqual({ name: 'id', in: 'path', required: true, schema: { type: 'string' } });
    expect(get.parameters[1]).toMatchObject({ name: 'expand', in: 'query', required: false, example: 'orders' });
    const post = doc.paths['/users'].post;
    expect(post.requestBody.content['application/json'].schema.properties.age).toEqual({ type: 'integer' });
    expect(doc.components.securitySchemes).toEqual({ bearerAuth: { type: 'http', scheme: 'bearer' } });
    expect(JSON.stringify(doc)).not.toContain('Login.data');
  });
});
