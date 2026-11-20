import type { FastifyInstance } from 'fastify';
import { notifyChange, onChange } from '../services/changes.ts';

/** POSTs that only compute or read; they change nothing others need to reload. */
const READ_ONLY = [/^\/resolve-preview/, /^\/import\/curl/, /^\/export\/curl/, /^\/oauth\//, /^\/flows\/[^/]+\/suggest-mappings/, /^\/mcp/];

export function eventRoutes(app: FastifyInstance) {
  // Every successful write tells the app windows, so they reload what someone else changed.
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'OPTIONS' || reply.statusCode >= 400) return;
    const path = req.url.split('?')[0]!;
    if (READ_ONLY.some((r) => r.test(path))) return;
    const origin = req.headers['x-postguy-client'];
    notifyChange({ origin: typeof origin === 'string' ? origin : null, what: `${req.method} ${path}` });
  });

  /** Server-sent events: `change` for each workspace change, with a comment every 25 s to keep the stream open. */
  app.get('/events', async (req, reply) => {
    reply.hijack();
    // Hijacked replies skip the CORS plugin, so the header is set here, as for flow run streams.
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    });
    reply.raw.write(': connected\n\n');
    const off = onChange((c) => reply.raw.write(`event: change\ndata: ${JSON.stringify(c)}\n\n`));
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      off();
      clearInterval(ping);
    });
  });
}
