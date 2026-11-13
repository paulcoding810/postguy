import { ArrowLeftIcon, ArrowRightIcon, FileCode2Icon, FilePlusIcon, HistoryIcon, LayersIcon, MoonIcon, PanelRightIcon, SearchIcon, SendIcon, SettingsIcon, WorkflowIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useActivateEnvironment, useEnvironments, useTree } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { Kbd } from '@/components/ui/misc';
import { cn, isMac, modKey } from '@/lib/utils';
import { neighbourTab, useTabs } from '@/stores/tabs';
import { useUi } from '@/stores/ui';
import { allRequests } from '@/features/collections/treeUtils';
import { useFlows } from '@/features/flows/queries';
import { useImportDialog } from '@/features/openapi/ImportDialog';
import { useCurlDialog } from '@/features/request/curl';

function switchTab(step: number) {
  const { tabs, activeId, activate } = useTabs.getState();
  const next = neighbourTab(tabs, activeId, step);
  if (next) activate(next.id);
}

interface Item {
  id: string;
  group: string;
  label: string;
  detail?: string;
  shortcut?: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const { searchOpen, setSearchOpen, openEnvManager, setTheme, theme } = useUi();
  const tree = useTree();
  const envs = useEnvironments();
  const flows = useFlows();
  const activate = useActivateEnvironment();
  const [q, setQ] = React.useState('');
  const [index, setIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (searchOpen) {
      setQ('');
      setIndex(0);
    }
  }, [searchOpen]);

  const items = React.useMemo<Item[]>(() => {
    const reqs: Item[] = allRequests(tree.data).map((r) => ({
      id: `req:${r.id}`,
      group: 'Requests',
      label: r.name,
      detail: `${r.method} · ${r.path}`,
      icon: <span className={cn('w-9 font-mono text-[10px] font-bold', `method-${r.method}`)}>{r.method}</span>,
      run: async () => {
        try {
          useTabs.getState().openRequest(await api('GET /requests/:id', { params: { id: r.id } }), { pin: true });
        } catch (e) {
          toast.error(errorMessage(e));
        }
      },
    }));
    const flowItems: Item[] = (flows.data ?? []).map((f) => ({
      id: `flow:${f.id}`,
      group: 'Flows',
      label: f.name,
      icon: <WorkflowIcon className="size-3.5 text-primary" />,
      run: () => useTabs.getState().openFlow(f),
    }));
    const envItems: Item[] = (envs.data ?? [])
      .filter((e) => e.kind === 'environment')
      .map((e) => ({
        id: `env:${e.id}`,
        group: 'Environments',
        label: `Use environment: ${e.name}`,
        icon: <LayersIcon className="size-3.5" />,
        run: () => activate.mutate(e.id),
      }));
    const actions: Item[] = [
      { id: 'a:new', group: 'Actions', label: 'New request', shortcut: `${modKey}T`, icon: <FilePlusIcon className="size-3.5" />, run: () => useTabs.getState().newRequest() },
      { id: 'a:import', group: 'Actions', label: 'Import OpenAPI or Postman…', icon: <FileCode2Icon className="size-3.5" />, run: () => useImportDialog.getState().setOpen(true) },
      { id: 'a:curl', group: 'Actions', label: 'Import cURL…', icon: <FilePlusIcon className="size-3.5" />, run: () => useCurlDialog.getState().setOpen(true) },
      { id: 'a:env', group: 'Actions', label: 'Manage environments', shortcut: `${modKey}⇧E`, icon: <SettingsIcon className="size-3.5" />, run: () => openEnvManager() },
      { id: 'a:smart', group: 'Actions', label: 'Toggle smart data panel', shortcut: `${modKey}J`, icon: <PanelRightIcon className="size-3.5" />, run: () => useUi.getState().toggleSmartPanel() },
      { id: 'a:next-tab', group: 'Actions', label: 'Next tab', shortcut: isMac ? '⌃Tab' : 'Ctrl+Tab', icon: <ArrowRightIcon className="size-3.5" />, run: () => switchTab(1) },
      { id: 'a:prev-tab', group: 'Actions', label: 'Previous tab', shortcut: isMac ? '⌃⇧Tab' : 'Ctrl+⇧Tab', icon: <ArrowLeftIcon className="size-3.5" />, run: () => switchTab(-1) },
      { id: 'a:history', group: 'Actions', label: 'Show history', icon: <HistoryIcon className="size-3.5" />, run: () => useUi.getState().setSidebar('history') },
      {
        id: 'a:theme',
        group: 'Actions',
        label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
        icon: <MoonIcon className="size-3.5" />,
        run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
    ];
    const all = [...reqs, ...flowItems, ...envItems, ...actions];
    const needle = q.trim().toLowerCase();
    if (!needle) return all.slice(0, 60);
    return all.filter((i) => `${i.label} ${i.detail ?? ''}`.toLowerCase().includes(needle)).slice(0, 60);
  }, [tree.data, flows.data, envs.data, q, theme, activate, openEnvManager, setTheme]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    setSearchOpen(false);
    item.run();
  };

  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  let lastGroup = '';
  return (
    <DialogPrimitive.Root open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content className="fixed top-[15vh] left-1/2 z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border bg-popover shadow-xl">
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIndex((i) => Math.min(i + 1, items.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(items[index]);
                }
              }}
              placeholder="Search requests, environments and actions…"
              className="h-11 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1">
            {items.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">No results</p>}
            {items.map((item, i) => {
              const header = item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <React.Fragment key={item.id}>
                  {header && <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{item.group}</div>}
                  <button
                    type="button"
                    data-index={i}
                    onMouseMove={() => setIndex(i)}
                    onClick={() => choose(item)}
                    className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px]', i === index && 'bg-accent')}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                    {item.detail && <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{item.detail}</span>}
                    {item.shortcut && <Kbd className="ml-auto">{item.shortcut}</Kbd>}
                    {i === index && !item.detail && !item.shortcut && <SendIcon className="ml-auto size-3 text-muted-foreground" />}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
