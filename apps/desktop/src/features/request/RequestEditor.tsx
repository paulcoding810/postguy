import { LockIcon } from 'lucide-react';
import type { KeyValue, RequestDefinition } from '@postguy/shared';
import { ResizableGroup, ResizableHandle, ResizablePanel } from '@/components/ui/resizable';
import { Tooltip } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTree } from '@/hooks/queries';
import { useTabs, type RequestTab } from '@/stores/tabs';
import { TemplateProvider } from '@/features/template/TemplateProvider';
import { inheritedAuthSource, chainTo } from '@/features/collections/treeUtils';
import { ResponsePanel } from '@/features/response/ResponsePanel';
import { AuthEditor } from './AuthEditor';
import { BodyEditor } from './BodyEditor';
import { DocsTab } from './DocsTab';
import { KeyValueEditor } from './KeyValueEditor';
import { SettingsEditor } from './SettingsEditor';
import { UrlBar } from './UrlBar';

function count(list: KeyValue[]) {
  const n = list.filter((i) => i.enabled && i.key).length;
  return n ? <span className="text-[11px] text-muted-foreground">{n}</span> : null;
}

export function RequestEditor({ tab }: { tab: RequestTab }) {
  const updateDraft = useTabs((s) => s.updateDraft);
  const tree = useTree();
  const set = <K extends keyof RequestDefinition>(key: K, value: RequestDefinition[K]) =>
    updateDraft(tab.id, (d) => ({ ...d, [key]: value }));
  const { draft } = tab;
  const breadcrumb = chainTo(tree.data, tab.collectionId).map((c) => c.name);

  return (
    <TemplateProvider draft={draft} collectionId={tab.collectionId} requestId={tab.requestId}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-1 px-3 pt-2 text-xs text-muted-foreground">
          {breadcrumb.length ? breadcrumb.join(' / ') : <span className="italic">Unsaved request</span>}
          <span>/</span>
          <input
            aria-label="Request name"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            className="min-w-24 flex-1 bg-transparent font-medium text-foreground outline-none"
          />
        </div>
        <UrlBar tab={tab} />
        <ResizableGroup id="request-response" orientation="vertical" className="min-h-0 flex-1">
          <ResizablePanel id="request" defaultSize="45%" minSize="15%">
            <Tabs defaultValue="params" className="flex h-full min-h-0 flex-col">
              <TabsList>
                <TabsTrigger value="params">Params {count([...draft.params, ...draft.pathParams])}</TabsTrigger>
                <TabsTrigger value="headers">Headers {count(draft.headers)}</TabsTrigger>
                <TabsTrigger value="auth">
                  Auth {draft.auth.type !== 'inherit' && draft.auth.type !== 'none' && <span className="size-1.5 rounded-full bg-success" />}
                </TabsTrigger>
                <TabsTrigger value="body">
                  Body {draft.body.mode !== 'none' && <span className="size-1.5 rounded-full bg-success" />}
                </TabsTrigger>
                <Tooltip content="Scripts arrive with the script engine (Phase 5)">
                  <span>
                    <TabsTrigger value="pre" disabled>
                      Pre-request <LockIcon className="size-3" />
                    </TabsTrigger>
                  </span>
                </Tooltip>
                <Tooltip content="Scripts arrive with the script engine (Phase 5)">
                  <span>
                    <TabsTrigger value="post" disabled>
                      Post-response <LockIcon className="size-3" />
                    </TabsTrigger>
                  </span>
                </Tooltip>
                <TabsTrigger value="docs">Docs</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
              <TabsContent value="params" className="overflow-auto">
                <div className="px-3 pt-3 pb-1 text-[11px] font-semibold text-muted-foreground uppercase">Query params</div>
                <KeyValueEditor label="Query param" items={draft.params} onChange={(v) => set('params', v)} />
                {draft.pathParams.length > 0 && (
                  <>
                    <div className="px-3 pt-4 pb-1 text-[11px] font-semibold text-muted-foreground uppercase">Path variables</div>
                    <KeyValueEditor
                      label="Path variable"
                      fixedKeys
                      showDescription
                      items={draft.pathParams}
                      onChange={(v) => set('pathParams', v)}
                    />
                  </>
                )}
              </TabsContent>
              <TabsContent value="headers" className="overflow-auto">
                <KeyValueEditor label="Header" items={draft.headers} onChange={(v) => set('headers', v)} />
              </TabsContent>
              <TabsContent value="auth" className="overflow-auto">
                <AuthEditor
                  auth={draft.auth}
                  onChange={(v) => set('auth', v)}
                  inheritedFrom={inheritedAuthSource(tree.data, tab.collectionId)}
                />
              </TabsContent>
              <TabsContent value="body">
                <BodyEditor body={draft.body} onChange={(v) => set('body', v)} editorPath={`body-${tab.id}.json`} />
              </TabsContent>
              <TabsContent value="docs" className="overflow-auto">
                <DocsTab requestId={tab.requestId} />
              </TabsContent>
              <TabsContent value="settings" className="overflow-auto">
                <SettingsEditor settings={draft.settings} onChange={(v) => set('settings', v)} />
              </TabsContent>
            </Tabs>
          </ResizablePanel>
          <ResizableHandle orientation="vertical" />
          <ResizablePanel id="response" defaultSize="55%" minSize="15%">
            <ResponsePanel response={tab.response} sending={tab.sending} requestId={tab.requestId} />
          </ResizablePanel>
        </ResizableGroup>
      </div>
    </TemplateProvider>
  );
}
