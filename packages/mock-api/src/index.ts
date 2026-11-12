import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { orders, publicUser, users, type Order } from './data.ts';

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

export interface MockApiOptions {
  logger?: boolean;
  tokenTtlSeconds?: number;
}

export function buildMockApi(opts: MockApiOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  const tokens = new Map<string, { userId: number; expiresAt: number }>();
  const ttl = opts.tokenTtlSeconds ?? 3600;
  const extraOrders: Order[] = [];
  const allOrders = () => [...orders, ...extraOrders];

  function authUser(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    const session = m ? tokens.get(m[1]!) : undefined;
    if (!session || session.expiresAt < Date.now()) {
      reply.code(401).send({ error: { code: 'unauthorized', message: 'Missing or invalid bearer token' } });
      return null;
    }
    return users.find((u) => u.id === session.userId) ?? null;
  }

  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  app.get('/openapi.yaml', async (_req, reply) => reply.type('application/yaml').send(fixture('mock-api.openapi.yaml')));
  app.get('/openapi.v2.yaml', async (_req, reply) => reply.type('application/yaml').send(fixture('mock-api.openapi.v2.yaml')));
  app.get('/openapi.json', async (_req, reply) => reply.type('application/json').send(fixture('mock-api.openapi-3.1.json')));

  app.post<{ Body: { username?: string; password?: string } }>('/auth/login', async (req, reply) => {
    const { username, password } = req.body ?? {};
    const user = users.find((u) => u.username === username && u.password === password);
    if (!user) return reply.code(401).send({ error: { code: 'invalid_credentials', message: 'Invalid username or password' } });
    const token = `tok_${randomBytes(12).toString('hex')}`;
    tokens.set(token, { userId: user.id, expiresAt: Date.now() + ttl * 1000 });
    reply.header('set-cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}`);
    return {
      data: {
        access_token: token,
        token_type: 'Bearer',
        expires_in: ttl,
        user: { id: user.id, name: user.name, role: user.role },
      },
    };
  });

  let tokenRequests = 0;
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );
  /** OAuth 2.0 token endpoint: client_credentials (postguy / shh) and password grants. */
  app.post<{ Body: Record<string, string> }>('/oauth/token', async (req, reply) => {
    tokenRequests++;
    const body = req.body ?? {};
    let clientId = body.client_id;
    let clientSecret = body.client_secret;
    const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '');
    if (basic) [clientId, clientSecret] = Buffer.from(basic[1]!, 'base64').toString().split(':');
    if (clientId !== 'postguy' || clientSecret !== 'shh') return reply.code(401).send({ error: 'invalid_client' });
    let user = users[0]!;
    if (body.grant_type === 'password') {
      const u = users.find((x) => x.username === body.username && x.password === body.password);
      if (!u) return reply.code(400).send({ error: 'invalid_grant' });
      user = u;
    } else if (body.grant_type !== 'client_credentials') return reply.code(400).send({ error: 'unsupported_grant_type' });
    const token = `oat_${randomBytes(12).toString('hex')}`;
    tokens.set(token, { userId: user.id, expiresAt: Date.now() + ttl * 1000 });
    return { access_token: token, token_type: 'Bearer', expires_in: ttl, scope: body.scope ?? '' };
  });
  app.get('/oauth/stats', async () => ({ tokenRequests }));

  app.get<{ Params: { id: string } }>('/users/:id', async (req, reply) => {
    const me = authUser(req, reply);
    if (!me) return reply;
    const user = users.find((u) => u.id === Number(req.params.id));
    if (!user) return reply.code(404).send({ error: { code: 'not_found', message: 'User not found' } });
    if (me.role !== 'admin' && me.id !== user.id)
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Cannot view other users' } });
    return { data: publicUser(user) };
  });

  app.get<{ Params: { id: string }; Querystring: { status?: string; limit?: string } }>(
    '/users/:id/orders',
    async (req, reply) => {
      const me = authUser(req, reply);
      if (!me) return reply;
      const userId = Number(req.params.id);
      if (me.role !== 'admin' && me.id !== userId)
        return reply.code(403).send({ error: { code: 'forbidden', message: 'Cannot view other users' } });
      let list = allOrders().filter((o) => o.userId === userId);
      if (req.query.status) list = list.filter((o) => o.status === req.query.status);
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      return {
        data: list.slice(0, limit).map(({ items: _items, payment: _payment, ...o }) => o),
        meta: { total: list.length, limit },
      };
    },
  );

  app.get<{ Params: { id: string } }>('/orders/:id', async (req, reply) => {
    const me = authUser(req, reply);
    if (!me) return reply;
    const order = allOrders().find((o) => o.id === Number(req.params.id));
    if (!order || (me.role !== 'admin' && order.userId !== me.id))
      return reply.code(404).send({ error: { code: 'not_found', message: 'Order not found' } });
    return { data: order };
  });

  app.post<{ Body: { items?: { sku: string; quantity: number }[]; notes?: string } }>(
    '/orders',
    async (req, reply) => {
      const me = authUser(req, reply);
      if (!me) return reply;
      const items = req.body?.items ?? [];
      if (!Array.isArray(items) || items.length === 0)
        return reply.code(422).send({ error: { code: 'validation', message: 'items must be a non-empty array' } });
      const order: Order = {
        id: 6000 + extraOrders.length + 1,
        userId: me.id,
        status: 'pending',
        currency: 'GBP',
        total: items.reduce((sum, i) => sum + 10 * (i.quantity ?? 1), 0),
        items: items.map((i) => ({ sku: i.sku, name: i.sku, quantity: i.quantity ?? 1, unitPrice: 10 })),
        payment: { type: 'card', brand: 'visa', last4: '4242' },
        notes: req.body?.notes ?? null,
        createdAt: new Date().toISOString(),
      };
      extraOrders.push(order);
      return reply.code(201).send({ data: order });
    },
  );

  app.get('/echo', async (req) => ({ method: req.method, query: req.query, headers: req.headers }));
  app.post('/echo', async (req) => ({ method: req.method, query: req.query, headers: req.headers, body: req.body }));
  app.get('/slow', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    return { ok: true };
  });
  app.get('/redirect', async (_req, reply) => reply.redirect('/health'));
  app.get('/text', async (_req, reply) => reply.type('text/plain').send('plain text body'));

  return app;
}
