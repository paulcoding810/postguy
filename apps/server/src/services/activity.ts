import { and, desc, eq, inArray, isNull, like, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { ActivityActor, ActivityItem, ActivityKind, ActivityQuery } from '@postguy/shared';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { changeLog, collections, flowExecutions, flowExecutionSteps, flows, requestHistory } from '../db/schema.ts';
import { toEntry } from './changeRestore.ts';

const CHANGE_WHO: Record<string, ActivityActor> = { app: 'you', api: 'api', mcp: 'claude', sync: 'sync', import: 'import' };

/**
 * What happened, newest first: requests sent (history), changes (change log) and flow runs,
 * merged by time. Each source is read up to `limit` rows before the cursor, so pages stay exact.
 */
export function listActivity(db: Db, query: z.output<typeof ActivityQuery>): { items: ActivityItem[]; next: number | null } {
  const kinds = new Set<ActivityKind>((query.kinds?.split(',').map((k) => k.trim()) as ActivityKind[] | undefined) ?? ['send', 'change', 'flow']);
  const before = query.before ?? Number.MAX_SAFE_INTEGER;
  const limit = query.limit;
  const q = query.q?.trim() ? `%${query.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%` : null;
  const items: ActivityItem[] = [];

  if (kinds.has('send') && query.who !== 'other') {
    const who: SQL | undefined =
      query.who === 'claude' ? eq(requestHistory.source, 'mcp') : query.who === 'script' ? eq(requestHistory.source, 'script') : query.who === 'you' ? isNull(requestHistory.source) : undefined;
    const rows = db
      .select()
      .from(requestHistory)
      .where(and(lt(requestHistory.createdAt, before), who, q ? sql`${requestHistory.url} LIKE ${q} ESCAPE '\\'` : undefined))
      .orderBy(desc(requestHistory.createdAt))
      .limit(limit)
      .all();
    for (const h of rows)
      items.push({
        kind: 'send',
        id: h.id,
        at: h.createdAt,
        who: h.source === 'mcp' ? 'claude' : h.source === 'script' ? 'script' : 'you',
        method: h.method,
        url: h.url,
        status: h.status,
        error: h.error,
        requestId: h.requestId,
        timeMs: h.timing ? Math.round(h.timing.totalMs) : null,
      });
  }

  if (kinds.has('change') && query.who !== 'script') {
    type Source = (typeof changeLog.$inferSelect)['source'];
    const sources: Source[] | null = query.who === 'you' ? ['app'] : query.who === 'claude' ? ['mcp'] : query.who === 'other' ? ['api', 'sync', 'import'] : null;
    const rows = db
      .select()
      .from(changeLog)
      .where(and(lt(changeLog.updatedAt, before), sources ? inArray(changeLog.source, sources) : undefined, q ? like(changeLog.label, q) : undefined))
      .orderBy(desc(changeLog.updatedAt))
      .limit(limit)
      .all();
    const rootIds = [...new Set(rows.map((r) => r.rootId))];
    const names = new Map(rootIds.length ? db.select({ id: collections.id, name: collections.name }).from(collections).where(inArray(collections.id, rootIds)).all().map((c) => [c.id, c.name]) : []);
    for (const r of rows)
      items.push({ kind: 'change', id: r.id, at: r.updatedAt, who: CHANGE_WHO[r.source] ?? 'api', change: toEntry(r), collection: names.get(r.rootId) ?? null });
  }

  if (kinds.has('flow') && query.who !== 'script' && query.who !== 'other') {
    const who: SQL | undefined = query.who === 'claude' ? eq(flowExecutions.source, 'mcp') : query.who === 'you' ? or(isNull(flowExecutions.source), ne(flowExecutions.source, 'mcp')) : undefined;
    const rows = db
      .select({ id: flowExecutions.id, flowId: flowExecutions.flowId, flow: flows.name, status: flowExecutions.status, source: flowExecutions.source, startedAt: flowExecutions.startedAt })
      .from(flowExecutions)
      .innerJoin(flows, eq(flows.id, flowExecutions.flowId))
      .where(and(lt(flowExecutions.startedAt, before), who, q ? like(flows.name, q) : undefined))
      .orderBy(desc(flowExecutions.startedAt))
      .limit(limit)
      .all();
    const counts = new Map<string, { passed: number; failed: number; total: number }>();
    if (rows.length) {
      const steps = db
        .select({ executionId: flowExecutionSteps.executionId, stepId: flowExecutionSteps.stepId, status: flowExecutionSteps.status, attempt: flowExecutionSteps.attempt })
        .from(flowExecutionSteps)
        .where(inArray(flowExecutionSteps.executionId, rows.map((r) => r.id)))
        .all();
      // Only each step's latest attempt counts.
      const latest = new Map<string, { executionId: string; status: string; attempt: number }>();
      for (const s of steps) {
        const key = `${s.executionId}:${s.stepId}`;
        if ((latest.get(key)?.attempt ?? 0) < s.attempt) latest.set(key, s);
      }
      for (const s of latest.values()) {
        const c = counts.get(s.executionId) ?? { passed: 0, failed: 0, total: 0 };
        c.total++;
        if (s.status === 'success') c.passed++;
        else if (s.status === 'failed') c.failed++;
        counts.set(s.executionId, c);
      }
    }
    for (const r of rows)
      items.push({ kind: 'flow', id: r.id, at: r.startedAt, who: r.source === 'mcp' ? 'claude' : 'you', flowId: r.flowId, flow: r.flow, status: r.status, ...(counts.get(r.id) ?? { passed: 0, failed: 0, total: 0 }) });
  }

  items.sort((a, b) => b.at - a.at);
  const page = items.slice(0, limit);
  return { items: page, next: items.length > limit || page.length === limit ? (page.at(-1)?.at ?? null) : null };
}
