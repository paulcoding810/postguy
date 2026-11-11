import { createHash } from 'node:crypto';
import axios from 'axios';
import { desc, eq } from 'drizzle-orm';
import { stringify as toYaml } from 'yaml';
import {
  collectionToOpenApi,
  generateCollection,
  loadSpec,
  normalizeSpec,
  SpecError,
  type GeneratedRequest,
} from '@postguy/core';
import {
  newId,
  OpenApiImportInput,
  type ApiModel,
  type OpenApiImportResult,
  type OpenApiOperation,
  type OpenApiSpec,
  type OpenApiSpecDetail,
} from '@postguy/shared';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { collections, openapiSpecs, openapiVersions } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { createCollection, rootOf } from './collections.ts';
import { createRequest, getRequest } from './requests.ts';
import { exportCollection } from './transfer.ts';
import { replaceVariables } from './variables.ts';

const MAX_SPEC_BYTES = 15 * 1024 * 1024;

async function fetchSpec(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest('Invalid URL');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw badRequest('Only http and https URLs are supported');
  try {
    const res = await axios.get<string>(url, {
      responseType: 'text',
      transformResponse: (d) => d,
      timeout: 15_000,
      maxContentLength: MAX_SPEC_BYTES,
      maxRedirects: 5,
      headers: { Accept: 'application/json, application/yaml, text/yaml, */*' },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return res.data;
  } catch (e) {
    throw new HttpError(502, `Could not download specification: ${(e as Error).message}`, 'fetch_failed');
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function importOpenApi(db: Db, input: z.output<typeof OpenApiImportInput>): Promise<OpenApiImportResult> {
  let text: string;
  if (input.sourceType === 'url') {
    if (!input.url) throw badRequest('url is required');
    text = await fetchSpec(input.url);
  } else {
    if (!input.content?.trim()) throw badRequest('content is required');
    if (input.content.length > MAX_SPEC_BYTES) throw badRequest('Specification is too large');
    text = input.content;
  }

  let loaded: Awaited<ReturnType<typeof loadSpec>>;
  try {
    loaded = await loadSpec(text);
  } catch (e) {
    if (e instanceof SpecError) throw new HttpError(422, e.message, 'invalid_spec');
    throw e;
  }
  const model = normalizeSpec(loaded.dereferenced, loaded.specVersion);
  const generated = generateCollection(model);
  const now = Date.now();
  let count = 0;
  let spec!: OpenApiSpec;
  let collectionId = '';

  db.transaction(() => {
    const specId = newId();
    const root = createCollection(db, {
      name: input.name?.trim() || generated.name,
      parentId: null,
      description: generated.description,
      auth: generated.auth,
      openapiSpecId: specId,
    });
    collectionId = root.id;
    replaceVariables(db, 'collection', root.id, generated.variables.map((v) => ({ ...v, enabled: true })));
    const add = (collectionId: string, r: GeneratedRequest) => {
      createRequest(
        db,
        { ...r.def, collectionId, description: r.description },
        { openapiOperationId: r.operationId, openapiFingerprint: r.fingerprint },
      );
      count++;
    };
    for (const f of generated.folders) {
      const folder = createCollection(db, { name: f.name, parentId: root.id, description: f.description });
      f.requests.forEach((r) => add(folder.id, r));
    }
    generated.requests.forEach((r) => add(root.id, r));

    const versionId = newId();
    spec = {
      id: specId,
      collectionId: root.id,
      name: model.title,
      sourceType: input.sourceType,
      sourceUrl: input.sourceType === 'url' ? (input.url ?? null) : null,
      currentVersionId: versionId,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(openapiSpecs).values(spec).run();
    db.insert(openapiVersions)
      .values({ id: versionId, specId, label: model.version || '1', rawText: text, model, hash: sha256(text), importedAt: now })
      .run();
  });

  return { spec, collectionId, requestCount: count, warnings: loaded.warnings };
}

export function listSpecs(db: Db): OpenApiSpec[] {
  return db.select().from(openapiSpecs).orderBy(desc(openapiSpecs.createdAt)).all();
}

function currentModel(db: Db, spec: OpenApiSpec): ApiModel | null {
  if (!spec.currentVersionId) return null;
  const v = db.select({ model: openapiVersions.model }).from(openapiVersions).where(eq(openapiVersions.id, spec.currentVersionId)).get();
  return (v?.model as ApiModel | undefined) ?? null;
}

export function getSpec(db: Db, id: string): OpenApiSpecDetail {
  const spec = db.select().from(openapiSpecs).where(eq(openapiSpecs.id, id)).get();
  if (!spec) throw notFound('Specification');
  const versions = db
    .select({ id: openapiVersions.id, specId: openapiVersions.specId, label: openapiVersions.label, hash: openapiVersions.hash, importedAt: openapiVersions.importedAt })
    .from(openapiVersions)
    .where(eq(openapiVersions.specId, id))
    .orderBy(desc(openapiVersions.importedAt))
    .all();
  return { ...spec, model: currentModel(db, spec), versions };
}

/** Removes the spec record; the generated collection is kept as a normal collection. */
export function deleteSpec(db: Db, id: string): void {
  const spec = db.select().from(openapiSpecs).where(eq(openapiSpecs.id, id)).get();
  if (!spec) throw notFound('Specification');
  db.transaction((tx) => {
    tx.update(collections).set({ openapiSpecId: null }).where(eq(collections.id, spec.collectionId)).run();
    tx.delete(openapiSpecs).where(eq(openapiSpecs.id, id)).run();
  });
}

export function operationForRequest(
  db: Db,
  requestId: string,
): { model: Pick<ApiModel, 'title' | 'version'>; operation: OpenApiOperation } | null {
  const req = getRequest(db, requestId);
  if (!req.openapiOperationId) return null;
  const root = rootOf(db, req.collectionId);
  if (!root?.openapiSpecId) return null;
  const spec = db.select().from(openapiSpecs).where(eq(openapiSpecs.id, root.openapiSpecId)).get();
  if (!spec) return null;
  const model = currentModel(db, spec);
  const operation = model?.operations.find((o) => o.id === req.openapiOperationId);
  return model && operation ? { model: { title: model.title, version: model.version }, operation } : null;
}

export function exportOpenApi(db: Db, collectionId: string, format: 'json' | 'yaml'): string {
  const doc = collectionToOpenApi(exportCollection(db, collectionId).collection);
  return format === 'yaml' ? toYaml(doc) : JSON.stringify(doc, null, 2);
}
