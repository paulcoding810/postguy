import { ExternalLinkIcon, InfoIcon, RotateCcwIcon, RotateCwIcon, WandSparklesIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import type { ExecutionStep, FlowStep, RequestDefinition, SavedRequest, StepOverrides } from '@postguy/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { EmptyState, Switch, Tooltip } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeEditor } from '@/components/CodeEditor';
import { syncPathParams } from '@/lib/url';
import { cn, formatBytes, formatMs, statusTone } from '@/lib/utils';
import { useTabs } from '@/stores/tabs';
import { AuthEditor } from '@/features/request/AuthEditor';
import { BodyEditor } from '@/features/request/BodyEditor';
import { KeyValueEditor } from '@/features/request/KeyValueEditor';
import { TemplateInput } from '@/features/template/TemplateInput';
import { TemplateProvider } from '@/features/template/TemplateProvider';
import { useInsertTarget } from '@/features/template/TemplateContext';
import { JsonTree } from '@/features/memory/JsonTree';
import { refFor } from '@/features/memory/refs';
import { blankRequest } from '@/stores/tabs';
import { StatusIcon } from './nodes';
import { ScriptEditor, useStepScriptTypes } from '@/components/ScriptEditor';
import { TestsTab } from '@/features/response/TestsTab';
import { ResizableGroup, ResizableHandle, ResizablePanel } from '@/components/ui/resizable';
import { useFlowSources, useSavedRequest } from './queries';

function toDefinition(r: SavedRequest): RequestDefinition {
  return { name: r.name, method: r.method, url: r.url, params: r.params, pathParams: r.pathParams, headers: r.headers, auth: r.auth, body: r.body, settings: r.settings, scripts: r.scripts };
}

function Section({ title, overridden, onReset, children }: { title: string; overridden: boolean; onReset: () => void; children: React.ReactNode }) {
  return (
    <section className="border-b">
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase">{title}</span>
        {overridden && (
          <>
            <Badge variant="default">mapped</Badge>
            <button type="button" onClick={onReset} className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <RotateCcwIcon className="size-3" /> Use request value
            </button>
          </>
        )}
      </div>
      {children}
    </section>
  );
}

export interface StepInspectorProps {
  flowId: string;
  step: FlowStep;
  run: ExecutionStep | undefined;
  tab: string;
  onTab: (tab: string) => void;
  onChange: (patch: Partial<FlowStep>) => void;
  onAutoMap: () => void;
  onRerun: (() => void) | null;
  nameTaken: boolean;
}

export function StepInspector(props: StepInspectorProps) {
  const { step, run, tab, onTab, onChange, flowId, nameTaken } = props;
  const request = useSavedRequest(step.requestId).data;
  const flow = React.useMemo(() => ({ flowId, stepId: step.id }), [flowId, step.id]);
  const base = request ? toDefinition(request) : null;
  const o = step.overrides;
  const setO = (patch: Partial<StepOverrides>) => onChange({ overrides: { ...o, ...patch } });
  const reset = (key: keyof StepOverrides) => {
    const next = { ...o };
    delete next[key];
    onChange({ overrides: next });
  };
  const url = o.url ?? base?.url ?? '';
  const draft: RequestDefinition = base
    ? { ...base, url, params: o.params ?? base.params, pathParams: o.pathParams ?? syncPathParams(url, base.pathParams), headers: o.headers ?? base.headers, auth: o.auth ?? base.auth, body: o.body ?? base.body }
    : blankRequest();
  const preTypes = useStepScriptTypes(flowId, step.id, step.requestId, 'pre', step.name);
  const postTypes = useStepScriptTypes(flowId, step.id, step.requestId, 'post', step.name);
  const exprRefs = React.useMemo(() => [...step.expression.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]!), [step.expression]);

  return (
    <TemplateProvider draft={draft} collectionId={request?.collectionId ?? null} requestId={request?.id ?? null} flow={flow} extraRefs={exprRefs}>
      <Tabs value={tab} onValueChange={onTab} className="flex h-full min-h-0 flex-col">
        <TabsList>
          <TabsTrigger value="inputs">Inputs</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          {step.kind === 'request' && (
            <TabsTrigger value="scripts">
              Scripts {(step.scripts.pre.trim() || step.scripts.post.trim()) && <span className="size-1.5 rounded-full bg-success" />}
            </TabsTrigger>
          )}
          <TabsTrigger value="result">
            Result <StatusIcon status={run?.status} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inputs" className="overflow-auto">
          <div className="flex flex-col gap-3 border-b p-3">
            <div className="grid gap-1">
              <Label>Step name (used in references)</Label>
              <Input value={step.name} onChange={(e) => onChange({ name: e.target.value })} aria-invalid={nameTaken} className={cn(nameTaken && 'border-destructive')} />
              {nameTaken && <span className="text-[11px] text-destructive">Another step already uses this name.</span>}
            </div>
            {step.kind === 'request' && (
              <>
                <div className="flex items-center gap-2 text-xs">
                  {request ? (
                    <>
                      <span className={cn('font-mono text-[10px] font-bold', `method-${request.method}`)}>{request.method}</span>
                      <span className="truncate">{request.name}</span>
                      <Tooltip content="Open the saved request">
                        <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => useTabs.getState().openRequest(request, { pin: true })} aria-label="Open request">
                          <ExternalLinkIcon className="size-3.5" />
                        </Button>
                      </Tooltip>
                    </>
                  ) : (
                    <span className="text-destructive">The request for this step was deleted.</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-foreground">Fail on HTTP 4xx/5xx</Label>
                  <Switch checked={step.failOnHttpError} onCheckedChange={(v) => onChange({ failOnHttpError: v })} />
                </div>
                <Button variant="outline" size="sm" onClick={props.onAutoMap} disabled={!request}>
                  <WandSparklesIcon /> Auto-map inputs from previous steps
                </Button>
              </>
            )}
          </div>

          {step.kind === 'condition' && (
            <div className="flex flex-col gap-2 p-3">
              <Label>Condition</Label>
              <TemplateInput
                value={step.expression}
                onChange={(expression) => onChange({ expression })}
                fieldLabel="Condition"
                inputClassName="font-mono text-xs"
                placeholder="{{$res.Login.status}} == 200"
              />
              <p className="flex gap-1.5 text-[11px] text-muted-foreground">
                <InfoIcon className="mt-0.5 size-3 shrink-0" />
                Compare references with == != &lt; &lt;= &gt; &gt;= or contains, combine with &amp;&amp; || !, and use exists({'{{ref}}'}).
                The true and false outputs lead to different steps.
              </p>
            </div>
          )}

          {step.kind === 'request' && base && (
            <>
              <Section title="URL" overridden={o.url !== undefined} onReset={() => reset('url')}>
                <div className="px-3 pb-3">
                  <TemplateInput
                    value={url}
                    fieldLabel="URL"
                    inputClassName="font-mono text-xs"
                    onChange={(v) => setO({ url: v, pathParams: syncPathParams(v, o.pathParams ?? base.pathParams) })}
                  />
                </div>
              </Section>
              {draft.pathParams.length > 0 && (
                <Section title="Path variables" overridden={o.pathParams !== undefined} onReset={() => reset('pathParams')}>
                  <KeyValueEditor label="Path variable" fixedKeys showDescription items={draft.pathParams} onChange={(v) => setO({ pathParams: v })} />
                </Section>
              )}
              <Section title="Query params" overridden={o.params !== undefined} onReset={() => reset('params')}>
                <KeyValueEditor label="Query param" items={draft.params} onChange={(v) => setO({ params: v })} />
              </Section>
              <Section title="Headers" overridden={o.headers !== undefined} onReset={() => reset('headers')}>
                <KeyValueEditor label="Header" items={draft.headers} onChange={(v) => setO({ headers: v })} />
              </Section>
              <Section title="Auth" overridden={o.auth !== undefined} onReset={() => reset('auth')}>
                <div className="-mt-2">
                  <AuthEditor auth={draft.auth} onChange={(v) => setO({ auth: v })} />
                </div>
              </Section>
              {draft.method !== 'GET' && draft.method !== 'HEAD' && (
                <Section title="Body" overridden={o.body !== undefined} onReset={() => reset('body')}>
                  <div className="h-56">
                    <BodyEditor body={draft.body} onChange={(v) => setO({ body: v })} editorPath={`flow-${flowId}-${step.id}.json`} />
                  </div>
                </Section>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="scripts" className="flex min-h-0 flex-col">
          <p className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">
            Step scripts run after the request’s own scripts. Use flow.set() to pass values to later steps.
          </p>
          <ResizableGroup id="step-scripts" orientation="vertical" className="min-h-0 flex-1">
            <ResizablePanel id="step-pre" defaultSize="40%" minSize="15%">
              <div className="flex h-full flex-col">
                <div className="border-b px-3 py-1 text-[11px] font-semibold text-muted-foreground uppercase">Pre-request</div>
                <div className="min-h-0 flex-1">
                  <ScriptEditor
                    phase="pre"
                    value={step.scripts.pre}
                    onChange={(v) => onChange({ scripts: { ...step.scripts, pre: v } })}
                    types={preTypes}
                    path={`file:///flow-${flowId}-${step.id}-pre.js`}
                  />
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle orientation="vertical" />
            <ResizablePanel id="step-post" defaultSize="60%" minSize="15%">
              <div className="flex h-full flex-col">
                <div className="border-b px-3 py-1 text-[11px] font-semibold text-muted-foreground uppercase">Post-response</div>
                <div className="min-h-0 flex-1">
                  <ScriptEditor
                    phase="post"
                    value={step.scripts.post}
                    onChange={(v) => onChange({ scripts: { ...step.scripts, post: v } })}
                    types={postTypes}
                    path={`file:///flow-${flowId}-${step.id}-post.js`}
                  />
                </div>
              </div>
            </ResizablePanel>
          </ResizableGroup>
        </TabsContent>

        <TabsContent value="data" className="overflow-auto">
          <DataPicker flowId={flowId} stepId={step.id} />
        </TabsContent>

        <TabsContent value="result" className="flex min-h-0 flex-col">
          <StepResult run={run} onRerun={props.onRerun} />
        </TabsContent>
      </Tabs>
    </TemplateProvider>
  );
}

function DataPicker({ flowId, stepId }: { flowId: string; stepId: string }) {
  const sources = useFlowSources(flowId, stepId);
  const target = useInsertTarget((s) => s.last);
  const [filter, setFilter] = React.useState('');
  const list = sources.data ?? [];
  if (!list.length)
    return (
      <EmptyState title="No previous steps">
        Connect steps into this one to pick values from their responses.
      </EmptyState>
    );
  const insert = (name: string, path: string) => {
    if (!target) return toast.message('Click into an input field first');
    target.insert(`{{${refFor(name, path)}}}`);
    toast.success(`Inserted into ${target.label}`);
  };
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">{target ? <>Inserting into <b className="text-foreground">{target.label}</b></> : 'Click an input, then double-click a value.'}</span>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" className="ml-auto h-6 w-28 rounded bg-muted/60 px-2 text-xs outline-none" />
      </div>
      {list.map((s) => (
        <div key={s.stepId} className="border-b">
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className={cn('font-mono text-[10px] font-bold', s.method && `method-${s.method}`)}>{s.method}</span>
            <span className="font-medium">{s.name}</span>
            <Badge variant={s.origin === 'execution' ? 'success' : s.origin === 'snapshot' ? 'secondary' : 'outline'} className="ml-auto">
              {s.origin === 'execution' ? 'last run' : s.origin === 'snapshot' ? 'remembered response' : 'no data yet'}
            </Badge>
          </div>
          {s.origin === 'none' ? (
            <p className="px-3 pb-2 text-[11px] text-muted-foreground">Run the flow or send this request once to browse its response.</p>
          ) : (
            <JsonTree value={s.body} filter={filter} canInsert={!!target} onInsert={(p) => insert(s.name, p)} onCopy={(p) => navigator.clipboard.writeText(`{{${refFor(s.name, p)}}}`).then(() => toast.success('Reference copied'))} />
          )}
        </div>
      ))}
    </div>
  );
}

function StepResult({ run, onRerun }: { run: ExecutionStep | undefined; onRerun: (() => void) | null }) {
  if (!run) return <EmptyState title="Not run yet">Run the flow to see this step’s request, response and logs.</EmptyState>;
  const r = run.response;
  const body = r ? (r.body !== null && r.body !== undefined ? JSON.stringify(r.body, null, 2) : (r.bodyText ?? '')) : '';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <StatusIcon status={run.status} />
        <span className="font-medium capitalize">{run.status}</span>
        <span className="text-muted-foreground">attempt {run.attempt}</span>
        {r?.status && <span className={cn('font-semibold', statusTone(r.status))}>{r.status}</span>}
        {r && <span className="text-muted-foreground">{formatMs(r.timeMs)} · {formatBytes(r.size)}</span>}
        {run.validation && <Badge variant={run.validation.ok ? 'success' : 'warning'}>{run.validation.ok ? 'schema valid' : 'schema issues'}</Badge>}
        {onRerun && (
          <Button size="xs" variant="outline" className="ml-auto" onClick={onRerun}>
            <RotateCwIcon /> Rerun step
          </Button>
        )}
      </div>
      {run.error && <div className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive select-text">{run.error}</div>}
      {run.request && (
        <div className="border-b px-3 py-1.5 font-mono text-[11px] break-all text-muted-foreground select-text">
          {run.request.method} {run.request.url}
        </div>
      )}
      <div className="max-h-40 shrink-0 overflow-auto border-b px-3 py-1.5 font-mono text-[11px]">
        {run.logs.map((l, i) => (
          <div key={i} className={cn(l.level === 'error' ? 'text-destructive' : l.level === 'warn' ? 'text-warning' : 'text-muted-foreground')}>
            {new Date(l.at).toLocaleTimeString()} {l.message}
          </div>
        ))}
      </div>
      {run.scripts && run.scripts.length > 0 && (
        <div className="max-h-56 shrink-0 overflow-auto border-b">
          <TestsTab runs={run.scripts} />
        </div>
      )}
      <div className="min-h-40 flex-1">{r && <CodeEditor readOnly value={body} language={r.body !== null && r.body !== undefined ? 'json' : 'plaintext'} />}</div>
    </div>
  );
}
