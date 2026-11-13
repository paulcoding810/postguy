import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OpenApiImportInput, SyncInput } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { notFound, parse } from '../lib/errors.ts';
import * as openapi from '../services/openapi.ts';
import * as sync from '../services/openapiSync.ts';

const IdParams = z.object({ id: z.string().min(1) });
const ExportQuery = z.object({ format: z.enum(['json', 'yaml']).default('json') });

export function openapiRoutes(app: FastifyInstance, db: Db) {
  app.get('/openapi', async () => openapi.listSpecs(db));
  app.post('/openapi/import', async (req) => openapi.importOpenApi(db, parse(OpenApiImportInput, req.body)));
  app.get('/openapi/:id', async (req) => openapi.getSpec(db, parse(IdParams, req.params).id));
  app.delete('/openapi/:id', async (req) => {
    openapi.deleteSpec(db, parse(IdParams, req.params).id);
    return { ok: true };
  });
  app.post('/openapi/:id/sync/preview', async (req) => sync.previewSync(db, parse(IdParams, req.params).id, parse(SyncInput, req.body ?? {})));
  app.post('/openapi/:id/sync', async (req) => sync.applySync(db, parse(IdParams, req.params).id, parse(SyncInput, req.body ?? {})));
  app.get('/openapi/:id/compare', async (req) => {
    const q = parse(z.object({ from: z.string(), to: z.string() }), req.query);
    return sync.compareVersions(db, parse(IdParams, req.params).id, q.from, q.to);
  });
  app.get('/requests/:id/operation', async (req) => openapi.operationForRequest(db, parse(IdParams, req.params).id));
  app.get('/requests/:id/spec-merge', async (req) => {
    const m = sync.specMerge(db, parse(IdParams, req.params).id, false);
    return m ? { added: m.added } : null;
  });
  app.post('/requests/:id/spec-merge', async (req) => {
    const m = sync.specMerge(db, parse(IdParams, req.params).id, true);
    if (!m) throw notFound('Linked OpenAPI operation');
    return m.request;
  });
  app.get('/collections/:id/export/openapi', async (req, reply) => {
    const { format } = parse(ExportQuery, req.query);
    const text = openapi.exportOpenApi(db, parse(IdParams, req.params).id, format);
    return reply.type(format === 'yaml' ? 'application/yaml' : 'application/json').send(text);
  });
}
