import { and, eq, inArray, isNull } from 'drizzle-orm';
import { redactAuth } from '@postguy/core';
import type { Auth, ChangeEntry, RequestDefinition } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { collections, flowSteps, requests } from '../db/schema.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import {
  collectionSnapshot,
  getChange,
  recordChange,
  requestSnapshot,
  rootIdOf,
  withSource,
  type CollectionSnapshot,
  type RequestSnapshot,
} from './changelog.ts';
import { createCollection, updateCollection } from './collections.ts';
import { createRequest, updateRequest } from './requests.ts';
import { replaceVariables } from './variables.ts';

const MASK = '••••••';

const exists = (db: Db, table: typeof collections | typeof requests, id: string) => !!db.select({ id: table.id }).from(table).where(eq(table.id, id)).get();

/** Secret variable values and auth credentials are never sent to the app in history entries. */
export function maskSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSnapshot);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'auth' && v && typeof v === 'object' && 'type' in v) out[k] = redactAuth(v as Auth);
    else if (k === 'variables' && Array.isArray(v)) out[k] = v.map((x) => (x?.isSecret ? { ...x, value: MASK } : x));
    else out[k] = maskSnapshot(v);
  }
  return out;
}

export function toEntry(row: NonNullable<ReturnType<typeof getChange>>): ChangeEntry {
  return { ...row, before: maskSnapshot(row.before), after: maskSnapshot(row.after), restorable: row.action !== 'create' };
}

function definition(snap: RequestSnapshot): RequestDefinition & { description: string | null } {
  const r = snap.request as Record<string, unknown>;
  return {
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    method: r.method as RequestDefinition['method'],
    url: r.url as string,
    params: r.params as RequestDefinition['params'],
    pathParams: (r.pathParams as RequestDefinition['pathParams']) ?? [],
    headers: r.headers as RequestDefinition['headers'],
    auth: r.auth as RequestDefinition['auth'],
    body: r.body as RequestDefinition['body'],
    settings: (r.settings as RequestDefinition['settings']) ?? {},
    scripts: snap.scripts,
  };
}

/** Puts a request back as it was in `snap`, recreating it with its old id if it was deleted. */
function restoreRequest(db: Db, snap: RequestSnapshot) {
  const id = snap.request.id;
  if (!exists(db, collections, snap.request.collectionId))
    throw new HttpError(409, `The folder that "${snap.request.name}" was in no longer exists; restore that folder first.`, 'parent_missing');
  if (exists(db, requests, id)) updateRequest(db, id, { ...definition(snap), collectionId: snap.request.collectionId });
  else {
    createRequest(
      db,
      { ...definition(snap), collectionId: snap.request.collectionId },
      { id, openapiOperationId: (snap.request.openapiOperationId as string | null) ?? null, openapiFingerprint: (snap.request.openapiFingerprint as string | null) ?? null },
    );
    const steps = snap.flowSteps ?? [];
    if (steps.length) db.update(flowSteps).set({ requestId: id }).where(and(inArray(flowSteps.id, steps.map((s) => s.stepId)), isNull(flowSteps.requestId))).run();
  }
  replaceVariables(db, 'request', id, snap.variables);
}

/** Recreates a deleted collection or folder and everything that was in it. */
function restoreSubtree(db: Db, snap: CollectionSnapshot) {
  const c = snap.collection;
  if (c.parentId && !exists(db, collections, c.parentId)) throw new HttpError(409, `The folder that "${c.name}" was in no longer exists; restore that folder first.`, 'parent_missing');
  if (!exists(db, collections, c.id))
    createCollection(db, { id: c.id, name: c.name, parentId: c.parentId, description: (c.description as string | null) ?? null, auth: c.auth as Auth, scripts: snap.scripts });
  replaceVariables(db, 'collection', c.id, snap.variables);
  for (const r of snap.requests ?? []) restoreRequest(db, r);
  for (const f of snap.folders ?? []) restoreSubtree(db, f);
}

/** Undoes one change: an edit goes back to the version before it, a deletion comes back. */
export function restoreChange(db: Db, id: string): { message: string } {
  const change = getChange(db, id);
  if (!change) throw notFound('Change');
  if (change.action === 'create') throw new HttpError(400, 'A creation cannot be restored; delete the item instead.', 'not_restorable');
  const before = change.before;
  if (change.entityType === 'request') {
    const snap = before as RequestSnapshot;
    const current = requestSnapshot(db, snap.request.id);
    db.transaction(() => withSource('restore', () => restoreRequest(db, snap)));
    recordChange(db, { rootId: rootIdOf(db, snap.request.collectionId), entityType: 'request', entityId: snap.request.id, label: snap.request.name, action: current ? 'update' : 'create', before: current, after: requestSnapshot(db, snap.request.id) });
    return { message: current ? `Restored the earlier version of "${snap.request.name}".` : `Brought back "${snap.request.name}".` };
  }
  if (change.entityType === 'collection') {
    const snap = before as CollectionSnapshot;
    if (change.action === 'delete') {
      db.transaction(() => withSource('restore', () => restoreSubtree(db, snap)));
      recordChange(db, { rootId: rootIdOf(db, snap.collection.id), entityType: 'collection', entityId: snap.collection.id, label: snap.collection.name, action: 'create', before: null, after: collectionSnapshot(db, snap.collection.id) });
      return { message: `Brought back "${snap.collection.name}" and everything in it.` };
    }
    if (!exists(db, collections, snap.collection.id)) throw new HttpError(409, `"${snap.collection.name}" was deleted; restore it from its deletion first.`, 'gone');
    const parentOk = !snap.collection.parentId || exists(db, collections, snap.collection.parentId);
    updateCollection(db, snap.collection.id, {
      name: snap.collection.name,
      description: (snap.collection.description as string | null) ?? null,
      auth: snap.collection.auth as Auth,
      scripts: snap.scripts,
      ...(parentOk && { parentId: snap.collection.parentId }),
    });
    return { message: `Restored the earlier settings of "${snap.collection.name}".` };
  }
  if (!exists(db, collections, change.entityId)) throw new HttpError(409, `"${change.label}" was deleted; restore it from its deletion first.`, 'gone');
  replaceVariables(db, 'collection', change.entityId, before as CollectionSnapshot['variables']);
  return { message: `Restored the earlier variables of "${change.label}".` };
}
