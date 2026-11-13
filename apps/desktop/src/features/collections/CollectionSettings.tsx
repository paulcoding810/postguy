import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import type { Auth, Scripts } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { ScriptEditor, useRequestScriptTypes } from '@/components/ScriptEditor';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { keys, useEnvironments, useInvalidateVariables, useTree, useVariables } from '@/hooks/queries';
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
  const activeEnv = useEnvironments().data?.find((e) => e.kind === 'environment' && e.isActive) ?? null;
  const envVars = useVariables('environment', activeEnv?.id);
  const overrideNote = (key: string) => {
    const hidden = envVars.data?.find((v) => v.enabled && v.key === key);
    return hidden && activeEnv
      ? `Requests in this collection use this value, not "${activeEnv.name}"'s ${key} (${hidden.isSecret ? 'secret' : hidden.value}). Untick it to use the environment's.`
      : null;
  };
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [auth, setAuth] = React.useState<Auth>({ type: 'none' });
  const [scripts, setScripts] = React.useState<Scripts>({ pre: '', post: '' });
  const [phase, setPhase] = React.useState<'pre' | 'post'>('pre');
  const preTypes = useRequestScriptTypes(node?.id ?? null, null, 'pre', '');
  const postTypes = useRequestScriptTypes(node?.id ?? null, null, 'post', '');

  React.useEffect(() => {
    if (node) {
      setName(node.name);
      setDescription(node.description ?? '');
      setAuth(node.auth);
      setScripts({ pre: node.scripts?.pre ?? '', post: node.scripts?.post ?? '' });
    }
  }, [node?.id]);

  const save = async () => {
    if (!node) return;
    try {
      await api('PATCH /collections/:id', { params: { id: node.id }, body: { name, description: description || null, auth, scripts } });
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
              <TabsTrigger value="scripts">
                Scripts {(scripts.pre.trim() || scripts.post.trim()) && <span className="size-1.5 rounded-full bg-success" />}
              </TabsTrigger>
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
                  tokenContext={{ collectionId: node.id, requestId: null }}
                />
              </TemplateProvider>
              <div className="px-4 pb-4">
                <Button onClick={save}>Save auth</Button>
                <p className="mt-2 text-xs text-muted-foreground">Requests set to “Inherit” use this auth.</p>
              </div>
            </TabsContent>
            <TabsContent value="scripts" className="flex min-h-0 flex-col">
              <div className="flex items-center gap-2 border-b px-4 py-2">
                {(['pre', 'post'] as const).map((p) => (
                  <Button key={p} size="xs" variant={phase === p ? 'secondary' : 'ghost'} onClick={() => setPhase(p)}>
                    {p === 'pre' ? 'Pre-request' : 'Post-response'}
                    {scripts[p].trim() && <span className="size-1.5 rounded-full bg-success" />}
                  </Button>
                ))}
                <p className="ml-2 min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  Runs around every request in this {node.kind === 'collection' ? 'collection' : 'folder'}: outer collections and folders first, then the request.
                </p>
                <Button size="sm" onClick={save}>
                  Save scripts
                </Button>
              </div>
              <div className="min-h-0 flex-1">
                <ScriptEditor
                  key={`${node.id}:${phase}`}
                  value={scripts[phase]}
                  onChange={(v) => setScripts((s) => ({ ...s, [phase]: v }))}
                  phase={phase}
                  types={phase === 'pre' ? preTypes : postTypes}
                  path={`collection-${node.id}-${phase}.js`}
                />
              </div>
            </TabsContent>
            <TabsContent value="variables" className="flex min-h-0 flex-col p-4">
              <TemplateProvider draft={blankRequest()} collectionId={node.id} requestId={null}>
                <VariablesTable scope="collection" ownerId={node.id} hint={PRECEDENCE_HINT} overrideNote={overrideNote} />
              </TemplateProvider>
            </TabsContent>
          </Tabs>
        </DialogContent>
      )}
    </Dialog>
  );
}
