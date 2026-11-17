import { useQueryClient } from '@tanstack/react-query';
import { CopyIcon, PencilIcon, PlusIcon, Trash2Icon, WorkflowIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { FlowDetail } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/menu';
import { EmptyState } from '@/components/ui/misc';
import { confirm, prompt } from '@/components/dialogs';
import { api, errorMessage } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { useTabs } from '@/stores/tabs';
import { flowKeys, useFlows, warnIfNameTaken } from './queries';

export function useCreateFlow() {
  const qc = useQueryClient();
  return async () => {
    const name = await prompt({ title: 'New flow', initial: 'New Flow', confirmLabel: 'Create' });
    if (!name) return;
    try {
      const flow = await api('POST /flows', { body: { name } });
      await qc.invalidateQueries({ queryKey: flowKeys.list });
      useTabs.getState().openFlow(flow);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
}

export function FlowList({ filter }: { filter: string }) {
  const flows = useFlows();
  const qc = useQueryClient();
  const create = useCreateFlow();
  const activeFlow = useTabs((s) => {
    const t = s.tabs.find((x) => x.id === s.activeId);
    return t?.kind === 'flow' ? t.flowId : null;
  });
  const q = filter.trim().toLowerCase();
  const list = (flows.data ?? []).filter((f) => !q || f.name.toLowerCase().includes(q));

  const rename = async (id: string, current: string) => {
    const name = await prompt({ title: 'Rename flow', initial: current });
    if (!name) return;
    try {
      await api('PATCH /flows/:id', { params: { id }, body: { name } });
      warnIfNameTaken(qc, id, name);
      useTabs.getState().onFlowRenamed(id, name);
      // Patch the name only: refetching the flow would replace a graph the open editor hasn't saved yet.
      qc.setQueryData<FlowDetail>(flowKeys.flow(id), (old) => (old ? { ...old, name } : old));
      await qc.invalidateQueries({ queryKey: flowKeys.list });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const duplicate = async (id: string) => {
    try {
      const copy = await api('POST /flows/:id/duplicate', { params: { id } });
      await qc.invalidateQueries({ queryKey: flowKeys.list });
      useTabs.getState().openFlow(copy);
      toast.success(`Created "${copy.name}"`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (id: string, name: string) => {
    if (!(await confirm({ title: `Delete "${name}"?`, description: 'Its steps and run history are deleted. Requests are kept.', destructive: true, confirmLabel: 'Delete' }))) return;
    try {
      await api('DELETE /flows/:id', { params: { id } });
      useTabs.getState().onFlowDeleted(id);
      await qc.invalidateQueries({ queryKey: flowKeys.list });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (!flows.data?.length && !flows.isLoading)
    return (
      <EmptyState icon={<WorkflowIcon className="size-6" />} title="No flows">
        Chain saved requests into a workflow.
        <Button size="sm" className="mt-2" onClick={create}>
          <PlusIcon /> New flow
        </Button>
      </EmptyState>
    );

  return (
    <div className="py-1">
      {list.map((f) => (
        <ContextMenu key={f.id}>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={() => useTabs.getState().openFlow(f)}
              className={cn('flex h-8 w-full items-center gap-2 px-3 text-left text-[13px] hover:bg-accent', activeFlow === f.id && 'bg-accent')}
            >
              <WorkflowIcon className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{timeAgo(f.updatedAt)}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => rename(f.id, f.name)}>
              <PencilIcon /> Rename
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => duplicate(f.id)}>
              <CopyIcon /> Duplicate
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => remove(f.id, f.name)}>
              <Trash2Icon /> Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  );
}
