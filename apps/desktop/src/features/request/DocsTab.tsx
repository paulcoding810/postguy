import { useQuery } from '@tanstack/react-query';
import { BookOpenIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';
import { SchemaView } from '@/components/SchemaView';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export function useOperation(requestId: string | null) {
  return useQuery({
    queryKey: ['operation', requestId],
    queryFn: () => api('GET /requests/:id/operation', { params: { id: requestId! } }),
    enabled: !!requestId,
    staleTime: 60_000,
  });
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
