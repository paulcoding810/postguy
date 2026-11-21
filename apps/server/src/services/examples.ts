import { asc, eq, max } from 'drizzle-orm';
import { resolveTemplate } from '@postguy/core';
import { CreateExampleInput, newId, type ExampleSummary, type ResponseExample } from '@postguy/shared';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { responseExamples } from '../db/schema.ts';
import { notFound } from '../lib/errors.ts';
import { buildContext } from './context.ts';
import { getRequest } from './requests.ts';

const MIN_SECRET_LENGTH = 4;

/** Secret variable values in scope for a request, longest first, with the names that hold them. */
function secretsFor(db: Db, requestId: string): [string, string][] {
  const saved = getRequest(db, requestId);
  const { ctx } = buildContext(db, { collectionId: saved.collectionId, requestId });
  const out: [string, string][] = [];
  for (const [key, v] of ctx.variables) {
    if (!v.secret) continue;
    const value = resolveTemplate(v.value, ctx).value;
    if (value.length >= MIN_SECRET_LENGTH) out.push([value, key]);
  }
  return out.sort((a, b) => b[0].length - a[0].length);
}

/** Replaces secret values with `{{name}}`, so an example never keeps a live credential. */
export function maskSecrets(text: string, secrets: [string, string][]): string {
  let out = text;
  for (const [value, key] of secrets) out = out.split(value).join(`{{${key}}}`);
  return out;
}

export function listExamples(db: Db, requestId: string): ExampleSummary[] {
  getRequest(db, requestId);
  return db
    .select()
    .from(responseExamples)
    .where(eq(responseExamples.requestId, requestId))
    .orderBy(asc(responseExamples.sortOrder), asc(responseExamples.createdAt))
    .all()
    .map(({ body, headers: _h, request: _r, ...rest }) => ({ ...rest, size: rest.bodyEncoding === 'base64' ? Math.floor((body.length * 3) / 4) : Buffer.byteLength(body) }));
}

export function getExample(db: Db, id: string): ResponseExample {
  const row = db.select().from(responseExamples).where(eq(responseExamples.id, id)).get();
  if (!row) throw notFound('Example');
  return row;
}

export function createExample(db: Db, requestId: string, input: z.output<typeof CreateExampleInput>, opts: { id?: string; mask?: boolean } = {}): ResponseExample {
  const secrets = opts.mask === false ? [] : secretsFor(db, requestId);
  const next = (db.select({ m: max(responseExamples.sortOrder) }).from(responseExamples).where(eq(responseExamples.requestId, requestId)).get()?.m ?? -1) + 1;
  const id = opts.id ?? newId();
  db.insert(responseExamples)
    .values({
      id,
      requestId,
      name: input.name,
      status: input.status,
      statusText: input.statusText,
      headers: Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k, maskSecrets(v, secrets)])),
      contentType: input.contentType,
      body: input.bodyEncoding === 'utf8' ? maskSecrets(input.body, secrets) : input.body,
      bodyEncoding: input.bodyEncoding,
      request: input.request,
      sortOrder: next,
    })
    .run();
  return getExample(db, id);
}

export function renameExample(db: Db, id: string, name: string): ResponseExample {
  getExample(db, id);
  db.update(responseExamples).set({ name, updatedAt: Date.now() }).where(eq(responseExamples.id, id)).run();
  return getExample(db, id);
}

export function deleteExample(db: Db, id: string): void {
  getExample(db, id);
  db.delete(responseExamples).where(eq(responseExamples.id, id)).run();
}

/** All of a request's examples, for copying or bringing back with it. */
export function examplesOf(db: Db, requestId: string): ResponseExample[] {
  return db.select().from(responseExamples).where(eq(responseExamples.requestId, requestId)).orderBy(asc(responseExamples.sortOrder)).all();
}

export function copyExamples(db: Db, list: ResponseExample[], requestId: string, keepIds = false) {
  for (const e of list) createExample(db, requestId, e, { mask: false, ...(keepIds && { id: e.id }) });
}
