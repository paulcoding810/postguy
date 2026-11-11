import { useQueryClient } from '@tanstack/react-query';
import { FolderIcon, FolderPlusIcon, LibraryIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { prompt } from '@/components/dialogs';
import { keys, useTree } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useTabs } from '@/stores/tabs';
import { flattenFolders } from '@/features/collections/treeUtils';
import { useSaveDialog } from './actions';

export function SaveDialog() {
  const { tabId, close } = useSaveDialog();
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  const tree = useTree();
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [target, setTarget] = React.useState<string | null>(null);
  const folders = flattenFolders(tree.data);

  React.useEffect(() => {
    if (tab) {
      setName(tab.draft.name);
      setTarget(tab.collectionId ?? folders[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  const newCollection = async () => {
    const n = await prompt({ title: 'New collection', initial: 'My Collection', confirmLabel: 'Create' });
    if (!n) return;
    const c = await api('POST /collections', { body: { name: n, parentId: null } });
    await qc.invalidateQueries({ queryKey: keys.tree });
    setTarget(c.id);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tab || !target || !name.trim()) return;
    try {
      const saved = await api('POST /requests', { body: { ...tab.draft, name: name.trim(), collectionId: target } });
      useTabs.getState().markSaved(tab.id, saved);
      await qc.invalidateQueries({ queryKey: keys.tree });
      toast.success(`Saved "${saved.name}"`);
      close();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={!!tab} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Save request</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center">
              <Label>Save to</Label>
              <Button type="button" variant="ghost" size="xs" className="ml-auto" onClick={newCollection}>
                <FolderPlusIcon /> New collection
              </Button>
            </div>
            <div className="max-h-64 overflow-auto rounded-md border p-1">
              {folders.length === 0 && <p className="p-3 text-xs text-muted-foreground">Create a collection first.</p>}
              {folders.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  onClick={() => setTarget(f.id)}
                  style={{ paddingLeft: 8 + f.depth * 14 }}
                  className={cn('flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-[13px] hover:bg-accent', target === f.id && 'bg-primary/15 text-primary')}
                >
                  {f.kind === 'collection' ? <LibraryIcon className="size-3.5" /> : <FolderIcon className="size-3.5" />}
                  {f.name}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!target || !name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
