import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FilePlusIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LibraryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SettingsIcon,
  Trash2Icon,
  WorkflowIcon,
} from 'lucide-react';
import { usePendingSteps } from '@/features/flows/pending';
import * as React from 'react';
import { toast } from 'sonner';
import type { CollectionTreeNode } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { confirm, prompt } from '@/components/dialogs';
import { useMoveDialog } from './MoveDialog';
import { orderPatches, reorderIds, type Place } from './reorder';
import { keys } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { isRequestTab, useTabs } from '@/stores/tabs';
import { useCollectionSettings } from './CollectionSettings';
import { downloadJson, downloadText } from './transfer';

const EXPANDED_KEY = 'postguy.tree.expanded';

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

type DragItem = { kind: 'request' | 'collection'; id: string };

export function useTreeActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.tree });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return {
    newCollection: () =>
      run(async () => {
        const name = await prompt({ title: 'New collection', initial: 'My Collection', confirmLabel: 'Create' });
        if (name) await api('POST /collections', { body: { name, parentId: null } });
      }),
    newFolder: (parentId: string) =>
      run(async () => {
        const name = await prompt({ title: 'New folder', initial: 'New Folder', confirmLabel: 'Create' });
        if (name) await api('POST /collections', { body: { name, parentId } });
      }),
    newRequest: (collectionId: string) =>
      run(async () => {
        const saved = await api('POST /requests', {
          body: { collectionId, name: 'New Request', method: 'GET', url: '' },
        });
        useTabs.getState().openRequest(saved, { pin: true });
      }),
    renameCollection: (node: CollectionTreeNode) =>
      run(async () => {
        const name = await prompt({ title: 'Rename', initial: node.name });
        if (name) await api('PATCH /collections/:id', { params: { id: node.id }, body: { name } });
      }),
    deleteCollection: (node: CollectionTreeNode) =>
      run(async () => {
        const ok = await confirm({
          title: `Delete "${node.name}"?`,
          description: 'All folders, requests and response history inside it are deleted.',
          destructive: true,
          confirmLabel: 'Delete',
        });
        if (!ok) return;
        const ids = collectRequestIds(node);
        await api('DELETE /collections/:id', { params: { id: node.id } });
        ids.forEach((id) => useTabs.getState().onRequestDeleted(id));
      }),
    exportCollection: (node: CollectionTreeNode) =>
      run(async () => {
        const data = await api('GET /collections/:id/export', { params: { id: node.id } });
        await downloadJson(`${node.name}.postguy.json`, data);
      }),
    exportOpenApi: (node: CollectionTreeNode, format: 'json' | 'yaml') =>
      run(async () => {
        const data: unknown = await api('GET /collections/:id/export/openapi', { params: { id: node.id }, query: { format } });
        const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        await downloadText(`${node.name}.openapi.${format}`, text, format === 'json' ? 'application/json' : 'application/yaml');
      }),
    flowFromFolder: (node: CollectionTreeNode) =>
      run(async () => {
        const choices = collectRequests(node).map((r) => ({ kind: 'request' as const, requestId: r.id, name: r.name }));
        if (!choices.length) {
          toast.message('This folder has no requests yet');
          return;
        }
        const flow = await api('POST /flows', { body: { name: node.name, collectionId: node.id } });
        usePendingSteps.getState().queue(flow.id, choices);
        await qc.invalidateQueries({ queryKey: ['flows'] });
        useTabs.getState().openFlow(flow);
      }),
    renameRequest: (id: string, current: string) =>
      run(async () => {
        const name = await prompt({ title: 'Rename request', initial: current });
        if (!name) return;
        await api('PATCH /requests/:id', { params: { id }, body: { name } });
        useTabs.getState().onRequestRenamed(id, name);
      }),
    duplicateRequest: (id: string) =>
      run(async () => {
        const saved = await api('POST /requests/:id/duplicate', { params: { id }, body: {} });
        useTabs.getState().openRequest(saved, { pin: true });
      }),
    deleteRequest: (id: string, name: string) =>
      run(async () => {
        if (!(await confirm({ title: `Delete "${name}"?`, destructive: true, confirmLabel: 'Delete' }))) return;
        await api('DELETE /requests/:id', { params: { id } });
        useTabs.getState().onRequestDeleted(id);
      }),
    move: (item: DragItem, targetCollectionId: string) =>
      run(async () => {
        if (item.kind === 'request') {
          await api('PATCH /requests/:id', { params: { id: item.id }, body: { collectionId: targetCollectionId } });
          useTabs.getState().onRequestMoved(item.id, targetCollectionId);
        } else if (item.id !== targetCollectionId) {
          await api('PATCH /collections/:id', { params: { id: item.id }, body: { parentId: targetCollectionId } });
        }
      }),
    placeRequest: (requestId: string, folder: CollectionTreeNode, targetId: string, place: Place) =>
      run(async () => {
        const moved = !folder.requests.some((r) => r.id === requestId);
        const ordered = reorderIds(folder.requests.map((r) => r.id), requestId, targetId, place);
        for (const p of orderPatches(ordered, folder.requests, moved ? requestId : undefined))
          await api('PATCH /requests/:id', { params: { id: p.id }, body: { sortOrder: p.sortOrder, ...(p.id === requestId && moved && { collectionId: folder.id }) } });
        if (moved) useTabs.getState().onRequestMoved(requestId, folder.id);
      }),
  };
}

/** Requests in the order the sidebar shows them: sub-folders first, then the folder's own. */
function collectRequests(node: CollectionTreeNode): CollectionTreeNode['requests'] {
  return [...node.children.flatMap(collectRequests), ...node.requests];
}

function collectRequestIds(node: CollectionTreeNode): string[] {
  return [...node.requests.map((r) => r.id), ...node.children.flatMap(collectRequestIds)];
}

function matches(node: CollectionTreeNode, q: string): boolean {
  if (!q) return true;
  if (node.name.toLowerCase().includes(q)) return true;
  if (node.requests.some((r) => r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q))) return true;
  return node.children.some((c) => matches(c, q));
}

export function CollectionTree({ tree, filter }: { tree: CollectionTreeNode[]; filter: string }) {
  const [expanded, setExpanded] = React.useState(loadExpanded);
  const actions = useTreeActions();
  const q = filter.trim().toLowerCase();

  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
      return next;
    });

  return (
    <div className="py-1" role="tree">
      {tree.filter((n) => matches(n, q)).map((n) => (
        <FolderNode key={n.id} node={n} depth={0} expanded={expanded} toggle={toggle} actions={actions} q={q} />
      ))}
    </div>
  );
}

function FolderNode({
  node,
  depth,
  expanded,
  toggle,
  actions,
  q,
}: {
  node: CollectionTreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string, open?: boolean) => void;
  actions: ReturnType<typeof useTreeActions>;
  q: string;
}) {
  const isOpen = q ? true : expanded.has(node.id);
  const [dragOver, setDragOver] = React.useState(false);
  const openSettings = useCollectionSettings((s) => s.open);
  const Icon = node.kind === 'collection' ? LibraryIcon : isOpen ? FolderOpenIcon : FolderIcon;

  const menuItems = (Item: typeof ContextMenuItem, Sep: typeof ContextMenuSeparator) => (
    <>
      <Item onSelect={() => actions.newRequest(node.id)}>
        <FilePlusIcon /> New request
      </Item>
      <Item onSelect={() => actions.newFolder(node.id)}>
        <FolderPlusIcon /> New folder
      </Item>
      <Item onSelect={() => actions.flowFromFolder(node)}>
        <WorkflowIcon /> Create flow from {node.kind === 'collection' ? 'collection' : 'folder'}
      </Item>
      <Sep />
      <Item onSelect={() => openSettings(node.id)}>
        <SettingsIcon /> Settings, auth & variables
      </Item>
      <Item onSelect={() => actions.renameCollection(node)}>
        <PencilIcon /> Rename
      </Item>
      <Item onSelect={() => useMoveDialog.getState().open({ kind: 'collection', id: node.id, name: node.name, parentId: node.parentId })}>
        <FolderInputIcon /> Move to…
      </Item>
      {node.kind === 'collection' && (
        <>
          <Item onSelect={() => actions.exportCollection(node)}>
            <DownloadIcon /> Export collection
          </Item>
          <Item onSelect={() => actions.exportOpenApi(node, 'yaml')}>
            <DownloadIcon /> Export as OpenAPI (YAML)
          </Item>
          <Item onSelect={() => actions.exportOpenApi(node, 'json')}>
            <DownloadIcon /> Export as OpenAPI (JSON)
          </Item>
        </>
      )}
      <Sep />
      <Item variant="destructive" onSelect={() => actions.deleteCollection(node)}>
        <Trash2Icon /> Delete
      </Item>
    </>
  );

  return (
    <div role="treeitem" aria-expanded={isOpen}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/x-postguy', JSON.stringify({ kind: 'collection', id: node.id }))}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/x-postguy')) {
                e.preventDefault();
                setDragOver(true);
              }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const item = JSON.parse(e.dataTransfer.getData('application/x-postguy')) as DragItem;
              void actions.move(item, node.id);
              toggle(node.id, true);
            }}
            onClick={() => toggle(node.id)}
            style={{ paddingLeft: 6 + depth * 12 }}
            className={cn(
              'group flex h-7 cursor-pointer items-center gap-1 pr-1 text-[13px] select-none hover:bg-accent',
              dragOver && 'bg-primary/15 ring-1 ring-primary ring-inset',
            )}
          >
            <ChevronRightIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
            <Icon className={cn('size-3.5 shrink-0', node.kind === 'collection' ? 'text-primary' : 'text-muted-foreground')} />
            <span className={cn('truncate', node.kind === 'collection' && 'font-medium')}>{node.name}</span>
            {node.openapiSpecId && <span className="rounded bg-info/15 px-1 text-[10px] text-info">API</span>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon-xs" className="ml-auto opacity-0 group-hover:opacity-100" aria-label="Folder actions">
                  <MoreHorizontalIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                {menuItems(DropdownMenuItem as typeof ContextMenuItem, DropdownMenuSeparator as typeof ContextMenuSeparator)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>{menuItems(ContextMenuItem, ContextMenuSeparator)}</ContextMenuContent>
      </ContextMenu>
      {isOpen && (
        <div role="group">
          {node.children
            .filter((c) => matches(c, q))
            .map((c) => (
              <FolderNode key={c.id} node={c} depth={depth + 1} expanded={expanded} toggle={toggle} actions={actions} q={q} />
            ))}
          {node.requests
            .filter((r) => !q || r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q) || node.name.toLowerCase().includes(q))
            .map((r) => (
              <RequestRow key={r.id} request={r} folder={node} depth={depth + 1} actions={actions} />
            ))}
          {node.children.length === 0 && node.requests.length === 0 && (
            <div style={{ paddingLeft: 30 + depth * 12 }} className="py-1 text-xs text-muted-foreground">
              Empty.{' '}
              <button type="button" className="text-primary hover:underline" onClick={() => actions.newRequest(node.id)}>
                Add a request
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RequestRow({
  request,
  folder,
  depth,
  actions,
}: {
  request: CollectionTreeNode['requests'][number];
  folder: CollectionTreeNode;
  depth: number;
  actions: ReturnType<typeof useTreeActions>;
}) {
  const active = useTabs((s) => {
    const t = s.tabs.find((x) => x.id === s.activeId);
    return isRequestTab(t) && t.requestId === request.id;
  });
  const [dropAt, setDropAt] = React.useState<Place | null>(null);
  const index = folder.requests.findIndex((r) => r.id === request.id);
  const open = async (pin: boolean) => {
    try {
      const saved = await api('GET /requests/:id', { params: { id: request.id } });
      useTabs.getState().openRequest(saved, { pin });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-postguy', JSON.stringify({ kind: 'request', id: request.id }));
            e.dataTransfer.setData('application/x-postguy-request', request.id);
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('application/x-postguy-request')) return;
            e.preventDefault();
            e.stopPropagation();
            const box = e.currentTarget.getBoundingClientRect();
            setDropAt(e.clientY < box.top + box.height / 2 ? 'before' : 'after');
          }}
          onDragLeave={() => setDropAt(null)}
          onDrop={(e) => {
            const id = e.dataTransfer.getData('application/x-postguy-request');
            const place = dropAt;
            setDropAt(null);
            if (!id || !place) return;
            e.preventDefault();
            e.stopPropagation();
            void actions.placeRequest(id, folder, request.id, place);
          }}
          onClick={() => open(false)}
          onDoubleClick={() => open(true)}
          style={{ paddingLeft: 22 + depth * 12 }}
          className={cn('group relative flex h-7 cursor-pointer items-center gap-2 pr-1 text-[13px] select-none hover:bg-accent', active && 'bg-accent')}
        >
          {dropAt && <span className={cn('pointer-events-none absolute inset-x-0 h-0.5 bg-primary', dropAt === 'before' ? 'top-0' : 'bottom-0')} />}
          <span className={cn('w-11 shrink-0 text-right font-mono text-[10px] font-bold', `method-${request.method}`)}>
            {request.method === 'DELETE' ? 'DEL' : request.method === 'OPTIONS' ? 'OPT' : request.method}
          </span>
          <span className="truncate">{request.name}</span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => open(true)}>Open in tab</ContextMenuItem>
        <ContextMenuItem onSelect={() => useMoveDialog.getState().open({ kind: 'request', id: request.id, name: request.name, parentId: folder.id })}>
          <FolderInputIcon /> Move to…
        </ContextMenuItem>
        <ContextMenuItem disabled={index <= 0} onSelect={() => actions.placeRequest(request.id, folder, folder.requests[index - 1]!.id, 'before')}>
          <ArrowUpIcon /> Move up
        </ContextMenuItem>
        <ContextMenuItem disabled={index >= folder.requests.length - 1} onSelect={() => actions.placeRequest(request.id, folder, folder.requests[index + 1]!.id, 'after')}>
          <ArrowDownIcon /> Move down
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.renameRequest(request.id, request.name)}>
          <PencilIcon /> Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.duplicateRequest(request.id)}>
          <CopyIcon /> Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => actions.deleteRequest(request.id, request.name)}>
          <Trash2Icon /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
