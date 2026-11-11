import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { canonicalJson, extractPaths, inferSchema, mergeSchemas, validateJson, type ResponseRecord } from '@postguy/core';
import {
  newId,
  type EffectiveSchema,
  type JsonSchema,
  type ReferenceSource,
  type ResponseSnapshot,
  type SnapshotSummary,
  type ValidationResult,
} from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { requestHistory, requests, responseSchemas, responseSnapshots } from '../db/schema.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { rootOf, subtreeIds } from './collections.ts';
import { isJsonContent } from './http.ts';
import { operationForRequest } from './openapi.ts';
import { getRequest } from './requests.ts';

export const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const SNAPSHOTS_PER_REQUEST = 50;
const SOURCE_PATH_LIMIT = 400;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function parseJsonBody(contentType: string | null, body: string): { ok: true; value: unknown } | { ok: false } {
  if (body.length > SNAPSHOT_MAX_BYTES) return { ok: false };
  const looksJson = isJsonContent(contentType) || /^\s*[[{]/.test(body);
  if (!looksJson) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

export interface RecordInput {
  requestId: string;
  historyId: string;
  status: number;
  contentType: string | null;
  body: string;
}

/**
 * Stores a JSON response as a new snapshot (never overwriting older ones), links its
 * schema by content hash, and moves the latest-success pointer on 2xx.
 */
export function recordSnapshot(db: Db, input: RecordInput): string | null {
  const parsed = parseJsonBody(input.contentType, input.body);
  if (!parsed.ok) return null;
  const schema = inferSchema(parsed.value);
  const schemaHash = sha256(canonicalJson(schema));
  const now = Date.now();
  const id = newId();
  const isSuccess = input.status >= 200 && input.status < 300;

  db.transaction((tx) => {
    const existing = tx.select().from(responseSchemas).where(eq(responseSchemas.hash, schemaHash)).get();
    let schemaId = existing?.id;
    if (existing) {
      tx.update(responseSchemas)
        .set({ lastSeenAt: now, seenCount: existing.seenCount + 1 })
        .where(eq(responseSchemas.id, existing.id))
        .run();
    } else {
      schemaId = newId();
      tx.insert(responseSchemas).values({ id: schemaId, hash: schemaHash, schema, firstSeenAt: now, lastSeenAt: now, seenCount: 1 }).run();
    }
    tx.insert(responseSnapshots)
      .values({
        id,
        requestId: input.requestId,
        historyId: input.historyId,
        schemaId: schemaId!,
        status: input.status,
        isSuccess,
        body: JSON.stringify(parsed.value),
        contentHash: sha256(input.body),
        paths: extractPaths(parsed.value),
        createdAt: now,
      })
      .run();
    if (isSuccess) tx.update(requests).set({ latestSuccessSnapshotId: id }).where(eq(requests.id, input.requestId)).run();
    prune(tx as unknown as Db, input.requestId);
  });
  return id;
}

function prune(db: Db, requestId: string) {
  const req = db.select({ a: requests.latestSuccessSnapshotId, b: requests.pinnedSnapshotId }).from(requests).where(eq(requests.id, requestId)).get();
  const keep = [req?.a, req?.b].filter((x): x is string => !!x);
  const rows = db
    .select({ id: responseSnapshots.id })
    .from(responseSnapshots)
    .where(eq(responseSnapshots.requestId, requestId))
    .orderBy(desc(responseSnapshots.createdAt))
    .all();
  const stale = rows.slice(SNAPSHOTS_PER_REQUEST).map((r) => r.id).filter((id) => !keep.includes(id));
  if (stale.length) db.delete(responseSnapshots).where(inArray(responseSnapshots.id, stale)).run();
}

const summaryColumns = {
  id: responseSnapshots.id,
  requestId: responseSnapshots.requestId,
  historyId: responseSnapshots.historyId,
  schemaId: responseSnapshots.schemaId,
  status: responseSnapshots.status,
  isSuccess: responseSnapshots.isSuccess,
  contentHash: responseSnapshots.contentHash,
  createdAt: responseSnapshots.createdAt,
};

export function listSnapshots(db: Db, requestId: string): SnapshotSummary[] {
  getRequest(db, requestId);
  return db.select(summaryColumns).from(responseSnapshots).where(eq(responseSnapshots.requestId, requestId)).orderBy(desc(responseSnapshots.createdAt)).all();
}

export function getSnapshot(db: Db, id: string): ResponseSnapshot {
  const row = db.select().from(responseSnapshots).where(eq(responseSnapshots.id, id)).get();
  if (!row) throw notFound('Snapshot');
  return { ...row, body: JSON.parse(row.body) };
}

export function pinSnapshot(db: Db, requestId: string, snapshotId: string | null) {
  getRequest(db, requestId);
  if (snapshotId) {
    const snap = db.select({ requestId: responseSnapshots.requestId }).from(responseSnapshots).where(eq(responseSnapshots.id, snapshotId)).get();
    if (!snap || snap.requestId !== requestId) throw badRequest('Snapshot does not belong to this request');
  }
  db.update(requests).set({ pinnedSnapshotId: snapshotId }).where(eq(requests.id, requestId)).run();
  return getRequest(db, requestId);
}

/** Merged schema over the latest successful snapshots; derived on demand, never stored. */
export function effectiveSchema(db: Db, requestId: string): EffectiveSchema {
  getRequest(db, requestId);
  const rows = db
    .select({ schema: responseSchemas.schema })
    .from(responseSnapshots)
    .innerJoin(responseSchemas, eq(responseSnapshots.schemaId, responseSchemas.id))
    .where(and(eq(responseSnapshots.requestId, requestId), eq(responseSnapshots.isSuccess, true)))
    .orderBy(desc(responseSnapshots.createdAt))
    .limit(20)
    .all();
  const inferred = rows.length ? rows.map((r) => r.schema).reduce((a, b) => mergeSchemas(a, b)) : null;
  const op = operationForRequest(db, requestId);
  const expected = (op?.operation.responses ?? [])
    .filter((r): r is typeof r & { schema: JsonSchema } => !!r.schema)
    .map((r) => ({ status: r.status, schema: r.schema }));
  return { requestId, inferred, snapshotCount: rows.length, expected };
}

/** Validates against the imported OpenAPI response schema for this status, if any. */
export function validateResponse(db: Db, requestId: string, status: number, contentType: string | null, body: string): ValidationResult | null {
  const op = operationForRequest(db, requestId);
  if (!op) return null;
  const s = String(status);
  const responses = op.operation.responses;
  const match =
    responses.find((r) => r.status === s) ??
    responses.find((r) => r.status.toUpperCase() === `${s[0]}XX`) ??
    responses.find((r) => r.status === 'default');
  if (!match?.schema) return null;
  const parsed = parseJsonBody(contentType, body);
  if (!parsed.ok) return { ok: false, schemaSource: `${op.operation.id} ${match.status}`, errors: [{ path: '(root)', message: 'Response is not valid JSON' }] };
  const errors = validateJson(match.schema, parsed.value);
  if (errors === null) return null;
  return { ok: errors.length === 0, schemaSource: `${op.operation.id} ${match.status}`, errors };
}

interface Candidate {
  id: string;
  name: string;
  method: string;
  collectionId: string;
  latestSuccessSnapshotId: string | null;
  pinnedSnapshotId: string | null;
}

function candidates(db: Db, collectionId: string | null | undefined): Candidate[] {
  const cols = {
    id: requests.id,
    name: requests.name,
    method: requests.method,
    collectionId: requests.collectionId,
    latestSuccessSnapshotId: requests.latestSuccessSnapshotId,
    pinnedSnapshotId: requests.pinnedSnapshotId,
  };
  const root = rootOf(db, collectionId);
  const scope = root ? subtreeIds(db, root.id) : [];
  const local = scope.length ? db.select(cols).from(requests).where(inArray(requests.collectionId, scope)).orderBy(asc(requests.sortOrder)).all() : [];
  const others = db
    .select(cols)
    .from(requests)
    .where(scope.length ? notInArray(requests.collectionId, scope) : undefined)
    .orderBy(asc(requests.createdAt))
    .all();
  return [...local, ...others];
}

/**
 * Response lookup for template resolution outside a flow: matches a request by name
 * (same collection first) and uses its pinned snapshot, else its latest successful one.
 */
export function snapshotLookup(db: Db, collectionId: string | null | undefined): (name: string) => ResponseRecord | undefined {
  let list: Candidate[] | null = null;
  const memo = new Map<string, ResponseRecord | undefined>();
  return (name) => {
    if (memo.has(name)) return memo.get(name);
    list ??= candidates(db, collectionId).filter((c) => c.pinnedSnapshotId || c.latestSuccessSnapshotId);
    const lower = name.toLowerCase();
    const hit = list.find((c) => c.name === name) ?? list.find((c) => c.name.toLowerCase() === lower);
    let record: ResponseRecord | undefined;
    if (hit) {
      const snapId = hit.pinnedSnapshotId ?? hit.latestSuccessSnapshotId!;
      const snap = db.select().from(responseSnapshots).where(eq(responseSnapshots.id, snapId)).get();
      if (snap) {
        const hist = snap.historyId
          ? db.select({ headers: requestHistory.responseHeaders }).from(requestHistory).where(eq(requestHistory.id, snap.historyId)).get()
          : undefined;
        record = {
          name: hit.name,
          status: snap.status,
          headers: hist?.headers ?? {},
          body: JSON.parse(snap.body),
          source: 'snapshot',
          snapshotId: snap.id,
          requestId: hit.id,
        };
      }
    }
    memo.set(name, record);
    return record;
  };
}

export function referenceSources(db: Db, collectionId: string | null | undefined): ReferenceSource[] {
  const list = candidates(db, collectionId).filter((c) => c.pinnedSnapshotId || c.latestSuccessSnapshotId);
  const seen = new Set<string>();
  const out: ReferenceSource[] = [];
  for (const c of list) {
    const snapId = c.pinnedSnapshotId ?? c.latestSuccessSnapshotId!;
    const row = db.select({ ...summaryColumns, paths: responseSnapshots.paths }).from(responseSnapshots).where(eq(responseSnapshots.id, snapId)).get();
    const { paths, ...snapshot } = row ?? { paths: [] };
    out.push({
      requestId: c.id,
      name: c.name,
      method: c.method,
      collectionId: c.collectionId,
      snapshot: row ? (snapshot as SnapshotSummary) : null,
      pinned: !!c.pinnedSnapshotId,
      shadowed: seen.has(c.name.toLowerCase()),
      paths: (paths ?? []).slice(0, SOURCE_PATH_LIMIT),
    });
    seen.add(c.name.toLowerCase());
  }
  return out;
}
