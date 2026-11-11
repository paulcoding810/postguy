import * as React from 'react';
import { useReferenceSources } from '@/features/memory/queries';
import { formatSegs, refFor, type Seg } from '@/features/memory/refs';
import { useFlowSources } from '@/features/flows/queries';
import type { Suggestion } from './TemplateContext';

function preview(v: unknown): string {
  if (v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/** Suggests `{{Request.path}}` references from remembered responses. */
export function useResponseSuggestions(collectionId: string | null): (query: string) => Suggestion[] {
  const sources = useReferenceSources(collectionId);
  const all = React.useMemo<Suggestion[]>(
    () =>
      (sources.data ?? [])
        .filter((s) => !s.shadowed)
        .flatMap((s) =>
          s.paths
            .filter((p) => !p.wildcard)
            .map((p) => {
              const ref = refFor(s.name, p.path);
              return { value: ref, label: ref, detail: `${p.type}${p.sample !== undefined ? ` · ${preview(p.sample)}` : ''}`, kind: 'response' as const };
            }),
        ),
    [sources.data],
  );
  return React.useCallback(
    (q: string) => {
      if (!q) return all.filter((s) => s.value.split('.').length <= 2).slice(0, 30);
      return all.filter((s) => s.value.toLowerCase().includes(q)).slice(0, 50);
    },
    [all],
  );
}

/** In a flow, suggests paths from upstream steps' sample responses, keyed by step name. */
export function useFlowSuggestions(flow: { flowId: string; stepId: string } | null): (query: string) => Suggestion[] {
  const sources = useFlowSources(flow?.flowId ?? null, flow?.stepId ?? null);
  const all = React.useMemo<Suggestion[]>(
    () =>
      (sources.data ?? []).flatMap((s) =>
        s.origin === 'none'
          ? []
          : extractLeafPaths(s.body).map(([path, sample]) => {
              const ref = refFor(s.name, path);
              return { value: ref, label: ref, detail: preview(sample), kind: 'response' as const };
            }),
      ),
    [sources.data],
  );
  return React.useCallback((q: string) => (q ? all.filter((s) => s.value.toLowerCase().includes(q)) : all).slice(0, 50), [all]);
}

function extractLeafPaths(value: unknown, prefix: Seg[] = [], out: [string, unknown][] = [], depth = 0): [string, unknown][] {
  if (out.length > 400 || depth > 12) return out;
  if (value !== null && typeof value === 'object') {
    const entries: [Seg, unknown][] = Array.isArray(value) ? value.slice(0, 1).map((v, i) => [i, v]) : Object.entries(value);
    for (const [k, v] of entries) {
      const segs = [...prefix, k];
      if (v === null || typeof v !== 'object') out.push([formatSegs(segs), v]);
      else extractLeafPaths(v, segs, out, depth + 1);
    }
  }
  return out;
}
