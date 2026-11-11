import * as React from 'react';
import { useReferenceSources } from '@/features/memory/queries';
import { refFor } from '@/features/memory/refs';
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
