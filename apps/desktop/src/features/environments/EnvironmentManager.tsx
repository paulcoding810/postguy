import { useQueryClient } from '@tanstack/react-query';
import { CheckIcon, GlobeIcon, LayersIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { confirm, prompt } from '@/components/dialogs';
import { keys, useActivateEnvironment, useEnvironments, useInvalidateVariables } from '@/hooks/queries';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { VariablesTable } from './VariablesTable';

export const PRECEDENCE_HINT =
  'Precedence (highest first): request → flow → collection (inner folder first) → active environment → globals.';

export function EnvironmentManager() {
  const { envManagerOpen, envManagerSelected, closeEnvManager } = useUi();
  const envs = useEnvironments();
  const qc = useQueryClient();
  const activate = useActivateEnvironment();
  const invalidateVars = useInvalidateVariables();
  const [selected, setSelected] = React.useState<string | null>(null);

  const list = envs.data ?? [];
  const global = list.find((e) => e.kind === 'global');
  React.useEffect(() => {
    if (envManagerOpen) setSelected(envManagerSelected ?? list.find((e) => e.isActive)?.id ?? global?.id ?? null);
  }, [envManagerOpen]);
  const current = list.find((e) => e.id === selected) ?? global;

  const create = async () => {
    const name = await prompt({ title: 'New environment', initial: 'Development', confirmLabel: 'Create' });
    if (!name) return;
    const env = await api('POST /environments', { body: { name } });
    await qc.invalidateQueries({ queryKey: keys.environments });
    setSelected(env.id);
  };

  const rename = async (id: string, name: string) => {
    const next = await prompt({ title: 'Rename environment', initial: name });
    if (!next) return;
    await api('PATCH /environments/:id', { params: { id }, body: { name: next } });
    qc.invalidateQueries({ queryKey: keys.environments });
  };

  const remove = async (id: string, name: string) => {
    if (!(await confirm({ title: `Delete "${name}"?`, description: 'Its variables are deleted too.', destructive: true, confirmLabel: 'Delete' })))
      return;
    await api('DELETE /environments/:id', { params: { id } });
    await qc.invalidateQueries({ queryKey: keys.environments });
    invalidateVars();
    setSelected(global?.id ?? null);
  };

  return (
    <Dialog open={envManagerOpen} onOpenChange={(o) => !o && closeEnvManager()}>
      <DialogContent className="flex h-[70vh] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Environments</DialogTitle>
          <DialogDescription>{PRECEDENCE_HINT}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-56 shrink-0 flex-col border-r">
            <div className="flex-1 overflow-auto p-2">
              {list.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setSelected(e.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent',
                    current?.id === e.id && 'bg-accent font-medium',
                  )}
                >
                  {e.kind === 'global' ? <GlobeIcon className="size-3.5" /> : <LayersIcon className="size-3.5" />}
                  <span className="truncate">{e.name}</span>
                  {e.isActive && <CheckIcon className="ml-auto size-3.5 text-success" />}
                </button>
              ))}
            </div>
            <div className="border-t p-2">
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={create}>
                <PlusIcon /> New environment
              </Button>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col p-4">
            {current && (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{current.name}</h3>
                  {current.kind === 'global' ? (
                    <Badge variant="secondary">Always applied, lowest precedence</Badge>
                  ) : current.isActive ? (
                    <Badge variant="success">Active</Badge>
                  ) : null}
                  {current.kind === 'environment' && (
                    <div className="ml-auto flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => activate.mutate(current.isActive ? null : current.id)}
                      >
                        {current.isActive ? 'Deactivate' : 'Set active'}
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => rename(current.id, current.name)} aria-label="Rename">
                        <PencilIcon />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => remove(current.id, current.name)} aria-label="Delete">
                        <Trash2Icon />
                      </Button>
                    </div>
                  )}
                </div>
                <VariablesTable key={current.id} scope={current.kind === 'global' ? 'global' : 'environment'} ownerId={current.id} />
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
