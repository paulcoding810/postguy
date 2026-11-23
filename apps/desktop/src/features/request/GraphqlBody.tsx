import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenIcon, LoaderIcon, RefreshCwIcon, SearchIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import type { Body, RequestDefinition } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/misc';
import { CodeEditor } from '@/components/CodeEditor';
import { api, errorMessage } from '@/lib/api';
import { monaco, setGraphqlSchema } from '@/lib/monaco';
import { cn, timeAgo } from '@/lib/utils';

/** What the editor needs to fetch the endpoint's schema the way the request is sent. */
export interface GraphqlOwner {
  draft: () => RequestDefinition;
  collectionId: string | null;
  requestId: string | null;
}

type Introspection = { __schema: { queryType?: { name: string } | null; mutationType?: { name: string } | null; types: IType[] } };
interface IType {
  kind: string;
  name: string;
  description?: string | null;
  fields?: { name: string; description?: string | null; args: { name: string; type: IRef }[]; type: IRef }[] | null;
  enumValues?: { name: string }[] | null;
  inputFields?: { name: string; type: IRef }[] | null;
}
interface IRef {
  kind: string;
  name?: string | null;
  ofType?: IRef | null;
}

const typeName = (t: IRef): string => (t.kind === 'NON_NULL' ? `${typeName(t.ofType!)}!` : t.kind === 'LIST' ? `[${typeName(t.ofType!)}]` : (t.name ?? '?'));

const schemaKey = (requestId: string | null) => ['graphql-schema', requestId] as const;

/** The GraphQL body: query, variables and operation name, with completion from the endpoint's schema. */
export function GraphqlBody({ body, onChange, editorPath, owner }: { body: Body; onChange: (b: Body) => void; editorPath: string; owner?: GraphqlOwner }) {
  const qc = useQueryClient();
  const queryPath = `file:///${editorPath.replace(/\.[a-z]+$/, '')}.graphql`;
  const stored = useQuery({
    queryKey: schemaKey(owner?.requestId ?? null),
    queryFn: () => api('GET /requests/:id/graphql-schema', { params: { id: owner!.requestId! } }),
    enabled: !!owner?.requestId,
    staleTime: Infinity,
  });
  const [local, setLocal] = React.useState<{ schema: unknown; fetchedAt: number } | null>(null);
  const current = local ?? stored.data ?? null;
  const [fetching, setFetching] = React.useState(false);
  const [showSchema, setShowSchema] = React.useState(false);

  React.useEffect(() => {
    const uri = monaco.Uri.parse(queryPath).toString();
    setGraphqlSchema(uri, current?.schema ?? null);
    return () => setGraphqlSchema(uri, null);
  }, [queryPath, current?.schema]);

  const fetchSchema = async () => {
    if (!owner) return;
    setFetching(true);
    try {
      const r = await api('POST /graphql/schema', { body: { request: owner.draft(), collectionId: owner.collectionId, requestId: owner.requestId } });
      setLocal(r);
      if (owner.requestId) qc.setQueryData(schemaKey(owner.requestId), r);
      const count = (r.schema as Introspection).__schema.types.filter((t) => !t.name.startsWith('__')).length;
      toast.success(`Schema loaded: ${count} types`, { description: 'Completion and checks now follow it.' });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-1 text-xs">
          <input
            aria-label="Operation name"
            placeholder="Operation name (optional)"
            value={body.operationName ?? ''}
            onChange={(e) => onChange({ ...body, operationName: e.target.value || undefined })}
            className="h-6 w-48 rounded border bg-transparent px-2 font-mono text-[11.5px] outline-none focus:border-ring"
          />
          <span className="ml-auto truncate text-muted-foreground">{current ? `Schema from ${timeAgo(current.fetchedAt)}` : 'No schema yet'}</span>
          {owner && (
            <Tooltip content="Ask the endpoint for its schema, sent like this request (auth, headers, variables)">
              <Button size="xs" variant="ghost" disabled={fetching} onClick={fetchSchema}>
                {fetching ? <LoaderIcon className="animate-spin" /> : <RefreshCwIcon />} {current ? 'Refresh schema' : 'Fetch schema'}
              </Button>
            </Tooltip>
          )}
          <Button size="xs" variant={showSchema ? 'secondary' : 'ghost'} disabled={!current} onClick={() => setShowSchema((s) => !s)}>
            <BookOpenIcon /> Schema
          </Button>
        </div>
        <div className="min-h-0 flex-[2]">
          <CodeEditor path={queryPath} language="graphql" value={body.raw ?? ''} onChange={(raw) => onChange({ ...body, raw })} templates fieldLabel="GraphQL query" />
        </div>
        <div className="border-y px-3 py-1 text-[11px] font-semibold text-muted-foreground uppercase">Variables</div>
        <div className="min-h-0 flex-1">
          <CodeEditor
            path={`file:///${editorPath.replace(/\.[a-z]+$/, '')}.variables.json`}
            language="json"
            value={body.variables ?? ''}
            onChange={(variables) => onChange({ ...body, variables: variables || undefined })}
            templates
            fieldLabel="GraphQL variables"
          />
        </div>
      </div>
      {showSchema && current && <SchemaPanel schema={current.schema as Introspection} onClose={() => setShowSchema(false)} />}
    </div>
  );
}

function SchemaPanel({ schema, onClose }: { schema: Introspection; onClose: () => void }) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState<string | null>(schema.__schema.queryType?.name ?? null);
  const roots = [schema.__schema.queryType?.name, schema.__schema.mutationType?.name].filter((n): n is string => !!n);
  const types = schema.__schema.types
    .filter((t) => !t.name.startsWith('__') && t.kind !== 'SCALAR')
    .sort((a, b) => Number(roots.includes(b.name)) - Number(roots.includes(a.name)) || roots.indexOf(a.name) - roots.indexOf(b.name) || a.name.localeCompare(b.name));
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? types.filter((t) => t.name.toLowerCase().includes(needle) || t.fields?.some((f) => f.name.toLowerCase().includes(needle)))
    : types;
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l" aria-label="GraphQL schema">
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a type or field" aria-label="Find in schema" className="h-6 w-full rounded bg-muted/60 pr-2 pl-6 text-xs outline-none" />
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="Close schema" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1 text-xs">
        {shown.map((t) => {
          const expanded = !!needle || open === t.name;
          const fields: { name: string; description?: string | null; args?: { name: string; type: IRef }[]; type: IRef }[] = t.fields ?? t.inputFields ?? [];
          return (
            <div key={t.name}>
              <button type="button" onClick={() => setOpen(expanded ? null : t.name)} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-accent">
                <span className="w-10 shrink-0 text-[10px] text-muted-foreground lowercase">{roots.includes(t.name) ? 'root' : t.kind.replace('_OBJECT', '').toLowerCase()}</span>
                <span className={cn('truncate font-mono', roots.includes(t.name) && 'font-semibold')}>{t.name}</span>
              </button>
              {expanded && (
                <div className="pb-1 pl-12">
                  {t.description && <p className="pr-2 pb-1 text-[11px] text-muted-foreground">{t.description}</p>}
                  {fields
                    .filter((f) => !needle || t.name.toLowerCase().includes(needle) || f.name.toLowerCase().includes(needle))
                    .map((f) => (
                      <div key={f.name} className="py-0.5 pr-2 font-mono text-[11px]" title={f.description ?? undefined}>
                        {f.name}
                        {f.args && f.args.length > 0 && <span className="text-muted-foreground">({f.args.map((a) => `${a.name}: ${typeName(a.type)}`).join(', ')})</span>}
                        <span className="text-muted-foreground">: </span>
                        <span className="text-info">{typeName(f.type)}</span>
                      </div>
                    ))}
                  {t.enumValues?.map((v) => (
                    <div key={v.name} className="py-0.5 font-mono text-[11px]">
                      {v.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** Switching body mode carries a GraphQL query across: JSON { query, variables } splits into the GraphQL fields and back. */
export function switchBodyMode(body: Body, mode: Body['mode']): Body {
  if (mode === 'graphql' && body.mode === 'json' && body.raw) {
    try {
      const o = JSON.parse(body.raw) as { query?: unknown; variables?: unknown; operationName?: unknown };
      if (typeof o.query === 'string')
        return {
          mode,
          raw: o.query,
          ...(o.variables && typeof o.variables === 'object' ? { variables: JSON.stringify(o.variables, null, 2) } : {}),
          ...(typeof o.operationName === 'string' && o.operationName ? { operationName: o.operationName } : {}),
        };
    } catch {
      /* not a GraphQL payload */
    }
  }
  if (mode === 'json' && body.mode === 'graphql') {
    let variables: unknown;
    try {
      variables = body.variables?.trim() ? JSON.parse(body.variables) : undefined;
    } catch {
      variables = undefined;
    }
    return { mode, raw: JSON.stringify({ query: body.raw ?? '', ...(variables !== undefined && { variables }), ...(body.operationName && { operationName: body.operationName }) }, null, 2) };
  }
  return { ...body, mode, form: body.form ?? [] };
}
