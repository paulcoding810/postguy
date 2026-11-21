import { PlusIcon, WorkflowIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/menu';
import { Kbd, Tooltip } from '@/components/ui/misc';
import { confirm } from '@/components/dialogs';
import { cn, isMac, modKey } from '@/lib/utils';
import { isDirty, isRequestTab, neighbourTab, useTabs, type Tab } from '@/stores/tabs';

export async function closeTab(tab: Tab) {
  if (isRequestTab(tab) && isDirty(tab) && (tab.requestId || tab.draft.url)) {
    const ok = await confirm({
      title: `Discard changes to "${tab.draft.name}"?`,
      description: 'Unsaved changes will be lost.',
      destructive: true,
      confirmLabel: 'Discard',
    });
    if (!ok) return;
  }
  useTabs.getState().close(tab.id);
}

export function TabBar() {
  const { tabs, activeId, activate, newRequest, closeOthers, pin } = useTabs();
  const goTo = (step: number) => {
    const next = neighbourTab(tabs, activeId, step);
    if (next) activate(next.id);
  };
  const ctrl = isMac ? '⌃' : 'Ctrl+';
  const strip = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  React.useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b bg-sidebar" role="tablist">
      <div ref={strip} className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
        {tabs.map((t) => {
          const dirty = isDirty(t);
          const req = isRequestTab(t) ? t : null;
          return (
            <ContextMenu key={t.id}>
              <ContextMenuTrigger asChild>
                <div
                  role="tab"
                  aria-selected={t.id === activeId}
                  onClick={() => activate(t.id)}
                  onDoubleClick={() => pin(t.id)}
                  onAuxClick={(e) => e.button === 1 && closeTab(t)}
                  title={req?.preview ? 'Preview tab (italic): opening another request replaces it. Double-click or edit to keep it open.' : undefined}
                  className={cn(
                    'group relative flex max-w-52 min-w-32 cursor-pointer items-center gap-1.5 border-r px-3 text-xs select-none',
                    t.id === activeId ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  {t.id === activeId && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
                  {req ? (
                    <span className={cn('font-mono text-[10px] font-bold', `method-${req.draft.method}`)}>{req.draft.method}</span>
                  ) : (
                    <WorkflowIcon className="size-3.5 shrink-0 text-primary" />
                  )}
                  <span className={cn('truncate', req?.preview && 'italic')}>{req ? req.draft.name : t.kind === 'flow' ? t.name : ''}</span>
                  <span className="ml-auto flex size-4 shrink-0 items-center justify-center">
                    {dirty && <span className="size-1.5 rounded-full bg-primary group-hover:hidden" />}
                    <button
                      type="button"
                      aria-label="Close tab"
                      onClick={(e) => {
                        e.stopPropagation();
                        void closeTab(t);
                      }}
                      className={cn('rounded p-0.5 hover:bg-accent', dirty ? 'hidden group-hover:block' : 'opacity-0 group-hover:opacity-100')}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {req?.preview && <ContextMenuItem onSelect={() => pin(t.id)}>Keep open</ContextMenuItem>}
                <ContextMenuItem onSelect={() => closeTab(t)}>
                  Close <Kbd className="ml-auto">{modKey}W</Kbd>
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => closeOthers(t.id)}>Close others</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => goTo(1)}>
                  Next tab <Kbd className="ml-auto">{ctrl}Tab</Kbd>
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => goTo(-1)}>
                  Previous tab <Kbd className="ml-auto">{ctrl}⇧Tab</Kbd>
                </ContextMenuItem>
                <ContextMenuItem disabled>
                  Go to tab 1–8, or the last <Kbd className="ml-auto">{modKey}1–9</Kbd>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      <Tooltip content={`New request (${modKey}T)`}>
        <Button variant="ghost" size="icon" className="h-9 rounded-none border-l" onClick={() => newRequest()} aria-label="New request">
          <PlusIcon />
        </Button>
      </Tooltip>
    </div>
  );
}
