import { describe, expect, it } from 'vitest';
import type { OpenApiOperation, RequestDefinition } from '@postguy/shared';
import { requestFromOperation } from './generate.ts';
import { mergeOperation } from './merge.ts';

const op: OpenApiOperation = {
  id: 'getOrder',
  method: 'GET',
  path: '/v2/orders/{orderId}',
  tags: [],
  params: [
    { name: 'orderId', in: 'path', required: true, schema: { type: 'string' } },
    { name: 'page', in: 'query', required: true, schema: { type: 'integer' } },
    { name: 'sort', in: 'query', required: false, schema: { type: 'string' } },
    { name: 'X-Tenant', in: 'header', required: true, schema: { type: 'string' } },
  ],
  responses: [],
  security: [],
} as unknown as OpenApiOperation;
const model = { title: 'T', version: '2', servers: [], securitySchemes: [], globalSecurity: [], tags: [], operations: [op] } as never;

const mine: RequestDefinition = {
  name: 'Order',
  method: 'GET',
  url: 'https://api.test/orders/:orderId/extra',
  params: [{ id: 'p', key: 'PAGE', value: '3', enabled: true }],
  pathParams: [{ id: 'o', key: 'orderId', value: 'ord_1', enabled: true }],
  headers: [],
  auth: { type: 'inherit' },
  body: { mode: 'none' },
  settings: {},
  scripts: { pre: '', post: '' },
};

describe('mergeOperation', () => {
  it('adds only missing required params and headers, and keeps the path unless asked to follow it', () => {
    const gen = requestFromOperation(op, model, null);
    const kept = mergeOperation(mine, op, gen, { followPath: false });
    expect(kept.added).toEqual(['header X-Tenant']);
    expect(kept.def.url).toBe(mine.url);
    expect(kept.def.params).toEqual(mine.params);

    const moved = mergeOperation(mine, op, gen, { followPath: true });
    expect(moved.def.url).toBe('https://api.test/v2/orders/:orderId');
    expect(moved.def.pathParams).toEqual(mine.pathParams);
    expect(moved.added).toEqual(['header X-Tenant', 'URL /v2/orders/:orderId']);
  });
});
