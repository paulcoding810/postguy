import { and, asc, eq, max } from 'drizzle-orm';
import { newId, type Environment } from '@postguy/shared';
import { environmentToPostman, isPostmanEnvironment, postmanToEnvironment } from '@postguy/core';
import type { Db } from '../db/client.ts';
import { cookies, environments, variables } from '../db/schema.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { listVariables, replaceVariables } from './variables.ts';
import { ENVIRONMENTS_ROOT, recordChange } from './changelog.ts';

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
    mcpBlocked: false,
    mcpRevealSecrets: false,
    createdAt: Date.now(),
  };
  db.insert(environments).values(row).run();
  return row;
}

export function updateEnvironment(
  db: Db,
  id: string,
  input: { name?: string; sortOrder?: number; mcpBlocked?: boolean; mcpRevealSecrets?: boolean },
): Environment {
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
    tx.delete(cookies).where(eq(cookies.jar, id)).run();
    tx.delete(environments).where(eq(environments.id, id)).run();
  });
}

export function activateEnvironment(db: Db, id: string | null): void {
  if (id) {
    const env = getEnvironment(db, id);
    if (env.kind === 'global') throw badRequest('The global environment is always active');
  }
  const was = db.select({ id: environments.id, name: environments.name }).from(environments).where(and(eq(environments.kind, 'environment'), eq(environments.isActive, true))).get() ?? null;
  db.transaction((tx) => {
    tx.update(environments).set({ isActive: false }).where(eq(environments.kind, 'environment')).run();
    if (id) tx.update(environments).set({ isActive: true }).where(eq(environments.id, id)).run();
  });
  const now = id ? (db.select({ id: environments.id, name: environments.name }).from(environments).where(eq(environments.id, id)).get() ?? null) : null;
  if ((was?.id ?? null) !== (now?.id ?? null))
    recordChange(db, { rootId: ENVIRONMENTS_ROOT, entityType: 'active-environment', entityId: 'active', label: now?.name ?? 'No environment', action: 'update', before: was, after: now });
}

/** Imports a Postman environment, or Postman globals into the global environment. */
export function importEnvironment(db: Db, data: unknown): { environment: Environment; warnings: string[] } {
  if (!isPostmanEnvironment(data)) throw badRequest('Not a Postman environment export');
  const env = postmanToEnvironment(data);
  const warnings: string[] = [];
  return db.transaction(() => {
    const target = env.scope === 'globals' ? globalEnvironment(db) : createEnvironment(db, uniqueName(db, env.name));
    const imported = new Set(env.variables.map((v) => v.key));
    const existing = env.scope === 'globals' ? listVariables(db, 'global', target.id, true) : [];
    const kept = existing.filter((v) => !imported.has(v.key));
    const current = new Map(existing.map((v) => [v.key, v]));
    // Exports leave secrets blank, so a blank secret in the file keeps the value already here.
    const keptSecrets: string[] = [];
    const incoming = env.variables.map((v) => {
      const had = current.get(v.key);
      if (!v.isSecret || v.value || !had?.value) return v;
      keptSecrets.push(v.key);
      return { ...v, value: had.value };
    });
    const ownerScope = env.scope === 'globals' ? 'global' : 'environment';
    replaceVariables(db, ownerScope, target.id, [...kept.map((v) => ({ key: v.key, value: v.value, isSecret: v.isSecret, enabled: v.enabled })), ...incoming]);
    const blankSecrets = incoming.filter((v) => v.isSecret && !v.value).map((v) => v.key);
    if (blankSecrets.length) warnings.push(`Secret values were empty in the file; fill them in: ${blankSecrets.join(', ')}.`);
    if (keptSecrets.length) warnings.push(`Secret values were empty in the file, so your current values were kept: ${keptSecrets.join(', ')}.`);
    if (env.scope === 'globals') warnings.push(`Postman globals were merged into Postguy's globals (${env.variables.length} variables).`);
    return { environment: target, warnings };
  });
}

export function exportEnvironment(db: Db, id: string) {
  const env = getEnvironment(db, id);
  return environmentToPostman(env, listVariables(db, env.kind === 'global' ? 'global' : 'environment', env.id, true));
}

function uniqueName(db: Db, name: string): string {
  const taken = new Set(listEnvironments(db).map((e) => e.name));
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`)) return `${name} (${i})`;
}
