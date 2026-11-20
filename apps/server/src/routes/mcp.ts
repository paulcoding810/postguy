import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { UpdateMcpSettings, type McpSetup } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { parse } from '../lib/errors.ts';
import { createMcpServer } from '../services/mcp/tools.ts';
import { getMcpSettings, updateMcpSettings } from '../services/settings.ts';

/** The stdio bridge Claude Code starts: next to the bundled server, or in apps/server/bin in development. */
function bridgeScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const found = [join(here, 'postguy-mcp.mjs'), join(here, '../bin/postguy-mcp.mjs'), join(here, '../../bin/postguy-mcp.mjs')].find((p) => existsSync(p));
  return found ?? join(here, '../../bin/postguy-mcp.mjs');
}

const quote = (s: string) => (/^[\w./:@-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`);

export function mcpRoutes(app: FastifyInstance, db: Db, dataDir: string | null) {
  app.get('/settings/mcp', async () => getMcpSettings(db));
  app.patch('/settings/mcp', async (req) => updateMcpSettings(db, parse(UpdateMcpSettings, req.body)));
  app.get('/settings/mcp/setup', async (): Promise<McpSetup> => {
    const script = bridgeScript();
    // The packaged app ships its own Node next to the bridge; from source, use the Node on PATH (a Homebrew path changes on upgrade).
    const command = /[\\/]bin[\\/]postguy-mcp\.mjs$/.test(script) ? 'node' : process.execPath;
    const args = [script, ...(dataDir ? ['--data-dir', dataDir] : [])];
    return { command, args, claudeCode: `claude mcp add postguy -- ${[command, ...args].map(quote).join(' ')}` };
  });

  // Stateless Streamable HTTP: a fresh server per request, plain JSON responses.
  app.post('/mcp', async (req, reply) => {
    const server = createMcpServer(db);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  const notAllowed = { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null };
  app.get('/mcp', async (_req, reply) => reply.code(405).send(notAllowed));
  app.delete('/mcp', async (_req, reply) => reply.code(405).send(notAllowed));
}
