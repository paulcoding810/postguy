import { CheckIcon, ChevronDownIcon, LayersIcon, SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { Kbd } from '@/components/ui/misc';
import { useActivateEnvironment, useEnvironments } from '@/hooks/queries';
import { modKey } from '@/lib/utils';
import { useUi } from '@/stores/ui';

export function EnvironmentSwitcher() {
  const envs = useEnvironments();
  const activate = useActivateEnvironment();
  const openEnvManager = useUi((s) => s.openEnvManager);
  const list = (envs.data ?? []).filter((e) => e.kind === 'environment');
  const active = list.find((e) => e.isActive);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-40 justify-between" aria-label="Active environment">
          <span className="flex items-center gap-1.5 truncate">
            <LayersIcon className={active ? 'text-success' : ''} />
            {active?.name ?? 'No environment'}
          </span>
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Environment</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => activate.mutate(null)}>
          <span className="flex-1">No environment</span>
          {!active && <CheckIcon />}
        </DropdownMenuItem>
        {list.map((e) => (
          <DropdownMenuItem key={e.id} onSelect={() => activate.mutate(e.id)}>
            <span className="flex-1 truncate">{e.name}</span>
            {e.isActive && <CheckIcon />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openEnvManager(active?.id ?? null)}>
          <SettingsIcon /> Manage environments…
          <Kbd className="ml-auto">{modKey}⇧E</Kbd>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
