import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCode2Icon, FolderTreeIcon, LinkIcon, PlusIcon, ShieldIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/misc';
import { confirm } from '@/components/dialogs';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { useImportDialog } from './ImportDialog';
import { SyncPanel } from './SyncPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function useSpecs() {
  return useQuery({ queryKey: ['openapi'], queryFn: () => api('GET /openapi') });
}

export function ApiSpecList() {
  const specs = useSpecs();
  const setOpen = useImportDialog((s) => s.setOpen);
  const [selected, setSelected] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col p-2">
      <Button size="sm" className="mb-2" onClick={() => setOpen(true)}>
        <PlusIcon /> Import OpenAPI
      </Button>
      {!specs.data?.length && (
        <EmptyState icon={<FileCode2Icon className="size-6" />} title="No specifications">
          Import a spec to generate requests automatically.
        </EmptyState>
      )}
      {specs.data?.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setSelected(s.id)}
          className="flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
        >
          <span className="flex items-center gap-1.5 text-[13px] font-medium">
            <FileCode2Icon className="size-3.5 text-info" /> {s.name}
          </span>
          <span className="pl-5 text-[11px] text-muted-foreground">
            {s.sourceType === 'url' ? s.sourceUrl : s.sourceType} · {timeAgo(s.createdAt)}
          </span>
        </button>
      ))}
      <SpecDetail id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function SpecDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['openapi', id],
    queryFn: () => api('GET /openapi/:id', { params: { id: id! } }),
    enabled: !!id,
  });
  const m = detail.data?.model;

  const remove = async () => {
    if (!detail.data) return;
    const ok = await confirm({
      title: 'Remove specification?',
      description: 'The generated collection and its requests are kept.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await api('DELETE /openapi/:id', { params: { id: detail.data.id } });
    await qc.invalidateQueries({ queryKey: ['openapi'] });
    await qc.invalidateQueries({ queryKey: ['tree'] });
    onClose();
  };

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[75vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle className="flex items-center gap-2">
            {m?.title ?? 'Specification'} {m && <Badge variant="secondary">v{m.version}</Badge>}
            {m && (
              <Badge variant="outline">
                {m.specVersion.startsWith('2') ? 'Swagger' : 'OpenAPI'} {m.specVersion}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="line-clamp-2">{m?.description ?? ''}</DialogDescription>
        </DialogHeader>
        {m && detail.data && (
          <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="sync">Sync &amp; versions</TabsTrigger>
            </TabsList>
            <TabsContent value="sync" className="overflow-auto p-4">
              <SyncPanel spec={detail.data} />
            </TabsContent>
            <TabsContent value="overview" className="overflow-auto">
              <div className="p-4 text-[13px]">
                <div className="mb-4 grid gap-3 sm:grid-cols-2">
                  <section>
                    <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase">
                      <LinkIcon className="size-3" /> Servers
                    </h4>
                    {m.servers.length ? (
                      m.servers.map((s) => (
                        <div key={s.url} className="font-mono text-xs">
                          {s.url}
                        </div>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </section>
                  <section>
                    <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase">
                      <ShieldIcon className="size-3" /> Security schemes
                    </h4>
                    {m.securitySchemes.length ? (
                      m.securitySchemes.map((s) => (
                        <div key={s.name} className="text-xs">
                          <span className="font-mono">{s.name}</span>{' '}
                          <span className="text-muted-foreground">
                            {[s.type, s.scheme, s.in].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </section>
                </div>
                <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                  Operations ({m.operations.length})
                </h4>
                <div className="rounded-md border">
                  {m.operations.map((o) => (
                    <div key={o.id} className="flex items-center gap-3 border-b px-3 py-1.5 last:border-b-0">
                      <span className={cn('w-14 font-mono text-[11px] font-bold', `method-${o.method}`)}>
                        {o.method}
                      </span>
                      <span className={cn('font-mono text-xs', o.deprecated && 'line-through opacity-60')}>
                        {o.path}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{o.summary}</span>
                      {o.tags[0] && (
                        <Badge variant="outline" className="ml-auto">
                          {o.tags[0]}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
        <div className="flex gap-2 border-t p-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              useUi.getState().setSidebar('collections');
              onClose();
            }}
          >
            <FolderTreeIcon /> Show collection
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={remove}>
            <Trash2Icon /> Remove spec
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
