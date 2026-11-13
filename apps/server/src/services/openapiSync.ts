import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  collectionSchemeOf,
  diffSpecs,
  fingerprintRequest,
  loadSpec,
  mergeOperation,
  normalizeSpec,
  operationKey,
  requestFromOperation,
  SpecError,
  type SpecDiff,
} from '@postguy/core';
import { newId, SyncInput, type ApiModel, type OpenApiOperation, type RequestDefinition, type SpecDiffSummary, type SyncPlan, type SyncResult } from '@postguy/shared';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { collections, openapiSpecs, openapiVersions, requests } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { createCollection, rootOf, subtreeIds } from './collections.ts';
import { fetchSpec } from './openapi.ts';
import { createRequest, getRequest, updateRequest } from './requests.ts';
import { listVariables, setVariable } from './variables.ts';

function sha256(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

const summary = (o: OpenApiOperation) => ({ id: o.id, method: o.method, path: o.path, summary: o.summary });

export function summarizeDiff(d: SpecDiff): SpecDiffSummary {
  return {
    added: d.added.map(summary),
    removed: d.removed.map(summary),
    changed: d.changed.map((c) => ({ ...summary(c.after), changes: c.changes })),
    unchanged: d.unchanged,
    servers: d.servers,
    info: d.info,
  };
}

function specRow(db: Db, id: string) {
  const spec = db.select().from(openapiSpecs).where(eq(openapiSpecs.id, id)).get();
  if (!spec) throw notFound('Specification');
  return spec;
}

function versionModel(db: Db, versionId: string | null): { model: ApiModel; hash: string; label: string } {
  const v = versionId ? db.select().from(openapiVersions).where(eq(openapiVersions.id, versionId)).get() : undefined;
  if (!v) throw notFound('Specification version');
  return { model: v.model as ApiModel, hash: v.hash, label: v.label };
}

function definitionOf(r: ReturnType<typeof getRequest>): RequestDefinition {
  return { name: r.name, method: r.method, url: r.url, params: r.params, pathParams: r.pathParams, headers: r.headers, auth: r.auth, body: r.body, settings: r.settings, scripts: r.scripts };
}

interface Prepared {
  spec: ReturnType<typeof specRow>;
  text: string;
  hash: string;
  current: { model: ApiModel; hash: string; label: string };
  next: ApiModel;
  diff: SpecDiff;
  warnings: string[];
}

async function prepare(db: Db, specId: string, input: z.output<typeof SyncInput>): Promise<Prepared> {
  const spec = specRow(db, specId);
  let text: string;
  if (input.content?.trim()) text = input.content;
  else {
    const url = input.url ?? spec.sourceUrl;
    if (!url) throw badRequest('Provide the new specification: this spec was not imported from a URL');
    text = await fetchSpec(url);
  }
  let loaded: Awaited<ReturnType<typeof loadSpec>>;
  try {
    loaded = await loadSpec(text);
  } catch (e) {
    if (e instanceof SpecError) throw new HttpError(422, e.message, 'invalid_spec');
    throw e;
  }
  const next = normalizeSpec(loaded.dereferenced, loaded.specVersion);
  const current = versionModel(db, spec.currentVersionId);
  return { spec, text, hash: sha256(text), current, next, diff: diffSpecs(current.model, next), warnings: loaded.warnings };
}

function plan(db: Db, p: Prepared): SyncPlan {
  const root = p.spec.collectionId;
  const ids = subtreeIds(db, root);
  const linked = db
    .select({ id: requests.id })
    .from(requests)
    .where(and(inArray(requests.collectionId, ids), isNotNull(requests.openapiOperationId)))
    .orderBy(asc(requests.sortOrder))
    .all()
    .map((r) => getRequest(db, r.id));
  const oldById = new Map(p.current.model.operations.map((o) => [o.id, o]));
  const newById = new Map(p.next.operations.map((o) => [o.id, o]));
  const newByKey = new Map(p.next.operations.map((o) => [operationKey(o), o]));
  const changedByKey = new Map(p.diff.changed.map((c) => [c.key, c]));
  const scheme = collectionSchemeOf(p.next);
  const seenKeys = new Set<string>();
  const out: SyncPlan['requests'] = [];

  for (const r of linked) {
    const old = oldById.get(r.openapiOperationId!);
    const oldKey = old ? operationKey(old) : null;
    const op = old ? (newById.get(old.id) ?? newByKey.get(oldKey!)) : undefined;
    if (!op) {
      out.push({ requestId: r.id, name: r.name, operation: oldKey ?? r.openapiOperationId!, label: old ? `${old.method} ${old.path}` : r.openapiOperationId!, action: 'orphaned' });
      continue;
    }
    const key = operationKey(op);
    seenKeys.add(key);
    const change = changedByKey.get(key);
    if (!change) {
      out.push({ requestId: r.id, name: r.name, operation: key, label: `${op.method} ${op.path}`, action: 'unchanged' });
      continue;
    }
    const moved = !!change.moved;
    const edited = fingerprintRequest(definitionOf(r)) !== r.openapiFingerprint;
    const base = { requestId: r.id, name: r.name, operation: key, label: `${op.method} ${op.path}`, changes: change.changes, ...(moved && { moved }) };
    if (!edited) {
      out.push({ ...base, action: 'update' });
      continue;
    }
    const merge = mergeOperation(definitionOf(r), op, requestFromOperation(op, p.next, scheme), { followPath: moved });
    out.push(merge.added.length ? { ...base, action: 'merge-edited', adds: merge.added } : { ...base, action: 'keep-edited' });
  }
  for (const op of p.next.operations) {
    const key = operationKey(op);
    if (!seenKeys.has(key) && !p.current.model.operations.some((o) => operationKey(o) === key))
      out.push({ requestId: null, name: requestFromOperation(op, p.next, scheme).def.name, operation: key, label: `${op.method} ${op.path}`, action: 'create' });
  }
  return {
    upToDate: p.hash === p.current.hash,
    fromVersion: p.current.label,
    toVersion: p.next.version || '?',
    diff: summarizeDiff(p.diff),
    requests: out,
    warnings: p.warnings,
  };
}

export async function previewSync(db: Db, specId: string, input: z.output<typeof SyncInput>): Promise<SyncPlan> {
  return plan(db, await prepare(db, specId, input));
}

/**
 * Applies a new spec version: creates requests for new operations, regenerates requests
 * nobody edited since import, adds new required params to edited ones (and follows moved
 * paths) while keeping their edits, and leaves requests whose operation was removed in place.
 * Merged requests keep their old fingerprint, so later syncs still treat them as edited.
 */
export async function applySync(db: Db, specId: string, input: z.output<typeof SyncInput>): Promise<SyncResult> {
  const p = await prepare(db, specId, input);
  const result = plan(db, p);
  if (result.upToDate) return { ...result, versionId: null };
  const scheme = collectionSchemeOf(p.next);
  const newByKey = new Map(p.next.operations.map((o) => [operationKey(o), o]));
  const root = p.spec.collectionId;
  const versionId = newId();

  db.transaction(() => {
    const folders = new Map(
      db.select().from(collections).where(eq(collections.parentId, root)).all().map((c) => [c.name, c.id]),
    );
    const folderFor = (op: OpenApiOperation) => {
      const tag = op.tags[0];
      if (!tag) return root;
      if (!folders.has(tag)) {
        const f = createCollection(db, { name: tag, parentId: root, description: p.next.tags.find((t) => t.name === tag)?.description ?? null });
        folders.set(tag, f.id);
      }
      return folders.get(tag)!;
    };

    for (const item of result.requests) {
      const op = newByKey.get(item.operation);
      if (!op) continue;
      const gen = requestFromOperation(op, p.next, scheme);
      if (item.action === 'create') {
        createRequest(db, { ...gen.def, collectionId: folderFor(op), description: gen.description }, { openapiOperationId: op.id, openapiFingerprint: gen.fingerprint });
      } else if (item.action === 'update' && item.requestId) {
        db.update(requests)
          .set({
            name: gen.def.name,
            description: gen.description,
            method: gen.def.method,
            url: gen.def.url,
            params: gen.def.params,
            pathParams: gen.def.pathParams,
            headers: gen.def.headers,
            auth: gen.def.auth,
            body: gen.def.body,
            openapiOperationId: op.id,
            openapiFingerprint: gen.fingerprint,
            updatedAt: Date.now(),
          })
          .where(eq(requests.id, item.requestId))
          .run();
      } else if (item.action === 'merge-edited' && item.requestId) {
        const saved = getRequest(db, item.requestId);
        const merged = mergeOperation(definitionOf(saved), op, gen, { followPath: !!item.moved }).def;
        db.update(requests)
          .set({
            method: merged.method,
            url: merged.url,
            params: merged.params,
            pathParams: merged.pathParams,
            headers: merged.headers,
            openapiOperationId: op.id,
            updatedAt: Date.now(),
          })
          .where(eq(requests.id, item.requestId))
          .run();
      } else if (item.requestId && (item.action === 'unchanged' || item.action === 'keep-edited')) {
        db.update(requests).set({ openapiOperationId: op.id }).where(eq(requests.id, item.requestId)).run();
      }
    }

    if (p.diff.servers) {
      const oldUrl = p.current.model.servers[0]?.url;
      const newUrl = p.next.servers[0]?.url;
      const baseUrl = listVariables(db, 'collection', root, true).find((v) => v.key === 'baseUrl');
      if (newUrl && baseUrl && baseUrl.value === oldUrl) setVariable(db, 'collection', root, 'baseUrl', newUrl);
    }

    db.insert(openapiVersions)
      .values({ id: versionId, specId, label: p.next.version || '?', rawText: p.text, model: p.next, hash: p.hash, importedAt: Date.now() })
      .run();
    db.update(openapiSpecs).set({ currentVersionId: versionId, name: p.next.title, updatedAt: Date.now() }).where(eq(openapiSpecs.id, specId)).run();
  });

  return { ...result, versionId };
}

export function compareVersions(db: Db, specId: string, from: string, to: string): SpecDiffSummary {
  specRow(db, specId);
  const a = db.select().from(openapiVersions).where(and(eq(openapiVersions.id, from), eq(openapiVersions.specId, specId))).get();
  const b = db.select().from(openapiVersions).where(and(eq(openapiVersions.id, to), eq(openapiVersions.specId, specId))).get();
  if (!a || !b) throw notFound('Specification version');
  return summarizeDiff(diffSpecs(a.model as ApiModel, b.model as ApiModel));
}

/** Adds the required query params and headers of a request's operation that the request lacks. */
export function specMerge(db: Db, requestId: string, apply: boolean) {
  const r = getRequest(db, requestId);
  const root = r.openapiOperationId ? rootOf(db, r.collectionId) : null;
  const spec = root?.openapiSpecId ? db.select().from(openapiSpecs).where(eq(openapiSpecs.id, root.openapiSpecId)).get() : undefined;
  if (!spec?.currentVersionId) return null;
  const { model } = versionModel(db, spec.currentVersionId);
  const op = model.operations.find((o) => o.id === r.openapiOperationId);
  if (!op) return null;
  const merge = mergeOperation(definitionOf(r), op, requestFromOperation(op, model, collectionSchemeOf(model)), { followPath: false });
  if (!apply) return { added: merge.added, request: r };
  if (!merge.added.length) return { added: [], request: r };
  return { added: merge.added, request: updateRequest(db, r.id, { params: merge.def.params, headers: merge.def.headers }) };
}
