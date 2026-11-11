import { CheckCircle2Icon, TriangleAlertIcon } from 'lucide-react';
import type { SendResult } from '@postguy/shared';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';
import { SchemaView } from '@/components/SchemaView';
import { useEffectiveSchema } from '@/features/memory/queries';

export function SchemaTab({ requestId, response }: { requestId: string | null; response: SendResult }) {
  const schema = useEffectiveSchema(requestId);
  if (!requestId) return <EmptyState title="Schema inference">Save the request to remember its responses and infer a schema.</EmptyState>;
  const v = response.validation;
  const expected = schema.data?.expected.find((e) => e.status === String(response.status)) ?? null;

  return (
    <div className="h-full overflow-auto p-3 text-[13px]">
      {v && (
        <div className={`mb-3 rounded-md border p-2 ${v.ok ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/5'}`}>
          <div className="flex items-center gap-2 text-xs font-medium">
            {v.ok ? <CheckCircle2Icon className="size-3.5 text-success" /> : <TriangleAlertIcon className="size-3.5 text-warning" />}
            {v.ok ? 'Response matches the OpenAPI schema' : 'Response does not match the OpenAPI schema'}
            <Badge variant="outline" className="ml-auto font-mono">{v.schemaSource}</Badge>
          </div>
          {v.errors.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 font-mono text-xs">
              {v.errors.map((e, i) => (
                <li key={i}>
                  <span className="text-warning">{e.path}</span> {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
            Inferred <span className="font-normal normal-case">from {schema.data?.snapshotCount ?? 0} successful response(s)</span>
          </h4>
          <SchemaView schema={schema.data?.inferred} rootName="response" />
        </section>
        {expected && (
          <section>
            <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">OpenAPI expected ({expected.status})</h4>
            <SchemaView schema={expected.schema} rootName="response" />
          </section>
        )}
      </div>
    </div>
  );
}
