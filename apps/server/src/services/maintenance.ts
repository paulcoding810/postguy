import { and, desc, eq, inArray, lt, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { flowExecutions, requestHistory } from '../db/schema.ts';

export const HISTORY_KEEP = 2000;
export const EXECUTIONS_KEEP = 50;
let sendsSincePrune = 0;

/** Keeps the newest history rows; snapshots that pointed at pruned rows keep their data. */
export function pruneHistory(db: Db, keep = HISTORY_KEEP): number {
  const cutoff = db.select({ createdAt: requestHistory.createdAt }).from(requestHistory).orderBy(desc(requestHistory.createdAt)).limit(1).offset(keep - 1).get();
  if (!cutoff) return 0;
  return db.delete(requestHistory).where(lt(requestHistory.createdAt, cutoff.createdAt)).run().changes;
}

/** Called after each send; prunes every 50 sends to keep writes cheap. */
export function afterSend(db: Db): void {
  if (++sendsSincePrune < 50) return;
  sendsSincePrune = 0;
  pruneHistory(db);
}

/** Keeps the newest runs of a flow; never touches a running or paused one. */
export function pruneExecutions(db: Db, flowId: string, keep = EXECUTIONS_KEEP): number {
  const recent = db.select({ id: flowExecutions.id }).from(flowExecutions).where(eq(flowExecutions.flowId, flowId)).orderBy(desc(flowExecutions.startedAt)).limit(keep).all().map((r) => r.id);
  if (recent.length < keep) return 0;
  return db
    .delete(flowExecutions)
    .where(and(eq(flowExecutions.flowId, flowId), notInArray(flowExecutions.id, recent), inArray(flowExecutions.status, ['success', 'failed', 'stopped'])))
    .run().changes;
}
