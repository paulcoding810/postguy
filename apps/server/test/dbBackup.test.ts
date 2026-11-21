import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, openDatabase } from '../src/db/client.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'postguy-backup-'));
  dirs.push(dir);
  return join(dir, 'postguy.db');
}

describe('database backup before migrating', () => {
  it('copies the database only when an update brings new migrations', () => {
    const file = tempDb();
    openDatabase(file).close();
    expect(readdirSync(join(file, '..')).filter((f) => f.includes('.bak-'))).toEqual([]);

    // Pretend the latest migration has not run yet, as after installing an update.
    const raw = new Database(file);
    raw.prepare('DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)').run();
    raw.prepare("INSERT INTO collections (id, kind, name) VALUES ('c1', 'collection', 'Kept')").run();
    raw.close();

    // The latest migration fails to re-apply on an already-migrated schema; the backup is made before that.
    try {
      openDatabase(file).close();
    } catch {
      /* expected */
    }
    const backups = readdirSync(join(file, '..')).filter((f) => f.startsWith('postguy.db.bak-before-'));
    expect(backups).toHaveLength(1);
    const copy = new Database(join(file, '..', backups[0]!), { readonly: true });
    expect(copy.prepare("SELECT name FROM collections WHERE id = 'c1'").get()).toEqual({ name: 'Kept' });
    copy.close();
    expect(existsSync(MIGRATIONS_DIR)).toBe(true);
  });
});
