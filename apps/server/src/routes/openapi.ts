import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OpenApiImportInput } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { parse } from '../lib/errors.ts';
import * as openapi from '../services/openapi.ts';

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
  app.get('/requests/:id/operation', async (req) => openapi.operationForRequest(db, parse(IdParams, req.params).id));
  app.get('/collections/:id/export/openapi', async (req, reply) => {
    const { format } = parse(ExportQuery, req.query);
    const text = openapi.exportOpenApi(db, parse(IdParams, req.params).id, format);
    return reply.type(format === 'yaml' ? 'application/yaml' : 'application/json').send(text);
  });
}
