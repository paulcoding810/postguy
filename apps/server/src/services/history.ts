import { desc, eq } from 'drizzle-orm';
import type { HistoryEntry, HistorySummary } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { requestHistory } from '../db/schema.ts';
import { notFound } from '../lib/errors.ts';

export function listHistory(db: Db, opts: { requestId?: string; limit: number }): HistorySummary[] {
  return db
    .select({
      id: requestHistory.id,
      requestId: requestHistory.requestId,
      method: requestHistory.method,
      url: requestHistory.url,
      status: requestHistory.status,
      timing: requestHistory.timing,
      bodySize: requestHistory.bodySize,
      error: requestHistory.error,
      source: requestHistory.source,
      createdAt: requestHistory.createdAt,
    })
    .from(requestHistory)
    .where(opts.requestId ? eq(requestHistory.requestId, opts.requestId) : undefined)
    .orderBy(desc(requestHistory.createdAt))
    .limit(opts.limit)
    .all();
}

export function getHistoryEntry(db: Db, id: string): HistoryEntry {
  const row = db.select().from(requestHistory).where(eq(requestHistory.id, id)).get();
  if (!row) throw notFound('History entry');
  return row;
}

export function clearHistory(db: Db): void {
  db.delete(requestHistory).run();
}
