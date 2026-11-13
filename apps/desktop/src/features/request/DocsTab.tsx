import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import type { KeyValue, SavedRequest } from '@postguy/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { SchemaView } from '@/components/SchemaView';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { isDirty, isRequestTab, useTabs } from '@/stores/tabs';

export function useOperation(requestId: string | null) {
  return useQuery({
    queryKey: ['operation', requestId],
    queryFn: () => api('GET /requests/:id/operation', { params: { id: requestId! } }),
    enabled: !!requestId,
    staleTime: 60_000,
  });
}

/** Puts params a merge added on the server into open tabs, keeping unsaved edits. */
function syncTabs(saved: SavedRequest) {
  const store = useTabs.getState();
  for (const t of store.tabs) {
    if (!isRequestTab(t) || t.requestId !== saved.id) continue;
    if (!isDirty(t)) {
      store.markSaved(t.id, saved);
      continue;
    }
    const append = (mine: KeyValue[], theirs: KeyValue[]) => [...mine, ...theirs.filter((k) => !mine.some((m) => m.key.toLowerCase() === k.key.toLowerCase()))];
    store.updateDraft(t.id, (d) => ({ ...d, params: append(d.params, saved.params), headers: append(d.headers, saved.headers) }));
  }
}

function MissingParams({ requestId }: { requestId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const merge = useQuery({
    queryKey: ['spec-merge', requestId],
    queryFn: () => api('GET /requests/:id/spec-merge', { params: { id: requestId } }),
    staleTime: 10_000,
  });
  const added = merge.data?.added ?? [];
  if (!added.length) return null;
  const apply = async () => {
    setBusy(true);
    try {
      const saved = await api('POST /requests/:id/spec-merge', { params: { id: requestId }, body: {} });
      syncTabs(saved);
      qc.setQueryData(['request', saved.id], saved);
      toast.success(`Added ${added.join(', ')}`);
      await Promise.all([qc.invalidateQueries({ queryKey: ['spec-merge', requestId] }), qc.invalidateQueries({ queryKey: ['tree'] })]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
      <span className="flex-1">This request is missing required parameters from the spec: {added.join(', ')}.</span>
      <Button size="xs" variant="outline" disabled={busy} onClick={apply}>
        <PlusIcon /> Add missing required params
      </Button>
    </div>
  );
}

export function DocsTab({ requestId }: { requestId: string | null }) {
  const q = useOperation(requestId);
  const op = q.data?.operation;
  if (!op) {
    return (
      <EmptyState icon={<BookOpenIcon className="size-6" />} title="No documentation">
        {requestId ? 'This request was not generated from an OpenAPI specification.' : 'Save the request first.'}
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-4 text-[13px]">
      {requestId && <MissingParams requestId={requestId} />}
      <div>
        <div className="flex items-center gap-2">
          <span className={cn('font-mono text-xs font-bold', `method-${op.method}`)}>{op.method}</span>
          <span className="font-mono text-xs">{op.path}</span>
          {op.deprecated && <Badge variant="warning">deprecated</Badge>}
          <span className="ml-auto text-xs text-muted-foreground">
            {q.data!.model.title} · {op.id}
          </span>
        </div>
        {op.summary && <h3 className="mt-1 text-sm font-semibold">{op.summary}</h3>}
        {op.description && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{op.description}</p>}
      </div>
      {op.params.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Parameters</h4>
          <table className="w-full text-xs">
            <tbody>
              {op.params.map((p) => (
                <tr key={`${p.in}:${p.name}`} className="border-b align-top">
                  <td className="py-1 pr-3 font-mono">
                    {p.name}
                    {p.required && <span className="text-destructive">*</span>}
                  </td>
                  <td className="py-1 pr-3 text-muted-foreground">{p.in}</td>
                  <td className="py-1 pr-3 font-mono text-info">{String((p.schema as Record<string, unknown> | undefined)?.type ?? '')}</td>
                  <td className="py-1 text-muted-foreground">{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {op.requestBody && (
        <section>
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
            Request body <span className="font-normal normal-case">({op.requestBody.contentType})</span>
          </h4>
          <SchemaView schema={op.requestBody.schema} rootName="body" />
        </section>
      )}
      <section>
        <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Responses</h4>
        <div className="flex flex-col gap-2">
          {op.responses.map((r) => (
            <div key={r.status} className="rounded-md border p-2">
              <div className="mb-1 flex items-center gap-2 text-xs">
                <Badge variant={r.status.startsWith('2') ? 'success' : r.status.startsWith('4') || r.status.startsWith('5') ? 'destructive' : 'secondary'}>
                  {r.status}
                </Badge>
                <span className="text-muted-foreground">{r.description}</span>
              </div>
              {r.schema && <SchemaView schema={r.schema} rootName="response" />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
