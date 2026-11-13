import { and, asc, eq } from 'drizzle-orm';
import { MASK } from '@postguy/core';
import { newId, VariableInput, type Variable, type VariableScope } from '@postguy/shared';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { variables } from '../db/schema.ts';
import { badRequest } from '../lib/errors.ts';

export function listVariables(db: Db, scope: VariableScope, ownerId: string, reveal = false): Variable[] {
  const rows = db
    .select()
    .from(variables)
    .where(and(eq(variables.scope, scope), eq(variables.ownerId, ownerId)))
    .orderBy(asc(variables.sortOrder))
    .all();
  return rows.map(({ sortOrder: _s, ...v }) => (v.isSecret && !reveal && v.value ? { ...v, value: MASK } : v));
}

/** Replaces all variables of an owner. A masked secret value keeps the stored value. */
export function replaceVariables(
  db: Db,
  scope: VariableScope,
  ownerId: string,
  input: z.output<typeof VariableInput>[],
): Variable[] {
  const keys = new Set<string>();
  for (const v of input) {
    if (keys.has(v.key)) throw badRequest(`Duplicate variable "${v.key}"`);
    keys.add(v.key);
  }
  const existing = new Map(listVariables(db, scope, ownerId, true).map((v) => [v.key, v]));
  const now = Date.now();
  db.transaction((tx) => {
    tx.delete(variables).where(and(eq(variables.scope, scope), eq(variables.ownerId, ownerId))).run();
    input.forEach((v, i) => {
      const prev = existing.get(v.key);
      const value = v.value === MASK && prev ? prev.value : v.value;
      tx.insert(variables)
        .values({
          id: prev?.id ?? newId(),
          scope,
          ownerId,
          key: v.key,
          value,
          isSecret: v.isSecret,
          enabled: v.enabled,
          sortOrder: i,
          createdAt: prev?.createdAt ?? now,
          updatedAt: now,
        })
        .run();
    });
  });
  return listVariables(db, scope, ownerId);
}

/** Enabled variables of an owner as a resolver map. */
export function variableMap(db: Db, scope: VariableScope, ownerId: string) {
  const out: Record<string, { value: string; secret: boolean; ownerId: string }> = {};
  for (const v of listVariables(db, scope, ownerId, true)) {
    if (v.enabled) out[v.key] = { value: v.value, secret: v.isSecret, ownerId };
  }
  return out;
}

/** Sets one variable, keeping its secret flag and position when it exists, and enables it; others are untouched. */
export function setVariable(db: Db, scope: VariableScope, ownerId: string, key: string, value: string, isSecret?: boolean): Variable {
  const current = listVariables(db, scope, ownerId, true);
  const prev = current.find((v) => v.key === key);
  const next = prev
    ? current.map((v) => (v.key === key ? { ...v, value, isSecret: isSecret ?? v.isSecret, enabled: true } : v))
    : [...current, { key, value, isSecret: isSecret ?? false, enabled: true }];
  replaceVariables(db, scope, ownerId, next.map((v) => ({ key: v.key, value: v.value, isSecret: v.isSecret, enabled: v.enabled })));
  return listVariables(db, scope, ownerId, false).find((v) => v.key === key)!;
}
