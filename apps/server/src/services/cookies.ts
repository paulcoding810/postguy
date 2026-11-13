import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';
import { cookieFromSetCookie, cookieHeader, cookiesForUrl, isExpired } from '@postguy/core';
import { newId, type JarCookie } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { cookies } from '../db/schema.ts';
import { notFound } from '../lib/errors.ts';

/** Jar key: an environment id, or '' for the workspace jar. */
export const jarKey = (environmentId: string | null | undefined) => environmentId ?? '';

type Row = typeof cookies.$inferSelect;

function toJarCookie(r: Row): JarCookie {
  const { jar, ...rest } = r;
  return { ...rest, environmentId: jar || null };
}

function purgeExpired(db: Db, now = Date.now()) {
  db.delete(cookies).where(and(isNotNull(cookies.expiresAt), lte(cookies.expiresAt, now))).run();
}

export function listCookies(db: Db, environmentId?: string | null): JarCookie[] {
  purgeExpired(db);
  const q = db.select().from(cookies);
  const rows = environmentId === undefined ? q.orderBy(asc(cookies.domain), asc(cookies.name)).all() : q.where(eq(cookies.jar, jarKey(environmentId))).orderBy(asc(cookies.domain), asc(cookies.name)).all();
  return rows.map(toJarCookie);
}

/** The Cookie header value a request to `url` should carry from this jar, or null. */
export function cookieHeaderFor(db: Db, environmentId: string | null, url: string): string | null {
  const rows = db.select().from(cookies).where(eq(cookies.jar, jarKey(environmentId))).all();
  return cookieHeader(cookiesForUrl(rows, url));
}

export function cookiesFor(db: Db, environmentId: string | null, url: string): { name: string; value: string }[] {
  const rows = db.select().from(cookies).where(eq(cookies.jar, jarKey(environmentId))).all();
  return cookiesForUrl(rows, url).map(({ name, value }) => ({ name, value }));
}

/** Stores the Set-Cookie headers of a response from `url`; an expired cookie removes the stored one. */
export function storeSetCookies(db: Db, environmentId: string | null, url: string, headers: string[], now = Date.now()): void {
  const jar = jarKey(environmentId);
  for (const header of headers) {
    const c = cookieFromSetCookie(header, url, now);
    if (!c) continue;
    const key = and(eq(cookies.jar, jar), eq(cookies.domain, c.domain), eq(cookies.path, c.path), eq(cookies.name, c.name));
    const existing = db.select().from(cookies).where(key).get();
    if (isExpired(c, now)) {
      if (existing) db.delete(cookies).where(eq(cookies.id, existing.id)).run();
      continue;
    }
    if (existing) db.update(cookies).set({ ...c, createdAt: existing.createdAt }).where(eq(cookies.id, existing.id)).run();
    else db.insert(cookies).values({ id: newId(), jar, ...c }).run();
  }
}

export function deleteCookie(db: Db, id: string): void {
  const row = db.select({ id: cookies.id }).from(cookies).where(eq(cookies.id, id)).get();
  if (!row) throw notFound('Cookie');
  db.delete(cookies).where(eq(cookies.id, id)).run();
}

/** Clears one jar, or every jar when `environmentId` is undefined. Returns how many cookies were removed. */
export function clearCookies(db: Db, environmentId?: string | null, domain?: string): number {
  const conds = [
    ...(environmentId === undefined ? [] : [eq(cookies.jar, jarKey(environmentId))]),
    ...(domain ? [eq(cookies.domain, domain.toLowerCase())] : []),
  ];
  return db.delete(cookies).where(conds.length ? and(...conds) : undefined).run().changes;
}
