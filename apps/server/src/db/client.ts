import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { newId } from '@postguy/shared';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema>;

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

export function openDatabase(file: string): { db: Db; close: () => void } {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('temp_store = MEMORY');
  sqlite.pragma('cache_size = -16000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: process.env.POSTGUY_MIGRATIONS_DIR ?? MIGRATIONS_DIR });
  seed(db);
  return { db, close: () => sqlite.close() };
}

function seed(db: Db) {
  const global = db.select().from(schema.environments).where(eq(schema.environments.kind, 'global')).get();
  if (!global) db.insert(schema.environments).values({ id: newId(), kind: 'global', name: 'Globals' }).run();
}
