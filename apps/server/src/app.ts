import { timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db/client.ts';
import { registerErrorHandler } from './lib/errors.ts';
import { VERSION } from './lib/version.ts';
import { flowRoutes } from './routes/flows.ts';
import { openapiRoutes } from './routes/openapi.ts';
import { sendRoutes } from './routes/send.ts';
import { workspaceRoutes } from './routes/workspace.ts';

export { VERSION } from './lib/version.ts';

export interface ServerOptions {
  db: Db;
  token: string;
  logger?: boolean;
}

const ALLOWED_ORIGIN = /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

function tokenMatches(header: string | undefined, token: string): boolean {
  const m = header && /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 60 * 1024 * 1024 });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGIN.test(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  registerErrorHandler(app);

  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS' || req.url === '/health' || req.url.startsWith('/oauth/callback?')) return;
    if (!tokenMatches(req.headers.authorization, opts.token)) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Invalid server token' } });
    }
  });

  app.get('/health', async () => ({ ok: true as const, version: VERSION }));
  workspaceRoutes(app, opts.db);
  sendRoutes(app, opts.db);
  openapiRoutes(app, opts.db);
  flowRoutes(app, opts.db);
  return app;
}
