import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm';
import {
  newId,
  type Auth,
  type Collection,
  type CollectionTreeNode,
  type CreateCollectionInput,
  type UpdateCollectionInput,
} from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { collections, requests, scripts as scriptsTable, variables } from '../db/schema.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { collectionSnapshot, recordChange, rootIdOf } from './changelog.ts';
import { deleteScripts, loadScripts, saveScripts } from './scripts.ts';

export function getCollection(db: Db, id: string): Collection {
  const row = db.select().from(collections).where(eq(collections.id, id)).get();
  if (!row) throw notFound('Collection');
  return row;
}

/** The collection with its pre-request and post-response scripts. */
export function withScripts(db: Db, c: Collection): Collection {
  return { ...c, scripts: loadScripts(db, 'collection', c.id) };
}

export function getTree(db: Db): CollectionTreeNode[] {
  const all = db.select().from(collections).orderBy(asc(collections.sortOrder), asc(collections.createdAt)).all();
  const scriptRows = db.select().from(scriptsTable).where(eq(scriptsTable.ownerType, 'collection')).all();
  const scriptsOf = (id: string) => ({
    pre: scriptRows.find((r) => r.ownerId === id && r.phase === 'pre')?.source ?? '',
    post: scriptRows.find((r) => r.ownerId === id && r.phase === 'post')?.source ?? '',
  });
  const reqs = db
    .select({
      id: requests.id,
      name: requests.name,
      method: requests.method,
      url: requests.url,
      sortOrder: requests.sortOrder,
      collectionId: requests.collectionId,
    })
    .from(requests)
    .orderBy(asc(requests.sortOrder), asc(requests.createdAt))
    .all();
  const nodes = new Map<string, CollectionTreeNode>(all.map((c) => [c.id, { ...c, scripts: scriptsOf(c.id), children: [], requests: [] }]));
  for (const r of reqs) nodes.get(r.collectionId)?.requests.push(r);
  const roots: CollectionTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function nextSortOrder(db: Db, parentId: string | null): number {
  const row = db
    .select({ m: max(collections.sortOrder) })
    .from(collections)
    .where(parentId ? eq(collections.parentId, parentId) : isNull(collections.parentId))
    .get();
  return (row?.m ?? -1) + 1;
}

export function createCollection(db: Db, input: CreateCollectionInput & { openapiSpecId?: string | null; id?: string }): Collection {
  const parentId = input.parentId ?? null;
  if (parentId) getCollection(db, parentId);
  const kind = input.kind ?? (parentId ? 'folder' : 'collection');
  const now = Date.now();
  const row = {
    id: input.id ?? newId(),
    parentId,
    kind,
    name: input.name,
    description: input.description ?? null,
    auth: input.auth ?? ({ type: parentId ? 'inherit' : 'none' } as Auth),
    sortOrder: nextSortOrder(db, parentId),
    openapiSpecId: input.openapiSpecId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(collections).values(row).run();
  if (input.scripts) saveScripts(db, 'collection', row.id, { pre: input.scripts.pre ?? '', post: input.scripts.post ?? '' });
  recordChange(db, { rootId: parentId ? rootIdOf(db, parentId) : row.id, entityType: 'collection', entityId: row.id, label: row.name, action: 'create', before: null, after: collectionSnapshot(db, row.id) });
  return row;
}

/** Ids of the collection and all descendants. */
export function subtreeIds(db: Db, id: string): string[] {
  const all = db.select({ id: collections.id, parentId: collections.parentId }).from(collections).all();
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of all) if (c.parentId === out[i]) out.push(c.id);
  return out;
}

export function updateCollection(db: Db, id: string, input: UpdateCollectionInput): Collection {
  const current = getCollection(db, id);
  const before = collectionSnapshot(db, id);
  if (input.parentId !== undefined && input.parentId !== current.parentId) {
    if (input.parentId && subtreeIds(db, id).includes(input.parentId))
      throw badRequest('Cannot move a folder into itself');
    if (input.parentId) getCollection(db, input.parentId);
  }
  const patch = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.auth !== undefined && { auth: input.auth }),
    ...(input.parentId !== undefined && {
      parentId: input.parentId,
      kind: input.parentId ? ('folder' as const) : ('collection' as const),
    }),
    ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    updatedAt: Date.now(),
  };
  db.update(collections).set(patch).where(eq(collections.id, id)).run();
  if (input.scripts) {
    const current = loadScripts(db, 'collection', id);
    saveScripts(db, 'collection', id, { pre: input.scripts.pre ?? current.pre, post: input.scripts.post ?? current.post });
  }
  const after = collectionSnapshot(db, id)!;
  recordChange(db, { rootId: rootIdOf(db, id), entityType: 'collection', entityId: id, label: after.collection.name, action: 'update', before, after });
  return getCollection(db, id);
}

export function deleteCollection(db: Db, id: string): void {
  const doomed = getCollection(db, id);
  const before = collectionSnapshot(db, id, true)!;
  recordChange(db, { rootId: doomed.parentId ? rootIdOf(db, doomed.parentId) : id, entityType: 'collection', entityId: id, label: doomed.name, action: 'delete', before, after: null });
  const ids = subtreeIds(db, id);
  const reqIds = db.select({ id: requests.id }).from(requests).where(inArray(requests.collectionId, ids)).all().map((r) => r.id);
  db.transaction((tx) => {
    tx.delete(variables).where(and(eq(variables.scope, 'collection'), inArray(variables.ownerId, ids))).run();
    if (reqIds.length) tx.delete(variables).where(and(eq(variables.scope, 'request'), inArray(variables.ownerId, reqIds))).run();
    tx.delete(collections).where(eq(collections.id, id)).run();
  });
  deleteScripts(db, 'request', reqIds);
  deleteScripts(db, 'collection', ids);
}

/** The collection and its ancestors, innermost first. */
export function ancestry(db: Db, id: string | null | undefined): Collection[] {
  const chain: Collection[] = [];
  const seen = new Set<string>();
  let cur = id ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const row = db.select().from(collections).where(eq(collections.id, cur)).get();
    if (!row) break;
    chain.push(row);
    cur = row.parentId;
  }
  return chain;
}

export function rootOf(db: Db, id: string | null | undefined): Collection | null {
  const chain = ancestry(db, id);
  return chain[chain.length - 1] ?? null;
}

/** Walks `inherit` up the folder chain. */
export function effectiveAuth(db: Db, collectionId: string | null | undefined, auth: Auth): Auth {
  if (auth.type !== 'inherit') return auth;
  for (const c of ancestry(db, collectionId)) if (c.auth.type !== 'inherit') return c.auth;
  return { type: 'none' };
}
