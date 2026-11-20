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
