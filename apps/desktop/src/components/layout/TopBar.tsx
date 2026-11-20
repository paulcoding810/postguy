import { BotIcon, MonitorIcon, MoonIcon, PanelRightIcon, SearchIcon, SunIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd, Tooltip } from '@/components/ui/misc';
import { isTauri } from '@/lib/server';
import { cn, isMac, modKey } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { EnvironmentSwitcher } from '@/features/environments/EnvironmentSwitcher';
import { useMcpDialog } from '@/features/mcp/McpSettings';

export function TopBar() {
  const { theme, setTheme, setSearchOpen, smartPanel, toggleSmartPanel } = useUi();
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const ThemeIcon = theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : MonitorIcon;

  return (
    <header data-tauri-drag-region className={cn('flex h-11 shrink-0 items-center gap-3 border-b bg-sidebar pr-3', isTauri && isMac ? 'pl-20' : 'pl-3')}>
      <div data-tauri-drag-region className="flex items-center gap-2 font-semibold">
        <img src="/icon.svg" alt="" className="size-5" />
        Postguy
      </div>
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="mx-auto flex h-7 w-full max-w-md items-center gap-2 rounded-md border bg-background px-2.5 text-xs text-muted-foreground hover:border-ring/50"
      >
        <SearchIcon className="size-3.5" />
        Search requests, environments…
        <Kbd className="ml-auto">{modKey}K</Kbd>
      </button>
      <EnvironmentSwitcher />
      <Tooltip content="Claude (MCP)">
        <Button variant="ghost" size="icon-sm" onClick={() => useMcpDialog.getState().setOpen(true)} aria-label="Claude (MCP) settings">
          <BotIcon />
        </Button>
      </Tooltip>
      <Tooltip content={`Theme: ${theme}`}>
        <Button variant="ghost" size="icon-sm" onClick={() => setTheme(nextTheme)} aria-label="Toggle theme">
          <ThemeIcon />
        </Button>
      </Tooltip>
      <Tooltip content={`Smart data panel (${modKey}J)`}>
        <Button
          variant={smartPanel ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={toggleSmartPanel}
          aria-label="Toggle smart data panel"
          aria-pressed={smartPanel}
        >
          <PanelRightIcon />
        </Button>
      </Tooltip>
    </header>
  );
}
