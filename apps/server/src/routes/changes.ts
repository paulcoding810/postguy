import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ActivityQuery } from '@postguy/shared';
import { listActivity } from '../services/activity.ts';
import type { Db } from '../db/client.ts';
import { parse } from '../lib/errors.ts';
import { deletedCollections, listChanges, rootIdOf } from '../services/changelog.ts';
import { restoreChange, toEntry } from '../services/changeRestore.ts';
import { getCollection } from '../services/collections.ts';

const IdParams = z.object({ id: z.string().min(1) });

export function changeRoutes(app: FastifyInstance, db: Db) {
  /** A collection's changes, newest first; a folder shows its whole collection, optionally narrowed to one entity. */
  app.get('/collections/:id/changes', async (req) => {
    const { id } = parse(IdParams, req.params);
    getCollection(db, id);
    const { entityId } = parse(z.object({ entityId: z.string().optional() }), req.query);
    return listChanges(db, rootIdOf(db, id), { entityId }).map(toEntry);
  });
  app.get('/changes/deleted', async () => deletedCollections(db).map(toEntry));
  app.post('/changes/:id/restore', async (req) => restoreChange(db, parse(IdParams, req.params).id));
  app.get('/activity', async (req) => listActivity(db, parse(ActivityQuery, req.query)));
}
