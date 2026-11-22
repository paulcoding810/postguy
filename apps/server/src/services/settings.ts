import { eq } from 'drizzle-orm';
import { McpSettings, type UpdateMcpSettings } from '@postguy/shared';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { appSettings } from '../db/schema.ts';

export function getMcpSettings(db: Db): McpSettings {
  const row = db.select().from(appSettings).where(eq(appSettings.key, 'mcp')).get();
  return McpSettings.parse(row?.value ?? {});
}

export function updateMcpSettings(db: Db, patch: z.output<typeof UpdateMcpSettings>): McpSettings {
  const next = McpSettings.parse({ ...getMcpSettings(db), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
  db.insert(appSettings)
    .values({ key: 'mcp', value: next, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: Date.now() } })
    .run();
  return next;
}

const UNTRUSTED = 'mcpUntrustedHosts';

/** Hosts that appeared only through Claude's edits; secrets don't go there until the user sends there. */
export function untrustedHosts(db: Db): Set<string> {
  const row = db.select().from(appSettings).where(eq(appSettings.key, UNTRUSTED)).get();
  return new Set(Array.isArray(row?.value) ? (row.value as string[]) : []);
}

function saveUntrusted(db: Db, hosts: Set<string>) {
  const value = [...hosts].sort();
  db.insert(appSettings)
    .values({ key: UNTRUSTED, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: Date.now() } })
    .run();
}

export function markUntrusted(db: Db, hosts: Iterable<string>) {
  const set = untrustedHosts(db);
  const before = set.size;
  for (const h of hosts) set.add(h);
  if (set.size !== before) saveUntrusted(db, set);
}

/** The user sent to this URL themselves, so its host is theirs again. */
export function trustHostOf(db: Db, url: string) {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return;
  }
  const set = untrustedHosts(db);
  if (set.delete(host)) saveUntrusted(db, set);
}
