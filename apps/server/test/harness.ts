import type { FastifyInstance } from 'fastify';
import { buildMockApi } from '@postguy/mock-api';
import type { RouteKey } from '@postguy/shared';
import { buildServer } from '../src/app.ts';
import { openDatabase, type Db } from '../src/db/client.ts';

export const TOKEN = 'test-token';

export interface Harness {
  app: FastifyInstance;
  db: Db;
  mockUrl: string;
  call: <T = any>(method: string, url: string, body?: unknown) => Promise<{ status: number; body: T }>;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const { db, close } = openDatabase(':memory:');
  const app = await buildServer({ db, token: TOKEN });
  const mock = buildMockApi();
  await mock.listen({ port: 0, host: '127.0.0.1' });
  const addr = mock.server.address();
  const mockUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return {
    app,
    db,
    mockUrl,
    call: async (method, url, body) => {
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: { authorization: `Bearer ${TOKEN}` },
        ...(body !== undefined && { payload: body as object }),
      });
      const text = res.body;
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* non-JSON body */
      }
      return { status: res.statusCode, body: parsed as any };
    },
    close: async () => {
      await app.close();
      await mock.close();
      close();
    },
  };
}

export type { RouteKey };
