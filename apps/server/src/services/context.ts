import { createContext, type ResolutionContext, type ResponseRecord, type VarMap } from '@postguy/core';
import type { Db } from '../db/client.ts';
import { ancestry } from './collections.ts';
import { activeEnvironment, globalEnvironment } from './environments.ts';
import { snapshotLookup } from './memory.ts';
import { variableMap } from './variables.ts';

export interface ContextOptions {
  collectionId?: string | null;
  requestId?: string | null;
  /** `undefined` uses the active environment, `null` uses none. */
  environmentId?: string | null;
  flowId?: string | null;
  runtime?: VarMap;
  /** Defaults to stored snapshots; a flow execution passes only its own responses. */
  responses?: (name: string) => ResponseRecord | undefined;
}

export interface BuiltContext {
  ctx: ResolutionContext;
  environmentId: string | null;
}

export function buildContext(db: Db, opts: ContextOptions): BuiltContext {
  const environmentId = opts.environmentId === undefined ? (activeEnvironment(db)?.id ?? null) : opts.environmentId;
  const ctx = createContext(
    {
      runtime: opts.runtime,
      request: opts.requestId ? variableMap(db, 'request', opts.requestId) : undefined,
      flow: opts.flowId ? variableMap(db, 'flow', opts.flowId) : undefined,
      collection: ancestry(db, opts.collectionId).map((c) => variableMap(db, 'collection', c.id)),
      environment: environmentId ? variableMap(db, 'environment', environmentId) : undefined,
      global: variableMap(db, 'global', globalEnvironment(db).id),
    },
    opts.responses ?? snapshotLookup(db, opts.collectionId),
  );
  return { ctx, environmentId };
}
