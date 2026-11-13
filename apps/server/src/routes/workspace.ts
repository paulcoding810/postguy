import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateCollectionInput,
  CreateEnvironmentInput,
  CreateRequestInput,
  HistoryQuery,
  ImportCollectionInput,
  ReplaceVariablesInput,
  UpdateCollectionInput,
  UpdateEnvironmentInput,
  UpdateRequestInput,
  SetVariableInput,
  VariableOwnerParams,
} from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { parse } from '../lib/errors.ts';
import * as collections from '../services/collections.ts';
import * as cookies from '../services/cookies.ts';
import * as envs from '../services/environments.ts';
import * as history from '../services/history.ts';
import * as memory from '../services/memory.ts';
import * as reqs from '../services/requests.ts';
import * as transfer from '../services/transfer.ts';
import * as vars from '../services/variables.ts';

const IdParams = z.object({ id: z.string().min(1) });

export function workspaceRoutes(app: FastifyInstance, db: Db) {
  const id = (p: unknown) => parse(IdParams, p).id;

  app.get('/collections/tree', async () => collections.getTree(db));
  app.post('/collections', async (req) => collections.createCollection(db, parse(CreateCollectionInput, req.body)));
  app.get('/collections/:id', async (req) => collections.getCollection(db, id(req.params)));
  app.patch('/collections/:id', async (req) =>
    collections.updateCollection(db, id(req.params), parse(UpdateCollectionInput, req.body)),
  );
  app.delete('/collections/:id', async (req) => {
    collections.deleteCollection(db, id(req.params));
    return { ok: true };
  });
  app.get('/collections/:id/export', async (req) => transfer.exportCollection(db, id(req.params)));
  app.post('/collections/import', async (req) => {
    const { root, warnings } = transfer.importCollection(db, parse(ImportCollectionInput, req.body).data);
    return { ...root, warnings };
  });

  app.get('/requests/:id', async (req) => reqs.getRequest(db, id(req.params)));
  app.post('/requests', async (req) => reqs.createRequest(db, parse(CreateRequestInput, req.body)));
  app.patch('/requests/:id', async (req) => reqs.updateRequest(db, id(req.params), parse(UpdateRequestInput, req.body)));
  app.delete('/requests/:id', async (req) => {
    reqs.deleteRequest(db, id(req.params));
    return { ok: true };
  });
  app.post('/requests/:id/duplicate', async (req) => reqs.duplicateRequest(db, id(req.params)));

  app.get('/environments', async () => envs.listEnvironments(db));
  app.post('/environments', async (req) => envs.createEnvironment(db, parse(CreateEnvironmentInput, req.body).name));
  app.patch('/environments/:id', async (req) =>
    envs.updateEnvironment(db, id(req.params), parse(UpdateEnvironmentInput, req.body)),
  );
  app.delete('/environments/:id', async (req) => {
    envs.deleteEnvironment(db, id(req.params));
    return { ok: true };
  });
  app.post('/environments/import', async (req) => envs.importEnvironment(db, parse(ImportCollectionInput, req.body).data));
  app.get('/environments/:id/export', async (req) => envs.exportEnvironment(db, id(req.params)));
  app.post('/environments/:id/activate', async (req) => {
    envs.activateEnvironment(db, id(req.params));
    return envs.getEnvironment(db, id(req.params));
  });
  app.post('/environments/deactivate', async () => {
    envs.activateEnvironment(db, null);
    return { ok: true };
  });

  app.get('/variables/:scope/:ownerId', async (req) => {
    const p = parse(VariableOwnerParams, req.params);
    const reveal = (req.query as { reveal?: string }).reveal === '1';
    return vars.listVariables(db, p.scope, p.ownerId, reveal);
  });
  app.put('/variables/:scope/:ownerId', async (req) => {
    const p = parse(VariableOwnerParams, req.params);
    return vars.replaceVariables(db, p.scope, p.ownerId, parse(ReplaceVariablesInput, req.body).variables);
  });

  app.put('/variables/:scope/:ownerId/:key', async (req) => {
    const p = parse(VariableOwnerParams.extend({ key: z.string().min(1) }), req.params);
    const body = parse(SetVariableInput, req.body);
    return vars.setVariable(db, p.scope, p.ownerId, p.key, body.value, body.isSecret);
  });

  app.get('/reference-sources', async (req) =>
    memory.referenceSources(db, parse(z.object({ collectionId: z.string().optional() }), req.query).collectionId),
  );
  app.get('/requests/:id/snapshots', async (req) => memory.listSnapshots(db, id(req.params)));
  app.get('/snapshots/:id', async (req) => memory.getSnapshot(db, id(req.params)));
  app.post('/requests/:id/pin-snapshot', async (req) =>
    memory.pinSnapshot(db, id(req.params), parse(z.object({ snapshotId: z.string().nullable() }), req.body).snapshotId),
  );
  app.get('/requests/:id/schema', async (req) => memory.effectiveSchema(db, id(req.params)));

  app.get('/history', async (req) => history.listHistory(db, parse(HistoryQuery, req.query)));
  app.get('/history/:id', async (req) => history.getHistoryEntry(db, id(req.params)));
  app.delete('/history', async () => {
    history.clearHistory(db);
    return { ok: true };
  });

  app.get('/cookies', async () => cookies.listCookies(db));
  app.delete('/cookies/:id', async (req) => {
    cookies.deleteCookie(db, id(req.params));
    return { ok: true };
  });
  app.delete('/cookies', async (req) => {
    const q = parse(z.object({ environmentId: z.string().optional(), domain: z.string().optional() }), req.query);
    return { removed: cookies.clearCookies(db, q.environmentId === undefined ? undefined : q.environmentId || null, q.domain) };
  });
}
