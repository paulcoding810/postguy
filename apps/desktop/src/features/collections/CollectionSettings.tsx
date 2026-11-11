import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import type { Auth } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { keys, useInvalidateVariables, useTree } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { AuthEditor } from '@/features/request/AuthEditor';
import { VariablesTable } from '@/features/environments/VariablesTable';
import { PRECEDENCE_HINT } from '@/features/environments/EnvironmentManager';
import { TemplateProvider } from '@/features/template/TemplateProvider';
import { blankRequest } from '@/stores/tabs';
import { findNode, inheritedAuthSource } from './treeUtils';

export const useCollectionSettings = create<{ id: string | null; tab: string; open: (id: string, tab?: string) => void; close: () => void }>(
  (set) => ({
    id: null,
    tab: 'overview',
    open: (id, tab = 'overview') => set({ id, tab }),
    close: () => set({ id: null }),
  }),
);

export function CollectionSettings() {
  const { id, tab, close } = useCollectionSettings();
  const tree = useTree();
  const qc = useQueryClient();
  const invalidateVars = useInvalidateVariables();
  const node = id ? findNode(tree.data, id) : null;
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [auth, setAuth] = React.useState<Auth>({ type: 'none' });

  React.useEffect(() => {
    if (node) {
      setName(node.name);
      setDescription(node.description ?? '');
      setAuth(node.auth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);

  const save = async () => {
    if (!node) return;
    try {
      await api('PATCH /collections/:id', { params: { id: node.id }, body: { name, description: description || null, auth } });
      await qc.invalidateQueries({ queryKey: keys.tree });
      invalidateVars();
      toast.success('Saved');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog open={!!node} onOpenChange={(o) => !o && close()}>
      {node && (
        <DialogContent className="flex h-[70vh] flex-col gap-0 p-0 sm:max-w-3xl">
          <DialogHeader className="border-b p-4">
            <DialogTitle>{node.kind === 'collection' ? 'Collection' : 'Folder'} settings</DialogTitle>
            <DialogDescription>{node.name}</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue={tab} className="flex min-h-0 flex-1 flex-col">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="auth">Auth</TabsTrigger>
              <TabsTrigger value="variables">Variables</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="flex flex-col gap-3 overflow-auto p-4">
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Description</Label>
                <Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div>
                <Button onClick={save}>Save</Button>
              </div>
            </TabsContent>
            <TabsContent value="auth" className="overflow-auto">
              <TemplateProvider draft={{ ...blankRequest(), auth }} collectionId={node.id} requestId={null}>
                <AuthEditor
                  auth={auth}
                  onChange={setAuth}
                  allowInherit={node.kind === 'folder'}
                  inheritedFrom={inheritedAuthSource(tree.data, node.parentId)}
                />
              </TemplateProvider>
              <div className="px-4 pb-4">
                <Button onClick={save}>Save auth</Button>
                <p className="mt-2 text-xs text-muted-foreground">Requests set to “Inherit” use this auth.</p>
              </div>
            </TabsContent>
            <TabsContent value="variables" className="flex min-h-0 flex-col p-4">
              <VariablesTable scope="collection" ownerId={node.id} hint={PRECEDENCE_HINT} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      )}
    </Dialog>
  );
}
