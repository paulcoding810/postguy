import { useQueryClient } from '@tanstack/react-query';
import { CheckIcon, GlobeIcon, LayersIcon, PlusIcon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useActivateEnvironment, useEnvironments } from '@/hooks/queries';
import { cn } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { importEnvironmentFile } from './exchange';

export function EnvironmentList() {
  const envs = useEnvironments();
  const activate = useActivateEnvironment();
  const openEnvManager = useUi((s) => s.openEnvManager);
  const qc = useQueryClient();

  return (
    <div className="flex flex-col gap-0.5 p-2">
      {(envs.data ?? []).map((e) => (
        <div key={e.id} className="group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-accent">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => openEnvManager(e.id)}>
            {e.kind === 'global' ? <GlobeIcon className="size-3.5 text-muted-foreground" /> : <LayersIcon className="size-3.5 text-muted-foreground" />}
            <span className={cn('truncate', e.isActive && 'font-medium')}>{e.name}</span>
          </button>
          {e.kind === 'environment' &&
            (e.isActive ? (
              <CheckIcon className="size-3.5 text-success" aria-label="Active" />
            ) : (
              <button
                type="button"
                className="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                onClick={() => activate.mutate(e.id)}
              >
                Activate
              </button>
            ))}
        </div>
      ))}
      <Button variant="ghost" size="sm" className="mt-1 justify-start" onClick={() => openEnvManager(null)}>
        <PlusIcon /> Manage environments
      </Button>
      <Button variant="ghost" size="sm" className="justify-start" onClick={() => importEnvironmentFile(qc)}>
        <UploadIcon /> Import from Postman…
      </Button>
    </div>
  );
}
