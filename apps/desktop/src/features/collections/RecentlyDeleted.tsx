import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcwIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { keys } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { changeKeys } from './ChangeHistory';

/** A link under the collections, shown only when there are deleted collections that can come back. */
export function RecentlyDeleted() {
  const qc = useQueryClient();
  const deleted = useQuery({ queryKey: changeKeys.deleted, queryFn: () => api('GET /changes/deleted') });
  const [open, setOpen] = React.useState(false);
  const list = deleted.data ?? [];
  if (!list.length) return null;

  const restore = async (id: string) => {
    try {
      const { message } = await api('POST /changes/:id/restore', { params: { id } });
      toast.success(message);
      await Promise.all([qc.invalidateQueries({ queryKey: ['changes'] }), qc.invalidateQueries({ queryKey: keys.tree })]);
      if (list.length === 1) setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground">
        <Trash2Icon className="size-3" /> Recently deleted ({list.length})
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Recently deleted collections</DialogTitle>
            <DialogDescription>Bring one back with its folders, requests, variables and scripts. Deleted folders and requests are in their collection's history.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col">
            {list.map((c) => (
              <div key={c.id} className="flex items-center gap-2 border-b py-2 text-sm last:border-b-0">
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                <span className="text-xs text-muted-foreground">{timeAgo(c.updatedAt)}</span>
                <Button size="xs" variant="outline" onClick={() => restore(c.id)}>
                  <RotateCcwIcon /> Bring back
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
