import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { UpdatePreferences, UpdateRequestDefaults, type AppInfo } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { parse } from '../lib/errors.ts';
import { getPreferences, getRequestDefaults, updatePreferences, updateRequestDefaults } from '../services/settings.ts';

const DATABASE = 'postguy.db';

export function settingsRoutes(app: FastifyInstance, db: Db, dataDir: string | null) {
  app.get('/settings/requests', async () => getRequestDefaults(db));
  app.patch('/settings/requests', async (req) => updateRequestDefaults(db, parse(UpdateRequestDefaults, req.body)));

  app.get('/settings/preferences', async () => getPreferences(db));
  app.patch('/settings/preferences', async (req) => updatePreferences(db, parse(UpdatePreferences, req.body)));

  app.get('/settings/app', async (): Promise<AppInfo> => {
    if (!dataDir) return { dataDir: null, database: null, backups: [] };
    let files: string[] = [];
    try {
      files = readdirSync(dataDir);
    } catch {
      /* folder missing */
    }
    const backups = files
      .filter((f) => f.startsWith(`${DATABASE}.bak-before-`))
      .map((name) => {
        const path = join(dataDir, name);
        const st = statSync(path);
        return { name, path, size: st.size, createdAt: st.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return { dataDir, database: join(dataDir, DATABASE), backups };
  });
}
