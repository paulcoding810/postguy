import { asc, eq, inArray } from 'drizzle-orm';
import { compatibilityWarnings, isPostmanCollection, postmanDroppedScripts, postmanToCollection, redactAuth } from '@postguy/core';
import {
  Auth,
  RequestDefinition,
  type Collection,
  type CollectionExport,
  type ExportedCollection,
  type ExportedFlow,
  FlowConnectionInput,
  FlowGraphInput,
  FlowSettings,
  FlowStepInput,
} from '@postguy/shared';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { collections, requests } from '../db/schema.ts';
import { badRequest } from '../lib/errors.ts';
import { createCollection, getCollection, subtreeIds } from './collections.ts';
import { createFlow, getFlow, listFlows, saveGraph, updateFlow } from './flows.ts';
import { createRequest } from './requests.ts';
import { loadScripts } from './scripts.ts';
import { listVariables, replaceVariables } from './variables.ts';

export function exportCollection(db: Db, id: string): CollectionExport {
  const collection = exportNode(db, getCollection(db, id));
  const flows = exportFlows(db, id);
  return { format: 'postguy-collection', version: 1, collection: flows.length ? { ...collection, flows } : collection };
}

/** Flows created from this collection, or whose request steps all use its requests. */
function exportFlows(db: Db, rootId: string): ExportedFlow[] {
  const folderIds = new Set(subtreeIds(db, rootId));
  const requestIds = new Set(db.select({ id: requests.id }).from(requests).where(inArray(requests.collectionId, [...folderIds])).all().map((r) => r.id));
  return listFlows(db)
    .map((f) => getFlow(db, f.id))
    .filter((f) => {
      const used = f.steps.filter((s) => s.requestId).map((s) => s.requestId!);
      return (f.collectionId && folderIds.has(f.collectionId)) || (used.length > 0 && used.every((r) => requestIds.has(r)));
    })
    .map((f) => ({
      name: f.name,
      description: f.description,
      settings: f.settings,
      variables: listVariables(db, 'flow', f.id, true).map((v) => ({ key: v.key, value: v.isSecret ? '' : v.value, isSecret: v.isSecret })),
      steps: f.steps.map(({ requestId, ...s }) => ({
        ...s,
        overrides: s.overrides.auth ? { ...s.overrides, auth: redactAuth(s.overrides.auth) } : s.overrides,
        requestRef: requestId && requestIds.has(requestId) ? requestId : null,
      })),
      connections: f.connections,
    }));
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
      ref: r.id,
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
    requests: z.array(RequestDefinition.extend({ description: z.string().nullable().default(null), ref: z.string().optional() })).default([]),
    flows: z
      .array(
        z.object({
          name: z.string().min(1),
          description: z.string().nullable().default(null),
          settings: FlowSettings.default({ stopOnError: true }),
          variables: z.array(z.object({ key: z.string(), value: z.string(), isSecret: z.boolean().default(false) })).default([]),
          steps: z.array(FlowStepInput.omit({ requestId: true }).extend({ requestRef: z.string().nullable().default(null) })).default([]),
          connections: z.array(FlowConnectionInput).default([]),
        }),
      )
      .optional(),
  }),
) as z.ZodType<ExportedCollection>;

const ExportSchema = z.object({
  format: z.literal('postguy-collection'),
  version: z.literal(1),
  collection: ExportedCollectionSchema,
});

/** Imports a Postguy export or a Postman v2.0/v2.1 collection. */
export function importCollection(db: Db, data: unknown): { root: Collection; warnings: string[] } {
  const postman = isPostmanCollection(data);
  const parsed = ExportSchema.safeParse(postman ? postmanToCollection(data) : data);
  if (!parsed.success) throw badRequest('Not a Postguy or Postman collection', parsed.error.issues.slice(0, 5));
  let root: Collection | null = null;
  const refs = new Map<string, string>();
  const flowWarnings: string[] = [];
  db.transaction(() => {
    root = importNode(db, parsed.data.collection, null, refs);
    for (const f of parsed.data.collection.flows ?? []) flowWarnings.push(...importFlow(db, f, root.id, refs));
  });
  const warnings = [...flowWarnings, ...(postman ? postmanDroppedScripts(data) : []), ...compatibilityWarnings(parsed.data.collection as ExportedCollection)];
  return { root: root!, warnings };
}

function importNode(db: Db, node: ExportedCollection, parentId: string | null, refs: Map<string, string>): Collection {
  const c = createCollection(db, { name: node.name, parentId, description: node.description, auth: node.auth });
  if (node.variables.length) replaceVariables(db, 'collection', c.id, node.variables.map((v) => ({ ...v, enabled: true })));
  for (const r of node.requests) {
    const saved = createRequest(db, { ...RequestDefinition.parse(r), description: r.description, collectionId: c.id });
    if (r.ref) refs.set(r.ref, saved.id);
  }
  for (const f of node.folders) importNode(db, f, c.id, refs);
  return c;
}

function importFlow(db: Db, f: ExportedFlow, collectionId: string, refs: Map<string, string>): string[] {
  const flow = createFlow(db, { name: f.name, description: f.description, collectionId });
  updateFlow(db, flow.id, { settings: f.settings });
  const lost = f.steps.filter((s) => s.kind === 'request' && (!s.requestRef || !refs.has(s.requestRef))).map((s) => s.name);
  const steps = f.steps.map(({ requestRef, ...s }) => ({ ...s, requestId: requestRef ? (refs.get(requestRef) ?? null) : null }));
  saveGraph(db, flow.id, FlowGraphInput.parse({ steps, connections: f.connections }));
  if (f.variables.length) replaceVariables(db, 'flow', flow.id, f.variables.map((v) => ({ ...v, enabled: true })));
  return lost.length ? [`Flow "${f.name}": ${lost.map((n) => `"${n}"`).join(', ')} used requests outside the collection; pick a request for ${lost.length > 1 ? 'them' : 'it'} again.`] : [];
}
