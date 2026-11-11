import { and, asc, eq, max } from 'drizzle-orm';
import { newId, type Environment } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { environments, variables } from '../db/schema.ts';
import { badRequest, notFound } from '../lib/errors.ts';

export function listEnvironments(db: Db): Environment[] {
  return db.select().from(environments).orderBy(asc(environments.sortOrder), asc(environments.createdAt)).all();
}

export function getEnvironment(db: Db, id: string): Environment {
  const row = db.select().from(environments).where(eq(environments.id, id)).get();
  if (!row) throw notFound('Environment');
  return row;
}

export function globalEnvironment(db: Db): Environment {
  return db.select().from(environments).where(eq(environments.kind, 'global')).get()!;
}

export function activeEnvironment(db: Db): Environment | null {
  return (
    db
      .select()
      .from(environments)
      .where(and(eq(environments.kind, 'environment'), eq(environments.isActive, true)))
      .get() ?? null
  );
}

export function createEnvironment(db: Db, name: string): Environment {
  const m = db.select({ m: max(environments.sortOrder) }).from(environments).get();
  const row = {
    id: newId(),
    kind: 'environment' as const,
    name,
    isActive: false,
    sortOrder: (m?.m ?? 0) + 1,
    createdAt: Date.now(),
  };
  db.insert(environments).values(row).run();
  return row;
}

export function updateEnvironment(db: Db, id: string, input: { name?: string; sortOrder?: number }): Environment {
  getEnvironment(db, id);
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length) db.update(environments).set(patch).where(eq(environments.id, id)).run();
  return getEnvironment(db, id);
}

export function deleteEnvironment(db: Db, id: string): void {
  const env = getEnvironment(db, id);
  if (env.kind === 'global') throw badRequest('The global environment cannot be deleted');
  db.transaction((tx) => {
    tx.delete(variables).where(and(eq(variables.scope, 'environment'), eq(variables.ownerId, id))).run();
    tx.delete(environments).where(eq(environments.id, id)).run();
  });
}

export function activateEnvironment(db: Db, id: string | null): void {
  if (id) {
    const env = getEnvironment(db, id);
    if (env.kind === 'global') throw badRequest('The global environment is always active');
  }
  db.transaction((tx) => {
    tx.update(environments).set({ isActive: false }).where(eq(environments.kind, 'environment')).run();
    if (id) tx.update(environments).set({ isActive: true }).where(eq(environments.id, id)).run();
  });
}
