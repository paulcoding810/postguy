import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildServer } from './app.ts';
import { openDatabase } from './db/client.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.POSTGUY_PORT ?? '0' },
    token: { type: 'string', default: process.env.POSTGUY_TOKEN },
    'data-dir': { type: 'string', default: process.env.POSTGUY_DATA_DIR ?? '.data' },
    verbose: { type: 'boolean', default: false },
  },
});

const dataDir = resolve(values['data-dir']!);
const token = values.token ?? randomBytes(24).toString('hex');
const { db, close } = openDatabase(join(dataDir, 'postguy.db'));
const app = await buildServer({ db, token, logger: values.verbose });
await app.listen({ port: Number(values.port), host: '127.0.0.1' });
const address = app.server.address();
const port = typeof address === 'object' && address ? address.port : Number(values.port);

process.stdout.write(`${JSON.stringify({ event: 'ready', port, token, dataDir })}\n`);

const shutdown = async () => {
  await app.close();
  close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
