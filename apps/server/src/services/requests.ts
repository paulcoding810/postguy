import { and, eq, max } from 'drizzle-orm';
import {
  CreateRequestInput,
  newId,
  type SavedRequest,
  type UpdateRequestInput,
} from '@postguy/shared';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { requests, variables } from '../db/schema.ts';
import { notFound } from '../lib/errors.ts';
import { getCollection } from './collections.ts';
import { deleteScripts, loadScripts, saveScripts } from './scripts.ts';

export function getRequest(db: Db, id: string): SavedRequest {
  const row = db.select().from(requests).where(eq(requests.id, id)).get();
  if (!row) throw notFound('Request');
  return { ...row, scripts: loadScripts(db, 'request', id) } as SavedRequest;
}

function nextSortOrder(db: Db, collectionId: string): number {
  const row = db.select({ m: max(requests.sortOrder) }).from(requests).where(eq(requests.collectionId, collectionId)).get();
  return (row?.m ?? -1) + 1;
}

export interface CreateRequestExtras {
  openapiOperationId?: string | null;
  openapiFingerprint?: string | null;
}

export function createRequest(
  db: Db,
  input: z.output<typeof CreateRequestInput>,
  extras: CreateRequestExtras = {},
): SavedRequest {
  getCollection(db, input.collectionId);
  const now = Date.now();
  const row = {
    id: newId(),
    collectionId: input.collectionId,
    name: input.name,
    description: input.description ?? null,
    method: input.method,
    url: input.url,
    params: input.params,
    pathParams: input.pathParams,
    headers: input.headers,
    auth: input.auth,
    body: input.body,
    settings: input.settings,
    openapiOperationId: extras.openapiOperationId ?? null,
    openapiFingerprint: extras.openapiFingerprint ?? null,
    latestSuccessSnapshotId: null,
    pinnedSnapshotId: null,
    sortOrder: nextSortOrder(db, input.collectionId),
    createdAt: now,
    updatedAt: now,
  };
  db.transaction(() => {
    db.insert(requests).values(row).run();
    saveScripts(db, 'request', row.id, input.scripts);
  });
  return { ...row, scripts: input.scripts };
}

export function updateRequest(db: Db, id: string, input: UpdateRequestInput): SavedRequest {
  getRequest(db, id);
  if (input.collectionId) getCollection(db, input.collectionId);
  const { scripts, ...rest } = input;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  db.transaction(() => {
    db.update(requests)
      .set({ ...patch, updatedAt: Date.now() })
      .where(eq(requests.id, id))
      .run();
    if (scripts) {
      const current = loadScripts(db, 'request', id);
      saveScripts(db, 'request', id, { pre: scripts.pre ?? current.pre, post: scripts.post ?? current.post });
    }
  });
  return getRequest(db, id);
}

export function deleteRequest(db: Db, id: string): void {
  getRequest(db, id);
  db.transaction((tx) => {
    tx.delete(variables).where(and(eq(variables.scope, 'request'), eq(variables.ownerId, id))).run();
    tx.delete(requests).where(eq(requests.id, id)).run();
  });
  deleteScripts(db, 'request', [id]);
}

export function duplicateRequest(db: Db, id: string): SavedRequest {
  const src = getRequest(db, id);
  return createRequest(db, {
    collectionId: src.collectionId,
    name: `${src.name} copy`,
    description: src.description,
    method: src.method,
    url: src.url,
    params: src.params,
    pathParams: src.pathParams,
    headers: src.headers,
    auth: src.auth,
    body: src.body,
    settings: src.settings,
    scripts: src.scripts,
  });
}
