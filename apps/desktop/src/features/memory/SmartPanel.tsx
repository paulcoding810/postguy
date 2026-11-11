import { useQueryClient } from '@tanstack/react-query';
import { BrainIcon, ChevronLeftIcon, ListTreeIcon, PinIcon, PinOffIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import type { ReferenceSource } from '@postguy/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Tooltip } from '@/components/ui/misc';
import { SchemaView } from '@/components/SchemaView';
import { api, errorMessage } from '@/lib/api';
import { cn, statusTone, timeAgo } from '@/lib/utils';
import { useActiveTab } from '@/stores/tabs';
import { useInsertTarget } from '@/features/template/TemplateContext';
import { JsonTree } from './JsonTree';
import { useEffectiveSchema, useReferenceSources, useSnapshot, useSnapshots } from './queries';
import { refFor } from './refs';

export function SmartPanel() {
  const tab = useActiveTab();
  const collectionId = tab?.collectionId ?? null;
  const sources = useReferenceSources(collectionId);
  const [selected, setSelected] = React.useState<string | null>(null);
  const source = sources.data?.find((s) => s.requestId === selected) ?? null;

  return (
    <div className="flex h-full min-w-0 flex-col bg-sidebar">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        {source && (
          <Button variant="ghost" size="icon-xs" onClick={() => setSelected(null)} aria-label="Back">
            <ChevronLeftIcon />
          </Button>
        )}
        <span className="truncate px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {source ? source.name : 'Smart data'}
        </span>
      </div>
      {source ? <SourceDetail source={source} /> : <SourceList sources={sources.data ?? []} onSelect={setSelected} loading={sources.isLoading} />}
    </div>
  );
}

function SourceList({ sources, onSelect, loading }: { sources: ReferenceSource[]; onSelect: (id: string) => void; loading: boolean }) {
  if (!sources.length && !loading) {
    return (
      <EmptyState icon={<BrainIcon className="size-6" />} title="No remembered responses">
        Send a saved request that returns JSON. Its response is remembered and can be referenced from other requests.
      </EmptyState>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-1">
      <p className="px-2 py-1.5 text-[11px] text-muted-foreground">Previous API responses. Requests in the current collection come first.</p>
      {sources.map((s) => (
        <button
          key={s.requestId}
          type="button"
          onClick={() => onSelect(s.requestId)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        >
          <span className={cn('w-10 shrink-0 font-mono text-[10px] font-bold', `method-${s.method}`)}>{s.method}</span>
          <span className={cn('truncate', s.shadowed && 'text-muted-foreground line-through')}>{s.name}</span>
          {s.pinned && <PinIcon className="size-3 shrink-0 text-primary" />}
          {s.shadowed && (
            <Tooltip content="Another request with the same name is used for references">
              <TriangleAlertIcon className="size-3 shrink-0 text-warning" />
            </Tooltip>
          )}
          {s.snapshot && (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={statusTone(s.snapshot.status)}>{s.snapshot.status}</span>
              {timeAgo(s.snapshot.createdAt)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function SourceDetail({ source }: { source: ReferenceSource }) {
  const qc = useQueryClient();
  const snapshots = useSnapshots(source.requestId);
  const [snapshotId, setSnapshotId] = React.useState<string | null>(null);
  const activeId = snapshotId ?? source.snapshot?.id ?? null;
  const snapshot = useSnapshot(activeId);
  const schema = useEffectiveSchema(source.requestId);
  const [view, setView] = React.useState<'tree' | 'schema'>('tree');
  const [filter, setFilter] = React.useState('');
  const target = useInsertTarget((s) => s.last);
  const referenced = source.snapshot?.id;

  const insert = (path: string) => {
    if (!target) return toast.message('Click into a field of the request first');
    target.insert(`{{${refFor(source.name, path)}}}`);
    toast.success(`Inserted into ${target.label}`);
  };
  const copy = (path: string) =>
    navigator.clipboard.writeText(`{{${refFor(source.name, path)}}}`).then(() => toast.success('Reference copied'));

  const pin = async (id: string | null) => {
    try {
      await api('POST /requests/:id/pin-snapshot', { params: { id: source.requestId }, body: { snapshotId: id } });
      await qc.invalidateQueries({ queryKey: ['reference-sources'] });
      await qc.invalidateQueries({ queryKey: ['preview'] });
      toast.success(id ? 'References now use this snapshot' : 'References use the latest successful response');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b p-2">
        <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground uppercase">
          Snapshots
          {source.pinned && (
            <button type="button" className="flex items-center gap-1 normal-case hover:text-foreground" onClick={() => pin(null)}>
              <PinOffIcon className="size-3" /> Unpin
            </button>
          )}
        </div>
        <div className="flex max-h-28 flex-col overflow-auto">
          {snapshots.data?.map((s) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => setSnapshotId(s.id)}
              onKeyDown={(e) => e.key === 'Enter' && setSnapshotId(s.id)}
              className={cn('group flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-xs hover:bg-accent', activeId === s.id && 'bg-accent')}
            >
              <span className={cn('font-mono', statusTone(s.status))}>{s.status}</span>
              <span className="text-muted-foreground">{new Date(s.createdAt).toLocaleString()}</span>
              {s.id === referenced && <Badge variant={source.pinned ? 'default' : 'success'}>{source.pinned ? 'pinned' : 'latest ok'}</Badge>}
              {s.id !== referenced && s.isSuccess && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void pin(s.id);
                  }}
                  className="ml-auto hidden text-muted-foreground group-hover:block hover:text-foreground"
                  aria-label="Pin snapshot"
                >
                  <PinIcon className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <button type="button" onClick={() => setView('tree')} className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 text-xs', view === 'tree' ? 'bg-secondary' : 'text-muted-foreground')}>
          <ListTreeIcon className="size-3" /> Data
        </button>
        <button type="button" onClick={() => setView('schema')} className={cn('rounded px-1.5 py-0.5 text-xs', view === 'schema' ? 'bg-secondary' : 'text-muted-foreground')}>
          Schema
        </button>
        {view === 'tree' && (
          <div className="relative ml-auto w-36">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter paths"
              className="h-6 w-full rounded bg-muted/60 pr-1 pl-5 text-xs outline-none"
            />
          </div>
        )}
      </div>
      {view === 'tree' && (
        <p className="shrink-0 border-b px-2 py-1 text-[11px] text-muted-foreground">
          {target ? (
            <>
              Inserting into <span className="font-medium text-foreground">{target.label}</span>. Double-click a value or use ↵.
            </>
          ) : (
            'Click a field in the request, then pick a value here.'
          )}
          {activeId !== referenced && <span className="block text-warning">Viewing an older snapshot; references use the {source.pinned ? 'pinned' : 'latest successful'} one.</span>}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'tree' ? (
          snapshot.data ? (
            <JsonTree value={snapshot.data.body} onInsert={insert} onCopy={copy} canInsert={!!target} filter={filter} />
          ) : null
        ) : (
          <div className="p-2">
            <p className="mb-2 text-[11px] text-muted-foreground">Inferred from {schema.data?.snapshotCount ?? 0} successful response(s). Values are not part of the schema.</p>
            <SchemaView schema={schema.data?.inferred} rootName="response" />
          </div>
        )}
      </div>
    </div>
  );
}
