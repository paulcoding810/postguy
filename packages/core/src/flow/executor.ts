import type { FlowConnection, FlowGraph, FlowHandle, FlowStep, RequestDefinition, StepOverrides, StepStatus } from '@postguy/shared';
import type { ResponseRecord } from '../template/context.ts';
import { checkExpression, ExpressionError } from './expression.ts';

export function applyOverrides(def: RequestDefinition, o: StepOverrides): RequestDefinition {
  return {
    ...def,
    url: o.url ?? def.url,
    params: o.params ?? def.params,
    pathParams: o.pathParams ?? def.pathParams,
    headers: o.headers ?? def.headers,
    auth: o.auth ?? def.auth,
    body: o.body ?? def.body,
  };
}

/** Steps in dependency order; ties keep canvas order (top to bottom, left to right). Null when cyclic. */
export function topoOrder(graph: FlowGraph): FlowStep[] | null {
  const ids = new Set(graph.steps.map((s) => s.id));
  const indegree = new Map(graph.steps.map((s) => [s.id, 0]));
  for (const c of graph.connections) if (ids.has(c.source) && ids.has(c.target)) indegree.set(c.target, indegree.get(c.target)! + 1);
  const byPos = [...graph.steps].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const out: FlowStep[] = [];
  const done = new Set<string>();
  while (out.length < graph.steps.length) {
    const next = byPos.find((s) => !done.has(s.id) && indegree.get(s.id) === 0);
    if (!next) return null;
    done.add(next.id);
    out.push(next);
    for (const c of graph.connections) if (c.source === next.id && ids.has(c.target)) indegree.set(c.target, indegree.get(c.target)! - 1);
  }
  return out;
}

export interface GraphIssue {
  stepId?: string;
  message: string;
}

export function validateGraph(graph: FlowGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  if (!graph.steps.length) issues.push({ message: 'The flow has no steps' });
  const names = new Map<string, string>();
  const ids = new Set(graph.steps.map((s) => s.id));
  for (const s of graph.steps) {
    const key = s.name.trim().toLowerCase();
    if (names.has(key)) issues.push({ stepId: s.id, message: `Two steps are named "${s.name}"; references need unique names` });
    names.set(key, s.id);
    if (s.kind === 'request' && !s.requestId) issues.push({ stepId: s.id, message: `Step "${s.name}" has no request` });
    if (s.kind === 'condition') {
      if (!s.expression.trim()) issues.push({ stepId: s.id, message: `Condition "${s.name}" has no expression` });
      else
        try {
          checkExpression(s.expression);
        } catch (e) {
          issues.push({ stepId: s.id, message: `Condition "${s.name}": ${(e as ExpressionError).message}` });
        }
    }
  }
  for (const c of graph.connections) {
    if (!ids.has(c.source) || !ids.has(c.target)) issues.push({ message: 'A connection points to a missing step' });
    if (c.source === c.target) issues.push({ stepId: c.source, message: 'A step cannot connect to itself' });
  }
  if (graph.steps.length && !topoOrder(graph)) issues.push({ message: 'The flow has a cycle; connections must not loop back' });
  return issues;
}

/** Steps upstream of a step (its ancestors), nearest first. */
export function upstreamSteps(graph: FlowGraph, stepId: string): FlowStep[] {
  const byId = new Map(graph.steps.map((s) => [s.id, s]));
  const out: FlowStep[] = [];
  const seen = new Set<string>([stepId]);
  let frontier = [stepId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier)
      for (const c of graph.connections)
        if (c.target === id && !seen.has(c.source)) {
          seen.add(c.source);
          const s = byId.get(c.source);
          if (s) {
            out.push(s);
            next.push(s.id);
          }
        }
    frontier = next;
  }
  return out;
}

export interface StepOutcome {
  /** Request steps: whether the step succeeded. Condition steps: the branch taken. */
  ok: boolean;
  record?: ResponseRecord;
  branch?: boolean;
  error?: string;
}

export interface ExecutorHooks {
  stopOnError: boolean;
  signal?: AbortSignal;
  run: (step: FlowStep, responses: ReadonlyMap<string, ResponseRecord>) => Promise<StepOutcome>;
  /** Awaited before a step runs; a debugger pauses here. */
  beforeStep?: (step: FlowStep) => void | Promise<void>;
  onStart?: (step: FlowStep) => void | Promise<void>;
  onFinish?: (step: FlowStep, status: StepStatus, handle: FlowHandle | null, outcome: StepOutcome) => void | Promise<void>;
  onSkip?: (step: FlowStep, reason: string) => void | Promise<void>;
}

export interface ExecutionResult {
  status: 'success' | 'failed' | 'stopped';
  error: string | null;
  responses: Map<string, ResponseRecord>;
}

/**
 * Runs a flow's steps one at a time in dependency order. A step runs when every
 * incoming connection is decided and at least one is active; responses come only
 * from steps of this run, keyed by step name.
 */
export async function executeFlow(graph: FlowGraph, hooks: ExecutorHooks, seed?: Map<string, ResponseRecord>): Promise<ExecutionResult> {
  const responses = seed ?? new Map<string, ResponseRecord>();
  const issues = validateGraph(graph);
  if (issues.length) return { status: 'failed', error: issues[0]!.message, responses };
  const order = topoOrder(graph)!;
  const status = new Map<string, StepStatus>(order.map((s) => [s.id, 'pending']));
  const chosen = new Map<string, FlowHandle | null>();
  const incoming = (id: string): FlowConnection[] => graph.connections.filter((c) => c.target === id);
  const hasEdge = (id: string, handle: FlowHandle) => graph.connections.some((c) => c.source === id && c.handle === handle);
  let failure: string | null = null;

  const skipRest = async (reason: string) => {
    for (const s of order)
      if (status.get(s.id) === 'pending') {
        status.set(s.id, 'skipped');
        await hooks.onSkip?.(s, reason);
      }
  };

  for (;;) {
    if (hooks.signal?.aborted) {
      await skipRest('Execution stopped');
      return { status: 'stopped', error: 'Stopped by user', responses };
    }
    const step = order.find((s) => {
      if (status.get(s.id) !== 'pending') return false;
      return incoming(s.id).every((c) => status.get(c.source) !== 'pending' && status.get(c.source) !== 'running');
    });
    if (!step) break;

    const edges = incoming(step.id);
    const active = edges.filter((c) => chosen.get(c.source) === c.handle);
    if (edges.length && !active.length) {
      status.set(step.id, 'skipped');
      await hooks.onSkip?.(step, 'No incoming branch was taken');
      continue;
    }

    await hooks.beforeStep?.(step);
    if (hooks.signal?.aborted) continue;
    status.set(step.id, 'running');
    await hooks.onStart?.(step);
    let outcome: StepOutcome;
    try {
      outcome = await hooks.run(step, responses);
    } catch (e) {
      outcome = { ok: false, error: (e as Error).message };
    }
    if (hooks.signal?.aborted) {
      status.set(step.id, 'failed');
      chosen.set(step.id, null);
      await hooks.onFinish?.(step, 'failed', null, { ok: false, error: 'Stopped by user' });
      await skipRest('Execution stopped');
      return { status: 'stopped', error: 'Stopped by user', responses };
    }
    if (outcome.record) responses.set(step.name, outcome.record);

    let handle: FlowHandle | null;
    let st: StepStatus;
    if (step.kind === 'condition') {
      st = outcome.error ? 'failed' : 'success';
      handle = outcome.error ? null : outcome.branch ? 'true' : 'false';
    } else if (outcome.ok) {
      st = 'success';
      handle = 'out';
    } else {
      st = 'failed';
      handle = hasEdge(step.id, 'error') ? 'error' : hooks.stopOnError ? null : 'out';
    }
    status.set(step.id, st);
    chosen.set(step.id, handle);
    await hooks.onFinish?.(step, st, handle, outcome);

    if (st === 'failed' && handle !== 'error') {
      failure ??= `Step "${step.name}" failed: ${outcome.error ?? 'error'}`;
      if (hooks.stopOnError) {
        await skipRest(`Stopped after "${step.name}" failed`);
        return { status: 'failed', error: failure, responses };
      }
    }
  }
  return { status: failure ? 'failed' : 'success', error: failure, responses };
}
