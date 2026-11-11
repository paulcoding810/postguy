import type { VariableScope } from '@postguy/shared';

export type VarSource = VariableScope | 'runtime';

export interface VarEntry {
  value: string;
  secret: boolean;
  source: VarSource;
}

export type VarMap = Record<string, { value: string; secret?: boolean }>;

export interface ResponseRecord {
  name: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  source: 'execution' | 'snapshot';
  snapshotId?: string;
  requestId?: string;
}

export interface ResolutionContext {
  variables: ReadonlyMap<string, VarEntry>;
  response: (name: string) => ResponseRecord | undefined;
}

/** Highest precedence first. */
export const SCOPE_PRECEDENCE: readonly VarSource[] = [
  'runtime',
  'request',
  'flow',
  'collection',
  'environment',
  'global',
];

export type ScopeMaps = Partial<Record<VarSource, VarMap | VarMap[]>>;

/**
 * Merges scopes by precedence. A scope may hold several maps (e.g. nested folders),
 * ordered innermost first.
 */
export function mergeScopes(scopes: ScopeMaps): Map<string, VarEntry> {
  const merged = new Map<string, VarEntry>();
  for (const source of SCOPE_PRECEDENCE) {
    const entry = scopes[source];
    if (!entry) continue;
    for (const map of Array.isArray(entry) ? entry : [entry]) {
      for (const [key, v] of Object.entries(map)) {
        if (!merged.has(key)) merged.set(key, { value: v.value, secret: !!v.secret, source });
      }
    }
  }
  return merged;
}

export function createContext(
  scopes: ScopeMaps,
  responses: Iterable<ResponseRecord> | ((name: string) => ResponseRecord | undefined) = [],
): ResolutionContext {
  const variables = mergeScopes(scopes);
  if (typeof responses === 'function') return { variables, response: responses };
  const byName = new Map<string, ResponseRecord>();
  for (const r of responses) byName.set(r.name, r);
  return { variables, response: (name) => byName.get(name) };
}
