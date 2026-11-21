import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { newId } from '@postguy/shared';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema>;

const here = dirname(fileURLToPath(import.meta.url));
/** Next to the bundled server.mjs in the app, or the package's drizzle folder in development. */
export const MIGRATIONS_DIR = [join(here, 'drizzle'), join(here, '..', '..', 'drizzle')].find((d) => existsSync(join(d, 'meta'))) ?? join(here, '..', '..', 'drizzle');

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
  const migrationsFolder = process.env.POSTGUY_MIGRATIONS_DIR ?? MIGRATIONS_DIR;
  if (file !== ':memory:') backupBeforeMigrating(sqlite, file, migrationsFolder);
  migrate(db, { migrationsFolder });
  seed(db);
  return { db, close: () => sqlite.close() };
}

const KEEP_BACKUPS = 3;

/** Copies the database before an update's migrations change it, keeping the latest few copies. */
export function backupBeforeMigrating(sqlite: Database.Database, file: string, migrationsFolder: string): string | null {
  const hasTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!hasTable) return null;
  const last = (sqlite.prepare('SELECT max(created_at) AS m FROM __drizzle_migrations').get() as { m: number | null }).m;
  if (last == null) return null;
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
  const pending = journal.entries.find((e) => e.when > last);
  if (!pending) return null;
  const dest = `${file}.bak-before-${pending.tag}`;
  if (existsSync(dest)) rmSync(dest);
  sqlite.prepare('VACUUM INTO ?').run(dest);
  const prefix = `${basename(file)}.bak-before-`;
  const backups = readdirSync(dirname(file))
    .filter((f) => f.startsWith(prefix))
    .sort()
    .reverse();
  for (const old of backups.slice(KEEP_BACKUPS)) rmSync(join(dirname(file), old), { force: true });
  return dest;
}

function seed(db: Db) {
  const global = db.select().from(schema.environments).where(eq(schema.environments.kind, 'global')).get();
  if (!global) db.insert(schema.environments).values({ id: newId(), kind: 'global', name: 'Globals' }).run();
}
