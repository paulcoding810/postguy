import '@xyflow/react/dist/style.css';
import { useQueryClient } from '@tanstack/react-query';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { BugIcon, LoaderIcon, PlayIcon, SkipForwardIcon, SquareIcon, StepForwardIcon, VariableIcon, WorkflowIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { newId, type FlowConnection, type FlowDetail, type FlowGraph, type FlowHandle, type FlowStep, type MappingSuggestion, type SavedRequest } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, Switch, Tooltip } from '@/components/ui/misc';
import { ResizableGroup, ResizableHandle, ResizablePanel } from '@/components/ui/resizable';
import { useResolvedTheme } from '@/hooks/useTheme';
import { useTree } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { useTabs } from '@/stores/tabs';
import { allRequests } from '@/features/collections/treeUtils';
import { VariablesTable } from '@/features/environments/VariablesTable';
import { AddStepMenu, type AddChoice } from './AddStepMenu';
import { usePendingSteps } from './pending';
import { applySuggestions, describeMappings, uniqueStepName } from './automap';
import { ExecutionPanel } from './ExecutionPanel';
import { nodeTypes, type StepNode } from './nodes';
import { flowKeys, latestByStep, useExecutions, useFlow, useLiveExecution } from './queries';
import { StepInspector } from './StepInspector';

export function FlowEditor({ flowId }: { flowId: string }) {
  const flow = useFlow(flowId);
  if (flow.isError) return <EmptyState title="Flow not found">{errorMessage(flow.error)}</EmptyState>;
  if (!flow.data) return <EmptyState icon={<LoaderIcon className="size-5 animate-spin" />} title="Loading flow…" />;
  return (
    <ReactFlowProvider>
      <Editor flowId={flowId} initial={flow.data} />
    </ReactFlowProvider>
  );
}

function issueFor(step: FlowStep, steps: FlowStep[]): string | null {
  if (step.kind === 'request' && !step.requestId) return 'No request';
  if (step.kind === 'condition' && !step.expression.trim()) return 'Add a condition';
  if (steps.some((s) => s.id !== step.id && s.name.trim().toLowerCase() === step.name.trim().toLowerCase())) return 'Duplicate name';
  return null;
}

function Editor({ flowId, initial }: { flowId: string; initial: FlowGraph & { name: string; settings: { stopOnError: boolean } } }) {
  const qc = useQueryClient();
  const theme = useResolvedTheme();
  const rf = useReactFlow();
  const tree = useTree();
  const executions = useExecutions(flowId);
  const [graph, setGraph] = React.useState<FlowGraph>({ steps: initial.steps, connections: initial.connections });
  const [name, setName] = React.useState(initial.name);
  React.useEffect(() => setName(initial.name), [initial.name]);
  const [stopOnError, setStopOnError] = React.useState(initial.settings.stopOnError);
  const [selected, setSelected] = React.useState<string | null>(initial.steps[0]?.id ?? null);
  const [selectedEdge, setSelectedEdge] = React.useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = React.useState('inputs');
  const [executionId, setExecutionId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<'saved' | 'saving' | 'error'>('saved');
  const [varsOpen, setVarsOpen] = React.useState(false);
  /** Node sizes reported by React Flow; without them it keeps nodes hidden. */
  const [measured, setMeasured] = React.useState<Record<string, { width: number; height: number }>>({});
  const graphRef = React.useRef(graph);
  graphRef.current = graph;
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePromise = React.useRef<Promise<void>>(Promise.resolve());
  const firstRender = React.useRef(true);

  const requests = React.useMemo(() => new Map(allRequests(tree.data).map((r) => [r.id, r])), [tree.data]);
  const currentId = executionId ?? executions.data?.[0]?.id ?? null;
  const live = useLiveExecution(currentId, flowId);
  const runs = React.useMemo(() => latestByStep(live.data), [live.data]);
  const running = live.data?.status === 'running' || live.data?.status === 'paused';
  const pausedAt = live.data?.status === 'paused' ? live.data.pausedStepId : null;

  const saveNow = React.useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    setSaving('saving');
    savePromise.current = savePromise.current
      .then(() => api('PUT /flows/:id/graph', { params: { id: flowId }, body: graphRef.current }))
      .then(() => {
        setSaving('saved');
        qc.invalidateQueries({ queryKey: ['flow-sources', flowId] });
        qc.invalidateQueries({ queryKey: ['preview'] });
      })
      .catch((e) => {
        setSaving('error');
        toast.error(`Could not save flow: ${errorMessage(e)}`);
      });
    return savePromise.current;
  }, [flowId, qc]);

  // Keep the cached flow current, so reopening this tab shows the latest graph, not the one first loaded.
  React.useEffect(() => {
    qc.setQueryData<FlowDetail>(flowKeys.flow(flowId), (old) => (old ? { ...old, steps: graph.steps, connections: graph.connections } : old));
  }, [graph, flowId, qc]);

  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSaving('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveNow(), 500);
  }, [graph, saveNow]);

  React.useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        void api('PUT /flows/:id/graph', { params: { id: flowId }, body: graphRef.current }).catch(() => undefined);
      }
    },
    [flowId],
  );

  const updateStep = (id: string, patch: Partial<FlowStep>) =>
    setGraph((g) => ({ ...g, steps: g.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  /** Maps a step's inputs from earlier responses; `quiet` skips the toasts and returns what was mapped. */
  const autoMap = React.useCallback(
    async (stepId: string, quiet = false): Promise<MappingSuggestion[]> => {
      await saveNow();
      const step = graphRef.current.steps.find((s) => s.id === stepId);
      if (!step?.requestId) return [];
      try {
        const [suggestions, req] = await Promise.all([
          api('POST /flows/:id/suggest-mappings', { params: { id: flowId }, body: { stepId } }),
          qc.fetchQuery({ queryKey: ['request', step.requestId], queryFn: () => api('GET /requests/:id', { params: { id: step.requestId! } }) }) as Promise<SavedRequest>,
        ]);
        if (!suggestions.length) {
          if (!quiet) toast.message('Nothing to map', { description: 'Inputs already have values, or previous steps have no remembered response yet. Run the flow once and try again.' });
          return [];
        }
        const current = graphRef.current.steps.find((s) => s.id === stepId)!;
        const overrides = applySuggestions(current, req, suggestions);
        graphRef.current = { ...graphRef.current, steps: graphRef.current.steps.map((s) => (s.id === stepId ? { ...s, overrides } : s)) };
        updateStep(stepId, { overrides });
        if (!quiet) toast.success(`Mapped ${suggestions.length} input${suggestions.length > 1 ? 's' : ''} in "${current.name}"`, { description: describeMappings(suggestions) });
        return suggestions;
      } catch (e) {
        toast.error(errorMessage(e));
        return [];
      }
    },
    [flowId, qc, saveNow],
  );

  const connect = (source: string, target: string, handle: FlowHandle) => {
    if (source === target) return;
    if (graphRef.current.connections.some((c) => c.source === source && c.target === target && c.handle === handle)) return;
    const conn: FlowConnection = { id: newId(8), source, target, handle };
    setGraph((g) => ({ ...g, connections: [...g.connections, conn] }));
    const targetStep = graphRef.current.steps.find((s) => s.id === target);
    if (targetStep?.kind === 'request')
      setTimeout(async () => {
        const mapped = await autoMap(target, true);
        if (mapped.length) toast.success(`Mapped ${mapped.length} input${mapped.length > 1 ? 's' : ''} in "${targetStep.name}"`, { description: describeMappings(mapped) });
      }, 0);
  };

  /** Adds steps as a chain after the selected step (or the flow's only end), then maps their inputs in order. */
  const addSteps = (choices: AddChoice[]) => {
    if (!choices.length) return;
    const g = graphRef.current;
    let from = g.steps.find((s) => s.id === selected) ?? sinkOf(g);
    const taken = g.steps.map((s) => s.name);
    const placed = [...g.steps];
    const added: FlowStep[] = [];
    const links: FlowConnection[] = [];
    for (const choice of choices) {
      const desired = from
        ? { x: from.position.x + (from.kind === 'condition' ? -150 : 0), y: from.position.y + (from.kind === 'condition' ? 150 : 130) }
        : rf.screenToFlowPosition({ x: window.innerWidth / 3, y: window.innerHeight / 3 });
      const step: FlowStep = {
        id: newId(8),
        name: uniqueStepName(choice.kind === 'request' ? choice.name : 'Condition', taken),
        kind: choice.kind,
        requestId: choice.kind === 'request' ? choice.requestId : null,
        overrides: {},
        expression: '',
        failOnHttpError: true,
        breakpoint: false,
        scripts: { pre: '', post: '' },
        position: freeSpot(desired, placed),
      };
      if (from) links.push({ id: newId(8), source: from.id, target: step.id, handle: from.kind === 'condition' ? 'true' : 'out' });
      taken.push(step.name);
      placed.push(step);
      added.push(step);
      from = step;
    }
    const next = { steps: [...g.steps, ...added], connections: [...g.connections, ...links] };
    graphRef.current = next;
    setGraph(next);
    setSelected(added.at(-1)!.id);
    setInspectorTab('inputs');
    setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1, duration: 300 }), 50);
    void (async () => {
      const results: string[] = [];
      for (const step of added) {
        if (step.kind !== 'request' || !g.steps.length && step === added[0]) continue;
        const mapped = await autoMap(step.id, true);
        if (mapped.length) results.push(`${step.name}: ${describeMappings(mapped)}`);
      }
      const what = added.length > 1 ? `Added ${added.length} steps` : `Added "${added[0]!.name}"`;
      if (results.length) toast.success(`${what} and mapped their inputs`, { description: results.join('\n') });
      else if (added.length > 1) toast.success(what);
    })();
  };

  // Steps queued by "Run folder as a flow": taken inside the timer so a re-run effect adds them once.
  const addStepsRef = React.useRef(addSteps);
  addStepsRef.current = addSteps;
  const pending = usePendingSteps((st) => st.byFlow[flowId]);
  React.useEffect(() => {
    if (!pending?.length) return;
    const timer = setTimeout(() => {
      const steps = usePendingSteps.getState().byFlow[flowId];
      if (!steps?.length) return;
      usePendingSteps.getState().take(flowId);
      addStepsRef.current(steps);
    }, 300);
    return () => clearTimeout(timer);
  }, [pending, flowId]);

  const nodes: StepNode[] = graph.steps.map((s) => {
    const req = s.requestId ? requests.get(s.requestId) : undefined;
    return {
      id: s.id,
      type: s.kind,
      position: s.position,
      measured: measured[s.id],
      selected: s.id === selected,
      data: { step: s, method: req?.method ?? null, requestName: req?.name ?? null, run: runs.get(s.id), issue: issueFor(s, graph.steps), paused: s.id === pausedAt },
    };
  });

  const edges: Edge[] = graph.connections.map((c) => {
    const target = runs.get(c.target);
    const color = c.handle === 'error' || c.handle === 'false' ? 'var(--destructive)' : c.handle === 'true' ? 'var(--success)' : 'var(--muted-foreground)';
    const taken = runs.get(c.source)?.handle === c.handle;
    return {
      id: c.id,
      source: c.source,
      target: c.target,
      sourceHandle: c.handle,
      selected: c.id === selectedEdge,
      animated: target?.status === 'running',
      label: c.handle === 'out' ? undefined : c.handle === 'error' ? 'on error' : c.handle,
      labelStyle: { fill: color, fontSize: 11 },
      labelBgStyle: { fill: 'var(--background)' },
      style: { stroke: color, strokeWidth: taken ? 2.25 : 1.5, opacity: live.data && !taken && runs.has(c.source) ? 0.45 : 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    };
  });

  const onNodesChange = (changes: NodeChange<StepNode>[]) => {
    const sizes = changes.flatMap((c) => (c.type === 'dimensions' && c.dimensions ? [[c.id, c.dimensions] as const] : []));
    if (sizes.length)
      setMeasured((m) => {
        const changed = sizes.filter(([id, d]) => m[id]?.width !== d.width || m[id]?.height !== d.height);
        return changed.length ? { ...m, ...Object.fromEntries(changed) } : m;
      });
    const positions = changes.filter((c) => c.type === 'position' && c.position);
    const moved = applyNodeChanges(positions, nodes);
    const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id));
    const select = changes.find((c) => c.type === 'select' && c.selected);
    if (select && select.type === 'select') {
      setSelected(select.id);
      setSelectedEdge(null);
    }
    if (positions.length || removed.size) {
      setGraph((g) => ({
        steps: g.steps.filter((s) => !removed.has(s.id)).map((s) => ({ ...s, position: moved.find((n) => n.id === s.id)?.position ?? s.position })),
        connections: g.connections.filter((c) => !removed.has(c.source) && !removed.has(c.target)),
      }));
      if (selected && removed.has(selected)) setSelected(null);
    }
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id));
    const select = changes.find((c) => c.type === 'select' && c.selected);
    if (select && select.type === 'select') setSelectedEdge(select.id);
    if (removed.size) setGraph((g) => ({ ...g, connections: g.connections.filter((c) => !removed.has(c.id)) }));
  };

  const onConnect = (c: Connection) => connect(c.source, c.target, (c.sourceHandle as FlowHandle | null) ?? 'out');

  const run = async (debug = false) => {
    await saveNow();
    try {
      const exec = await api('POST /flows/:id/run', { params: { id: flowId }, body: { debug } });
      qc.setQueryData(flowKeys.execution(exec.id), { ...exec, steps: [] });
      setExecutionId(exec.id);
      await qc.invalidateQueries({ queryKey: flowKeys.executions(flowId) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const resume = async (mode: 'continue' | 'step') => {
    if (!currentId) return;
    await saveNow();
    api('POST /executions/:id/continue', { params: { id: currentId }, body: { mode } }).catch((e) => toast.error(errorMessage(e)));
  };

  const stop = () => currentId && api('POST /executions/:id/stop', { params: { id: currentId }, body: {} }).catch((e) => toast.error(errorMessage(e)));

  const rerun = async (stepId: string) => {
    if (!currentId) return;
    await saveNow();
    try {
      const exec = await api('POST /executions/:id/steps/:stepId/rerun', { params: { id: currentId, stepId }, body: {} });
      qc.setQueryData(flowKeys.execution(exec.id), (old: object | undefined) => ({ ...(old ?? { steps: [] }), ...exec }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const saveMeta = async (patch: { name?: string; settings?: { stopOnError: boolean } }) => {
    try {
      const f = await api('PATCH /flows/:id', { params: { id: flowId }, body: patch });
      qc.setQueryData<FlowDetail>(flowKeys.flow(flowId), (old) => (old ? { ...old, name: f.name, settings: f.settings } : old));
      qc.invalidateQueries({ queryKey: flowKeys.list });
      if (patch.name) useTabs.getState().onFlowRenamed(flowId, f.name);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const step = graph.steps.find((s) => s.id === selected) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <WorkflowIcon className="size-4 text-primary" />
        <input
          aria-label="Flow name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== initial.name && saveMeta({ name: name.trim() })}
          className="min-w-40 bg-transparent text-sm font-semibold outline-none"
        />
        <span className="text-[11px] text-muted-foreground">{saving === 'saving' ? 'Saving…' : saving === 'error' ? 'Not saved' : 'Saved'}</span>
        <div className="ml-auto flex items-center gap-2">
          <AddStepMenu onAdd={addSteps} />
          <Tooltip content="Flow variables, available to every step">
            <Button variant="ghost" size="sm" onClick={() => setVarsOpen(true)}>
              <VariableIcon /> Variables
            </Button>
          </Tooltip>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch
              checked={stopOnError}
              onCheckedChange={(v) => {
                setStopOnError(v);
                void saveMeta({ settings: { stopOnError: v } });
              }}
            />
            Stop on error
          </label>
          {pausedAt ? (
            <>
              <span className="text-xs text-warning">Paused before “{graph.steps.find((s) => s.id === pausedAt)?.name}”</span>
              <Tooltip content="Run this step and pause before the next">
                <Button size="sm" variant="outline" onClick={() => resume('step')}>
                  <StepForwardIcon /> Step
                </Button>
              </Tooltip>
              <Button size="sm" onClick={() => resume('continue')}>
                <SkipForwardIcon /> Continue
              </Button>
              <Button size="sm" variant="secondary" onClick={stop}>
                <SquareIcon /> Stop
              </Button>
            </>
          ) : running ? (
            <Button size="sm" variant="secondary" onClick={stop}>
              <SquareIcon /> Stop
            </Button>
          ) : (
            <>
              <Tooltip content="Pause before every step; edit inputs while paused">
                <Button size="sm" variant="outline" onClick={() => run(true)} disabled={!graph.steps.length}>
                  <BugIcon /> Debug
                </Button>
              </Tooltip>
              <Button size="sm" onClick={() => run()} disabled={!graph.steps.length}>
                <PlayIcon /> Run flow
              </Button>
            </>
          )}
        </div>
      </div>

      <ResizableGroup id="flow-vertical" orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="flow-top" defaultSize="70%" minSize="30%">
          <ResizableGroup id="flow-horizontal">
            <ResizablePanel id="flow-canvas" minSize="35%">
              <div className="relative h-full">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onPaneClick={() => setSelectedEdge(null)}
                  colorMode={theme}
                  fitView
                  fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                  deleteKeyCode={['Backspace', 'Delete']}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={20} size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
                {!graph.steps.length && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-lg border bg-background/90 p-6 text-center shadow-sm">
                      <WorkflowIcon className="size-6 text-primary" />
                      <div className="text-sm font-medium">Build a flow from saved requests</div>
                      <p className="max-w-xs text-xs text-muted-foreground">
                        Tick the requests to run, in order. They are connected into a chain and their inputs are mapped from earlier responses. You can also right-click a folder and choose Create flow.
                      </p>
                      <AddStepMenu onAdd={addSteps} label="Add first step" variant="default" />
                    </div>
                  </div>
                )}
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="flow-inspector" defaultSize="36%" minSize={300}>
              {step ? (
                <StepInspector
                  key={step.id}
                  flowId={flowId}
                  step={step}
                  run={runs.get(step.id)}
                  tab={inspectorTab}
                  onTab={setInspectorTab}
                  onChange={(patch) => updateStep(step.id, patch)}
                  onAutoMap={() => void autoMap(step.id)}
                  onRerun={currentId && !running ? () => void rerun(step.id) : null}
                  nameTaken={graph.steps.some((s) => s.id !== step.id && s.name.trim().toLowerCase() === step.name.trim().toLowerCase())}
                />
              ) : (
                <EmptyState title="No step selected">Select a step on the canvas to edit its inputs or see its result.</EmptyState>
              )}
            </ResizablePanel>
          </ResizableGroup>
        </ResizablePanel>
        <ResizableHandle orientation="vertical" />
        <ResizablePanel id="flow-log" defaultSize="30%" minSize="12%">
          <ExecutionPanel
            executions={executions.data ?? []}
            executionId={currentId}
            onSelectExecution={setExecutionId}
            detail={live.data}
            selectedStepId={selected}
            onSelectStep={(id) => {
              setSelected(id);
              setInspectorTab('result');
            }}
          />
        </ResizablePanel>
      </ResizableGroup>

      <Dialog open={varsOpen} onOpenChange={setVarsOpen}>
        <DialogContent className="flex h-[60vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Flow variables</DialogTitle>
            <DialogDescription>Available as {'{{name}}'} in every step. They override collection and environment variables.</DialogDescription>
          </DialogHeader>
          <VariablesTable scope="flow" ownerId={flowId} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Moves a new node right until it no longer overlaps an existing one. */
function freeSpot(p: { x: number; y: number }, steps: FlowStep[]): { x: number; y: number } {
  const pos = { ...p };
  while (steps.some((s) => Math.abs(s.position.x - pos.x) < 260 && Math.abs(s.position.y - pos.y) < 100)) pos.x += 280;
  return pos;
}

function sinkOf(g: FlowGraph): FlowStep | undefined {
  const sinks = g.steps.filter((s) => !g.connections.some((c) => c.source === s.id));
  return sinks.length === 1 ? sinks[0] : undefined;
}
