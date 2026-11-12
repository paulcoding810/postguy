import { asc, eq } from 'drizzle-orm';
import { redactAuth } from '@postguy/core';
import {
  Auth,
  RequestDefinition,
  type Collection,
  type CollectionExport,
  type ExportedCollection,
} from '@postguy/shared';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { collections, requests } from '../db/schema.ts';
import { badRequest } from '../lib/errors.ts';
import { createCollection, getCollection } from './collections.ts';
import { createRequest } from './requests.ts';
import { loadScripts } from './scripts.ts';
import { listVariables, replaceVariables } from './variables.ts';

export function exportCollection(db: Db, id: string): CollectionExport {
  return { format: 'postguy-collection', version: 1, collection: exportNode(db, getCollection(db, id)) };
}

function exportNode(db: Db, c: Collection): ExportedCollection {
  const folders = db
    .select()
    .from(collections)
    .where(eq(collections.parentId, c.id))
    .orderBy(asc(collections.sortOrder))
    .all();
  const reqs = db.select().from(requests).where(eq(requests.collectionId, c.id)).orderBy(asc(requests.sortOrder)).all();
  return {
    name: c.name,
    description: c.description,
    auth: redactAuth(c.auth),
    variables: listVariables(db, 'collection', c.id, true).map((v) => ({
      key: v.key,
      value: v.isSecret ? '' : v.value,
      isSecret: v.isSecret,
    })),
    folders: folders.map((f) => exportNode(db, f)),
    requests: reqs.map((r) => ({
      name: r.name,
      description: r.description,
      method: r.method,
      url: r.url,
      params: r.params,
      pathParams: r.pathParams,
      headers: r.headers,
      auth: redactAuth(r.auth),
      body: r.body,
      settings: r.settings,
      scripts: loadScripts(db, 'request', r.id),
    })),
  };
}

const ExportedCollectionSchema: z.ZodType<ExportedCollection> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    description: z.string().nullable().default(null),
    auth: Auth.default({ type: 'none' }),
    variables: z.array(z.object({ key: z.string(), value: z.string(), isSecret: z.boolean().default(false) })).default([]),
    folders: z.array(ExportedCollectionSchema).default([]),
    requests: z.array(RequestDefinition.extend({ description: z.string().nullable().default(null) })).default([]),
  }),
) as z.ZodType<ExportedCollection>;

const ExportSchema = z.object({
  format: z.literal('postguy-collection'),
  version: z.literal(1),
  collection: ExportedCollectionSchema,
});

export function importCollection(db: Db, data: unknown): Collection {
  const parsed = ExportSchema.safeParse(data);
  if (!parsed.success) throw badRequest('Not a valid Postguy collection export', parsed.error.issues.slice(0, 5));
  let root: Collection | null = null;
  db.transaction(() => {
    root = importNode(db, parsed.data.collection, null);
  });
  return root!;
}

function importNode(db: Db, node: ExportedCollection, parentId: string | null): Collection {
  const c = createCollection(db, { name: node.name, parentId, description: node.description, auth: node.auth });
  if (node.variables.length) replaceVariables(db, 'collection', c.id, node.variables.map((v) => ({ ...v, enabled: true })));
  for (const r of node.requests) createRequest(db, { ...RequestDefinition.parse(r), description: r.description, collectionId: c.id });
  for (const f of node.folders) importNode(db, f, c.id);
  return c;
}
