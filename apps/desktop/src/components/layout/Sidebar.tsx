import { useQueryClient } from '@tanstack/react-query';
import { FileCode2Icon, FolderTreeIcon, HistoryIcon, LayersIcon, PlusIcon, SearchIcon, UploadIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { EmptyState, Tooltip } from '@/components/ui/misc';
import { keys, useTree } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useUi, type SidebarSection } from '@/stores/ui';
import { CollectionTree, useTreeActions } from '@/features/collections/CollectionTree';
import { pickFile } from '@/features/collections/transfer';
import { EnvironmentList } from '@/features/environments/EnvironmentList';
import { HistoryList } from '@/features/history/HistoryList';
import { ApiSpecList } from '@/features/openapi/ApiSpecList';

const SECTIONS: { id: SidebarSection; label: string; icon: React.ElementType }[] = [
  { id: 'collections', label: 'Collections', icon: FolderTreeIcon },
  { id: 'apis', label: 'OpenAPI', icon: FileCode2Icon },
  { id: 'environments', label: 'Environments', icon: LayersIcon },
  { id: 'history', label: 'History', icon: HistoryIcon },
];

export function SidebarRail() {
  const { sidebar, setSidebar } = useUi();
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2" aria-label="Sidebar sections">
      {SECTIONS.map((s) => (
        <Tooltip key={s.id} content={s.label} side="right">
          <button
            type="button"
            aria-label={s.label}
            aria-current={sidebar === s.id}
            onClick={() => setSidebar(s.id)}
            className={cn(
              'flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
              sidebar === s.id && 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary',
            )}
          >
            <s.icon className="size-4.5" />
          </button>
        </Tooltip>
      ))}
    </nav>
  );
}

export function SidebarPanel() {
  const sidebar = useUi((s) => s.sidebar);
  const [filter, setFilter] = React.useState('');
  const tree = useTree();
  const actions = useTreeActions();
  const qc = useQueryClient();
  const label = SECTIONS.find((s) => s.id === sidebar)?.label;

  const importCollection = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const c = await api('POST /collections/import', { body: { data: JSON.parse(file.text) } });
      await qc.invalidateQueries({ queryKey: keys.tree });
      toast.success(`Imported "${c.name}"`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-sidebar">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
        {sidebar === 'collections' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="New">
                <PlusIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => actions.newCollection()}>
                <PlusIcon /> New collection
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={importCollection}>
                <UploadIcon /> Import collection…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {(sidebar === 'collections' || sidebar === 'history') && (
        <div className="relative shrink-0 border-b p-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={sidebar === 'history' ? 'Filter history' : 'Filter requests'}
            aria-label="Filter"
            className="h-7 w-full rounded-md bg-muted/60 pr-2 pl-7 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {sidebar === 'collections' &&
          (tree.data?.length ? (
            <CollectionTree tree={tree.data} filter={filter} />
          ) : tree.isLoading ? null : tree.isError ? (
            <EmptyState title="Server unavailable">{errorMessage(tree.error)}</EmptyState>
          ) : (
            <EmptyState icon={<FolderTreeIcon className="size-6" />} title="No collections">
              <Button size="sm" className="mt-2" onClick={() => actions.newCollection()}>
                <PlusIcon /> New collection
              </Button>
            </EmptyState>
          ))}
        {sidebar === 'apis' && <ApiSpecList />}
        {sidebar === 'environments' && <EnvironmentList />}
        {sidebar === 'history' && <HistoryList filter={filter} />}
      </div>
    </div>
  );
}
