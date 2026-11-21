import { AsyncLocalStorage } from 'node:async_hooks';
import { and, desc, eq, lt, notInArray } from 'drizzle-orm';
import { newId, type ResponseExample } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { changeLog, collections, flowSteps, requests, variables } from '../db/schema.ts';
import { examplesOf } from './examples.ts';
import { loadScripts } from './scripts.ts';

/** 'restore' is internal: a restore records one entry itself, not one per object it brings back. */
export type ChangeSource = 'app' | 'api' | 'mcp' | 'sync' | 'import' | 'script' | 'restore';

const context = new AsyncLocalStorage<{ source: ChangeSource }>();

/** Runs `fn` with changes attributed to `source` (the desktop app, Claude, a sync…). */
export function withSource<T>(source: ChangeSource, fn: () => T): T {
  return context.run({ source }, fn);
}

export function currentSource(): ChangeSource {
  return context.getStore()?.source ?? 'api';
}

const KEEP_ENTRIES = 200;
const KEEP_MS = 90 * 24 * 3600_000;
/** Edits to the same thing from the same source this close together become one entry. */
const MERGE_MS = 60_000;
/** Bookkeeping fields that never make a change worth recording. */
const VOLATILE = ['sortOrder', 'updatedAt', 'createdAt', 'latestSuccessSnapshotId', 'pinnedSnapshotId'];

type Vars = { key: string; value: string; isSecret: boolean; enabled: boolean }[];

export interface RequestSnapshot {
  request: Record<string, unknown> & { id: string; name: string; collectionId: string };
  scripts: { pre: string; post: string };
  variables: Vars;
  /** Flow steps that used the request, relinked when it is restored. */
  flowSteps?: { flowId: string; stepId: string }[];
  /** Saved examples, kept on deletions so they come back with the request. */
  examples?: ResponseExample[];
}

export interface CollectionSnapshot {
  collection: Record<string, unknown> & { id: string; name: string; parentId: string | null };
  scripts: { pre: string; post: string };
  variables: Vars;
  /** Present on deletions: the whole subtree, so it can be brought back. */
  folders?: CollectionSnapshot[];
  requests?: RequestSnapshot[];
}

function vars(db: Db, scope: 'request' | 'collection', ownerId: string): Vars {
  return db
    .select()
    .from(variables)
    .where(and(eq(variables.scope, scope), eq(variables.ownerId, ownerId)))
    .orderBy(variables.sortOrder)
    .all()
    .map((v) => ({ key: v.key, value: v.value, isSecret: v.isSecret, enabled: v.enabled }));
}

export function requestSnapshot(db: Db, id: string, withFlows = false): RequestSnapshot | null {
  const row = db.select().from(requests).where(eq(requests.id, id)).get();
  if (!row) return null;
  return {
    request: row as RequestSnapshot['request'],
    scripts: loadScripts(db, 'request', id),
    variables: vars(db, 'request', id),
    ...(withFlows && {
      flowSteps: db.select({ flowId: flowSteps.flowId, stepId: flowSteps.id }).from(flowSteps).where(eq(flowSteps.requestId, id)).all(),
      examples: examplesOf(db, id),
    }),
  };
}

export function collectionSnapshot(db: Db, id: string, subtree = false): CollectionSnapshot | null {
  const row = db.select().from(collections).where(eq(collections.id, id)).get();
  if (!row) return null;
  const snap: CollectionSnapshot = { collection: row as CollectionSnapshot['collection'], scripts: loadScripts(db, 'collection', id), variables: vars(db, 'collection', id) };
  if (!subtree) return snap;
  const childIds = db.select({ id: collections.id }).from(collections).where(eq(collections.parentId, id)).orderBy(collections.sortOrder).all();
  const reqIds = db.select({ id: requests.id }).from(requests).where(eq(requests.collectionId, id)).orderBy(requests.sortOrder).all();
  return {
    ...snap,
    folders: childIds.map((c) => collectionSnapshot(db, c.id, true)!).filter(Boolean),
    requests: reqIds.map((r) => requestSnapshot(db, r.id, true)!).filter(Boolean),
  };
}

export function variablesSnapshot(db: Db, collectionId: string): Vars {
  return vars(db, 'collection', collectionId);
}

/** The top-level collection a collection or folder belongs to (itself when it is one). */
export function rootIdOf(db: Db, collectionId: string): string {
  let id = collectionId;
  for (let i = 0; i < 100; i++) {
    const row = db.select({ parentId: collections.parentId }).from(collections).where(eq(collections.id, id)).get();
    if (!row?.parentId) return id;
    id = row.parentId;
  }
  return id;
}

function comparable(value: unknown): string {
  return JSON.stringify(value, (k, v) => (VOLATILE.includes(k) ? undefined : v));
}

export interface ChangeInput {
  rootId: string;
  entityType: 'request' | 'collection' | 'variables';
  entityId: string;
  label: string;
  action: 'create' | 'update' | 'delete';
  before: unknown;
  after: unknown;
}

/**
 * Records a change unless it is noise: script-made variable values, the parts of an import
 * other than its top-level collection, and saves that change nothing but bookkeeping fields.
 */
export function recordChange(db: Db, input: ChangeInput) {
  const source = currentSource();
  if (source === 'script' || source === 'restore') return;
  if (source === 'import' && !(input.entityType === 'collection' && input.action === 'create' && input.rootId === input.entityId)) return;
  if (input.action === 'update' && comparable(input.before) === comparable(input.after)) return;
  const now = Date.now();
  if (input.action === 'update') {
    const last = db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.entityId, input.entityId), eq(changeLog.entityType, input.entityType)))
      .orderBy(desc(changeLog.updatedAt))
      .get();
    if (last && last.action === 'update' && last.source === source && now - last.updatedAt < MERGE_MS) {
      if (comparable(last.before) === comparable(input.after)) db.delete(changeLog).where(eq(changeLog.id, last.id)).run();
      else db.update(changeLog).set({ after: input.after, label: input.label, rootId: input.rootId, updatedAt: now }).where(eq(changeLog.id, last.id)).run();
      return;
    }
  }
  db.insert(changeLog).values({ id: newId(), ...input, source, createdAt: now, updatedAt: now }).run();
  prune(db, input.rootId);
}

function prune(db: Db, rootId: string) {
  const keep = db.select({ id: changeLog.id }).from(changeLog).where(eq(changeLog.rootId, rootId)).orderBy(desc(changeLog.updatedAt)).limit(KEEP_ENTRIES).all().map((r) => r.id);
  if (keep.length === KEEP_ENTRIES) db.delete(changeLog).where(and(eq(changeLog.rootId, rootId), notInArray(changeLog.id, keep))).run();
  db.delete(changeLog).where(lt(changeLog.updatedAt, Date.now() - KEEP_MS)).run();
}

export function listChanges(db: Db, rootId: string, opts: { entityId?: string; limit?: number } = {}) {
  return db
    .select()
    .from(changeLog)
    .where(opts.entityId ? and(eq(changeLog.rootId, rootId), eq(changeLog.entityId, opts.entityId)) : eq(changeLog.rootId, rootId))
    .orderBy(desc(changeLog.updatedAt))
    .limit(opts.limit ?? KEEP_ENTRIES)
    .all();
}

/** Top-level collections that were deleted and are not back, newest first. */
export function deletedCollections(db: Db) {
  const existing = new Set(db.select({ id: collections.id }).from(collections).all().map((c) => c.id));
  return db
    .select()
    .from(changeLog)
    .where(and(eq(changeLog.entityType, 'collection'), eq(changeLog.action, 'delete')))
    .orderBy(desc(changeLog.updatedAt))
    .all()
    .filter((c) => c.rootId === c.entityId && !existing.has(c.entityId));
}

export function getChange(db: Db, id: string) {
  return db.select().from(changeLog).where(eq(changeLog.id, id)).get();
}

