import { useQueryClient } from '@tanstack/react-query';
import { FolderIcon, LibraryIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import type { CollectionTreeNode } from '@postguy/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { keys, useTree } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useTabs } from '@/stores/tabs';

export interface MoveTarget {
  kind: 'request' | 'collection';
  id: string;
  name: string;
  /** Where the item lives now; not offered as a destination. */
  parentId: string | null;
}

export const useMoveDialog = create<{ item: MoveTarget | null; open: (item: MoveTarget) => void; close: () => void }>((set) => ({
  item: null,
  open: (item) => set({ item }),
  close: () => set({ item: null }),
}));

function destinations(tree: CollectionTreeNode[], skip: string | null): { node: CollectionTreeNode; depth: number }[] {
  const out: { node: CollectionTreeNode; depth: number }[] = [];
  const walk = (n: CollectionTreeNode, depth: number) => {
    if (n.id === skip) return;
    out.push({ node: n, depth });
    n.children.forEach((c) => walk(c, depth + 1));
  };
  tree.forEach((n) => walk(n, 0));
  return out;
}

export function MoveDialog() {
  const { item, close } = useMoveDialog();
  const tree = useTree();
  const qc = useQueryClient();
  const [q, setQ] = React.useState('');
  React.useEffect(() => setQ(''), [item]);
  if (!item) return null;

  const list = destinations(tree.data ?? [], item.kind === 'collection' ? item.id : null).filter(({ node }) => !q || node.name.toLowerCase().includes(q.toLowerCase()));
  const move = async (parentId: string | null, label: string) => {
    try {
      if (item.kind === 'request') {
        await api('PATCH /requests/:id', { params: { id: item.id }, body: { collectionId: parentId! } });
        useTabs.getState().onRequestMoved(item.id, parentId!);
      }
      else await api('PATCH /collections/:id', { params: { id: item.id }, body: { parentId } });
      await qc.invalidateQueries({ queryKey: keys.tree });
      toast.success(`Moved "${item.name}" to ${label}`);
      close();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const row = 'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] hover:bg-accent disabled:pointer-events-none disabled:opacity-50';

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move “{item.name}”</DialogTitle>
          <DialogDescription>Pick a collection or folder. You can also drag items onto a folder in the sidebar.</DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter folders"
          className="h-8 rounded-md border bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="max-h-80 overflow-auto">
          {item.kind === 'collection' && !q && (
            <button type="button" className={row} disabled={item.parentId === null} onClick={() => move(null, 'the top level')}>
              <LibraryIcon className="size-3.5 text-primary" /> Top level (its own collection)
            </button>
          )}
          {list.map(({ node, depth }) => {
            const Icon = node.kind === 'collection' ? LibraryIcon : FolderIcon;
            return (
              <button key={node.id} type="button" className={row} style={{ paddingLeft: 8 + depth * 14 }} disabled={node.id === item.parentId} onClick={() => move(node.id, `"${node.name}"`)}>
                <Icon className={cn('size-3.5 shrink-0', node.kind === 'collection' ? 'text-primary' : 'text-muted-foreground')} />
                <span className="truncate">{node.name}</span>
                {node.id === item.parentId && <span className="ml-auto text-[11px] text-muted-foreground">current</span>}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
