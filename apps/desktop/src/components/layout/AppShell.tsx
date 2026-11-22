import { FilePlusIcon, SendIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState, Kbd } from '@/components/ui/misc';
import { ResizableGroup, ResizableHandle, ResizablePanel } from '@/components/ui/resizable';
import { isMac, modKey } from '@/lib/utils';
import { isRequestTab, neighbourTab, numberedTab, useActiveTab, useTabs } from '@/stores/tabs';
import { FlowEditor } from '@/features/flows/FlowEditor';
import { useUi } from '@/stores/ui';
import { RequestEditor } from '@/features/request/RequestEditor';
import { useSaveRequest, useSendRequest } from '@/features/request/actions';
import { SmartPanel } from '@/features/memory/SmartPanel';
import { SidebarPanel, SidebarRail } from './Sidebar';
import { closeTab, TabBar } from './TabBar';
import { TopBar } from './TopBar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useLiveChanges } from '@/hooks/useLiveChanges';
import { useUpdateChecks } from '@/lib/updates';
import { useSettings } from '@/features/settings/SettingsDialog';

function useShortcuts() {
  const send = useSendRequest();
  const save = useSaveRequest();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const { tabs, activeId, newRequest } = useTabs.getState();
      const any = tabs.find((t) => t.id === activeId);
      const tab = isRequestTab(any) ? any : null;
      const ui = useUi.getState();
      const key = e.key.toLowerCase();
      const go = (t: ReturnType<typeof neighbourTab>) => {
        e.preventDefault();
        if (t) useTabs.getState().activate(t.id);
      };
      const inEditor = e.target instanceof Element && !!e.target.closest('.monaco-editor');
      if (key === 'tab' && e.ctrlKey) return go(neighbourTab(tabs, activeId, e.shiftKey ? -1 : 1));
      if (e.shiftKey && (e.code === 'BracketRight' || e.code === 'BracketLeft') && (isMac || !inEditor))
        return go(neighbourTab(tabs, activeId, e.code === 'BracketRight' ? 1 : -1));
      if (!e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) return go(numberedTab(tabs, Number(e.code.slice(5))));
      if (key === 'enter' && tab) {
        e.preventDefault();
        void send(tab);
      } else if (key === 's' && tab) {
        e.preventDefault();
        void save(tab, { saveAs: e.shiftKey });
      } else if (key === 't') {
        e.preventDefault();
        newRequest();
      } else if (key === 'w' && any) {
        e.preventDefault();
        void closeTab(any);
      } else if (key === 'k') {
        e.preventDefault();
        ui.setSearchOpen(true);
      } else if (key === 'j') {
        e.preventDefault();
        ui.toggleSmartPanel();
      } else if (key === ',') {
        e.preventDefault();
        useSettings.getState().open('general');
      } else if (key === 'e' && e.shiftKey) {
        e.preventDefault();
        ui.openEnvManager();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [send, save]);
}

function Workspace() {
  const tab = useActiveTab();
  const newRequest = useTabs((s) => s.newRequest);
  if (!tab) {
    return (
      <EmptyState icon={<SendIcon className="size-7" />} title="Postguy">
        <p>Open a request from the sidebar or create a new one.</p>
        <Button size="sm" className="mt-3" onClick={() => newRequest()}>
          <FilePlusIcon /> New request <Kbd className="ml-1 border-primary-foreground/30 bg-transparent text-primary-foreground">{modKey}T</Kbd>
        </Button>
      </EmptyState>
    );
  }
  return (
    <ErrorBoundary key={tab.id} label="This tab" resetLabel="Close tab" onReset={() => useTabs.getState().close(tab.id)}>
      {isRequestTab(tab) ? <RequestEditor tab={tab} /> : <FlowEditor flowId={tab.flowId} />}
    </ErrorBoundary>
  );
}

export function AppShell() {
  useShortcuts();
  useLiveChanges();
  useUpdateChecks();
  const smartPanel = useUi((s) => s.smartPanel);
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <SidebarRail />
        <ResizableGroup id={smartPanel ? 'main-smart' : 'main'} className="min-w-0 flex-1">
          <ResizablePanel id="sidebar" defaultSize="22%" minSize={200} maxSize="40%">
            <ErrorBoundary label="The sidebar">
              <SidebarPanel />
            </ErrorBoundary>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="workspace" minSize="30%">
            <div className="flex h-full min-w-0 flex-col">
              <TabBar />
              <div className="min-h-0 flex-1">
                <Workspace />
              </div>
            </div>
          </ResizablePanel>
          {smartPanel && (
            <>
              <ResizableHandle />
              <ResizablePanel id="smart" defaultSize="26%" minSize={260} maxSize="45%">
                <ErrorBoundary label="The data panel">
                  <SmartPanel />
                </ErrorBoundary>
              </ResizablePanel>
            </>
          )}
        </ResizableGroup>
      </div>
    </div>
  );
}
