import { and, eq, inArray } from 'drizzle-orm';
import { newId, type Scripts } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { scripts } from '../db/schema.ts';

export type ScriptOwner = 'request' | 'flow_step';

export function loadScripts(db: Db, ownerType: ScriptOwner, ownerId: string): Scripts {
  const rows = db.select().from(scripts).where(and(eq(scripts.ownerType, ownerType), eq(scripts.ownerId, ownerId))).all();
  return { pre: rows.find((r) => r.phase === 'pre')?.source ?? '', post: rows.find((r) => r.phase === 'post')?.source ?? '' };
}

export function saveScripts(db: Db, ownerType: ScriptOwner, ownerId: string, value: Scripts): void {
  for (const phase of ['pre', 'post'] as const) {
    const source = value[phase] ?? '';
    const where = and(eq(scripts.ownerType, ownerType), eq(scripts.ownerId, ownerId), eq(scripts.phase, phase));
    if (!source.trim()) {
      db.delete(scripts).where(where).run();
      continue;
    }
    const existing = db.select({ id: scripts.id }).from(scripts).where(where).get();
    if (existing) db.update(scripts).set({ source, updatedAt: Date.now() }).where(eq(scripts.id, existing.id)).run();
    else db.insert(scripts).values({ id: newId(), ownerType, ownerId, phase, source, updatedAt: Date.now() }).run();
  }
}

export function deleteScripts(db: Db, ownerType: ScriptOwner, ownerIds: string[]): void {
  if (ownerIds.length) db.delete(scripts).where(and(eq(scripts.ownerType, ownerType), inArray(scripts.ownerId, ownerIds))).run();
}

export const stepOwnerId = (flowId: string, stepId: string) => `${flowId}/${stepId}`;
