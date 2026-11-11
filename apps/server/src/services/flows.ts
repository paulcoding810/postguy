import { EventEmitter } from 'node:events';
import { and, asc, desc, eq, max } from 'drizzle-orm';
import {
  applyOverrides,
  evaluateExpression,
  ExpressionError,
  executeFlow,
  resolveTemplate,
  suggestMappings,
  upstreamSteps,
  validateGraph,
  type ResponseRecord,
  type StepOutcome,
} from '@postguy/core';
import {
  CreateFlowInput,
  FlowGraphInput,
  FlowSettings,
  newId,
  UpdateFlowInput,
  type ExecutionStep,
  type Flow,
  type FlowDetail,
  type FlowEvent,
  type FlowExecution,
  type FlowExecutionDetail,
  type FlowGraph,
  type FlowHandle,
  type FlowSource,
  type FlowStep,
  type MappingSuggestion,
  type RequestDefinition,
  type SavedRequest,
  type StepLog,
  type StepResponse,
  type StepStatus,
} from '@postguy/shared';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { flowConnections, flowExecutions, flowExecutionSteps, flows, flowSteps, requests, responseSnapshots } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { effectiveAuth, getCollection } from './collections.ts';
import { buildContext } from './context.ts';
import { activeEnvironment } from './environments.ts';
import { send } from './send.ts';

const BODY_TEXT_LIMIT = 1024 * 1024;

function toDefinition(r: SavedRequest): RequestDefinition {
  return { name: r.name, method: r.method, url: r.url, params: r.params, pathParams: r.pathParams, headers: r.headers, auth: r.auth, body: r.body, settings: r.settings };
}

function savedRequest(db: Db, id: string | null): SavedRequest | null {
  if (!id) return null;
  return (db.select().from(requests).where(eq(requests.id, id)).get() as SavedRequest | undefined) ?? null;
}

// ---------- CRUD ----------

export function listFlows(db: Db): Flow[] {
  return db.select().from(flows).orderBy(asc(flows.name)).all();
}

function getFlowRow(db: Db, id: string): Flow {
  const row = db.select().from(flows).where(eq(flows.id, id)).get();
  if (!row) throw notFound('Flow');
  return { ...row, settings: FlowSettings.parse(row.settings ?? {}) };
}

export function getGraph(db: Db, flowId: string): FlowGraph {
  const steps = db.select().from(flowSteps).where(eq(flowSteps.flowId, flowId)).orderBy(asc(flowSteps.sortOrder)).all();
  const conns = db.select().from(flowConnections).where(eq(flowConnections.flowId, flowId)).all();
  return {
    steps: steps.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      requestId: s.requestId,
      overrides: s.overrides,
      expression: s.expression,
      failOnHttpError: s.failOnHttpError,
      position: s.position,
    })),
    connections: conns.map((c) => ({ id: c.id, source: c.sourceStepId, target: c.targetStepId, handle: c.handle })),
  };
}

export function getFlow(db: Db, id: string): FlowDetail {
  return { ...getFlowRow(db, id), ...getGraph(db, id) };
}

export function createFlow(db: Db, input: z.output<typeof CreateFlowInput>): FlowDetail {
  if (input.collectionId) getCollection(db, input.collectionId);
  const now = Date.now();
  const id = newId();
  db.insert(flows)
    .values({ id, name: input.name, description: input.description ?? null, collectionId: input.collectionId, settings: { stopOnError: true }, createdAt: now, updatedAt: now })
    .run();
  return getFlow(db, id);
}

export function updateFlow(db: Db, id: string, input: z.output<typeof UpdateFlowInput>): FlowDetail {
  const current = getFlowRow(db, id);
  if (input.collectionId) getCollection(db, input.collectionId);
  db.update(flows)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.collectionId !== undefined && { collectionId: input.collectionId }),
      ...(input.settings && { settings: FlowSettings.parse({ ...current.settings, ...input.settings }) }),
      updatedAt: Date.now(),
    })
    .where(eq(flows.id, id))
    .run();
  return getFlow(db, id);
}

export function deleteFlow(db: Db, id: string): void {
  getFlowRow(db, id);
  if ([...runs.values()].some((r) => r.flowId === id)) throw new HttpError(409, 'Stop the running execution first', 'busy');
  db.delete(flows).where(eq(flows.id, id)).run();
}

/** Replaces the whole graph; the editor saves after each change. */
export function saveGraph(db: Db, flowId: string, input: z.output<typeof FlowGraphInput>): FlowDetail {
  getFlowRow(db, flowId);
  const ids = new Set(input.steps.map((s) => s.id));
  if (ids.size !== input.steps.length) throw badRequest('Step ids must be unique');
  for (const c of input.connections) if (!ids.has(c.source) || !ids.has(c.target)) throw badRequest('A connection points to a missing step');
  for (const s of input.steps) if (s.requestId && !savedRequest(db, s.requestId)) throw badRequest(`Request for step "${s.name}" does not exist`);
  db.transaction((tx) => {
    tx.delete(flowSteps).where(eq(flowSteps.flowId, flowId)).run();
    tx.delete(flowConnections).where(eq(flowConnections.flowId, flowId)).run();
    input.steps.forEach((s, i) =>
      tx.insert(flowSteps)
        .values({ id: s.id, flowId, name: s.name.trim(), kind: s.kind, requestId: s.requestId, overrides: s.overrides, expression: s.expression, failOnHttpError: s.failOnHttpError, position: s.position, sortOrder: i })
        .run(),
    );
    for (const c of input.connections)
      tx.insert(flowConnections).values({ id: c.id, flowId, sourceStepId: c.source, targetStepId: c.target, handle: c.handle }).run();
    tx.update(flows).set({ updatedAt: Date.now() }).where(eq(flows.id, flowId)).run();
  });
  return getFlow(db, flowId);
}

// ---------- executions ----------

interface Run {
  flowId: string;
  controller: AbortController;
  events: EventEmitter;
  done: Promise<void>;
}

const runs = new Map<string, Run>();

export function isRunning(executionId: string): boolean {
  return runs.has(executionId);
}

export function subscribe(executionId: string, fn: (e: FlowEvent | { type: 'end' }) => void): (() => void) | null {
  const run = runs.get(executionId);
  if (!run) return null;
  run.events.on('event', fn);
  return () => run.events.off('event', fn);
}

function executionRow(db: Db, id: string): FlowExecution {
  const row = db.select().from(flowExecutions).where(eq(flowExecutions.id, id)).get();
  if (!row) throw notFound('Execution');
  return row;
}

function stepRow(db: Db, id: string): ExecutionStep {
  return db.select().from(flowExecutionSteps).where(eq(flowExecutionSteps.id, id)).get() as ExecutionStep;
}

export function getExecution(db: Db, id: string): FlowExecutionDetail {
  const exec = executionRow(db, id);
  const steps = db
    .select()
    .from(flowExecutionSteps)
    .where(eq(flowExecutionSteps.executionId, id))
    .orderBy(asc(flowExecutionSteps.startedAt), asc(flowExecutionSteps.attempt))
    .all() as ExecutionStep[];
  return { ...exec, steps };
}

export function listExecutions(db: Db, flowId: string): FlowExecution[] {
  getFlowRow(db, flowId);
  return db.select().from(flowExecutions).where(eq(flowExecutions.flowId, flowId)).orderBy(desc(flowExecutions.startedAt)).limit(50).all();
}

function lookupFrom(responses: ReadonlyMap<string, ResponseRecord>) {
  return (name: string) => {
    const exact = responses.get(name);
    if (exact) return exact;
    const lower = name.toLowerCase();
    for (const [k, v] of responses) if (k.toLowerCase() === lower) return v;
    return undefined;
  };
}

function parseBody(body: string, contentType: string | null): unknown {
  if (!body) return null;
  if (/json/i.test(contentType ?? '') || /^\s*[[{]/.test(body)) {
    try {
      return JSON.parse(body);
    } catch {
      /* not JSON */
    }
  }
  return body;
}

interface StepContext {
  db: Db;
  flow: Flow;
  environmentId: string | null;
  signal: AbortSignal;
}

/** Runs one step against the given responses; never throws. */
async function runStep(
  c: StepContext,
  step: FlowStep,
  responses: ReadonlyMap<string, ResponseRecord>,
  logs: StepLog[],
  sink: { response?: StepResponse; request?: ExecutionStep['request']; validation?: ExecutionStep['validation']; historyId?: string | null },
): Promise<StepOutcome> {
  const log = (level: StepLog['level'], message: string) => logs.push({ at: Date.now(), level, message });
  const lookup = lookupFrom(responses);

  if (step.kind === 'condition') {
    try {
      const { ctx } = buildContext(c.db, { collectionId: c.flow.collectionId, environmentId: c.environmentId, flowId: c.flow.id, responses: lookup });
      const r = evaluateExpression(step.expression, ctx);
      if (r.unresolved.length) log('warn', `Unresolved in condition: ${r.unresolved.map((u) => `{{${u}}}`).join(', ')}`);
      log('info', `${step.expression} → ${r.value}`);
      return { ok: true, branch: r.value };
    } catch (e) {
      const msg = e instanceof ExpressionError ? `Invalid condition: ${e.message}` : (e as Error).message;
      log('error', msg);
      return { ok: false, error: msg };
    }
  }

  const saved = savedRequest(c.db, step.requestId);
  if (!saved) {
    log('error', 'The request for this step no longer exists');
    return { ok: false, error: 'Request not found' };
  }
  const def = applyOverrides(toDefinition(saved), step.overrides);
  if (c.flow.settings.stepTimeoutMs) def.settings = { ...def.settings, timeoutMs: c.flow.settings.stepTimeoutMs };
  const res = await send(
    c.db,
    { requestId: saved.id, collectionId: saved.collectionId, environmentId: c.environmentId, request: def },
    { signal: c.signal, responses: lookup, flowId: c.flow.id, failOnUnresolved: true },
  );
  sink.request = res.request;
  sink.validation = res.validation;
  sink.historyId = res.historyId;
  const body = res.bodyEncoding === 'utf8' ? parseBody(res.body, res.contentType) : null;
  sink.response = {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    body: typeof body === 'string' ? null : body,
    bodyText: typeof body === 'string' ? body.slice(0, BODY_TEXT_LIMIT) : null,
    contentType: res.contentType,
    size: res.size,
    timeMs: res.timing.totalMs,
  };
  if (res.error) {
    log('error', `${res.request.method} ${res.request.url}: ${res.error.message}`);
    return { ok: false, error: res.error.message };
  }
  log('info', `${res.request.method} ${res.request.url} → ${res.status} ${res.statusText ?? ''} in ${Math.round(res.timing.totalMs)} ms`);
  if (res.validation && !res.validation.ok)
    log('warn', `Schema: ${res.validation.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ')}`);
  const record: ResponseRecord = { name: step.name, status: res.status!, headers: res.headers, body, source: 'execution', requestId: saved.id };
  const failed = step.failOnHttpError && res.status! >= 400;
  if (failed) log('error', `HTTP ${res.status} counts as a failure`);
  return { ok: !failed, record, error: failed ? `HTTP ${res.status}` : undefined };
}

function nextAttempt(db: Db, executionId: string, stepId: string): number {
  const row = db
    .select({ m: max(flowExecutionSteps.attempt) })
    .from(flowExecutionSteps)
    .where(and(eq(flowExecutionSteps.executionId, executionId), eq(flowExecutionSteps.stepId, stepId)))
    .get();
  return (row?.m ?? 0) + 1;
}

function startRun(db: Db, executionId: string, flowId: string, work: (run: Run, emit: (e: FlowEvent) => void) => Promise<void>): FlowExecution {
  const controller = new AbortController();
  const events = new EventEmitter();
  events.setMaxListeners(50);
  const emit = (e: FlowEvent | { type: 'end' }) => events.emit('event', e);
  const run: Run = { flowId, controller, events, done: Promise.resolve() };
  runs.set(executionId, run);
  run.done = (async () => {
    try {
      await work(run, emit);
    } catch (e) {
      db.update(flowExecutions).set({ status: 'failed', error: (e as Error).message, finishedAt: Date.now() }).where(eq(flowExecutions.id, executionId)).run();
      emit({ type: 'execution', execution: executionRow(db, executionId) });
    } finally {
      runs.delete(executionId);
      emit({ type: 'end' });
    }
  })();
  return executionRow(db, executionId);
}

/** Hooks that persist each step attempt and stream it. */
function persistence(db: Db, c: StepContext, executionId: string, emit: (e: FlowEvent) => void) {
  const pending = new Map<string, { rowId: string; logs: StepLog[]; sink: Parameters<typeof runStep>[4] }>();
  return {
    run: async (step: FlowStep, responses: ReadonlyMap<string, ResponseRecord>) => {
      const p = pending.get(step.id)!;
      return runStep(c, step, responses, p.logs, p.sink);
    },
    onStart: (step: FlowStep) => {
      const rowId = newId();
      db.insert(flowExecutionSteps)
        .values({ id: rowId, executionId, stepId: step.id, stepName: step.name, attempt: nextAttempt(db, executionId, step.id), status: 'running', startedAt: Date.now() })
        .run();
      pending.set(step.id, { rowId, logs: [], sink: {} });
      emit({ type: 'step', step: stepRow(db, rowId) });
    },
    onFinish: (step: FlowStep, status: StepStatus, handle: FlowHandle | null, outcome: StepOutcome) => {
      const p = pending.get(step.id)!;
      db.update(flowExecutionSteps)
        .set({
          status,
          handle,
          request: p.sink.request ?? null,
          response: p.sink.response ?? null,
          validation: p.sink.validation ?? null,
          historyId: p.sink.historyId ?? null,
          logs: p.logs,
          error: outcome.error ?? null,
          finishedAt: Date.now(),
        })
        .where(eq(flowExecutionSteps.id, p.rowId))
        .run();
      emit({ type: 'step', step: stepRow(db, p.rowId) });
    },
    onSkip: (step: FlowStep, reason: string) => {
      const rowId = newId();
      const now = Date.now();
      db.insert(flowExecutionSteps)
        .values({
          id: rowId,
          executionId,
          stepId: step.id,
          stepName: step.name,
          attempt: nextAttempt(db, executionId, step.id),
          status: 'skipped',
          logs: [{ at: now, level: 'info', message: reason }],
          startedAt: now,
          finishedAt: now,
        })
        .run();
      emit({ type: 'step', step: stepRow(db, rowId) });
    },
  };
}

export function runFlow(db: Db, flowId: string, environmentId?: string | null): FlowExecution {
  const flow = getFlowRow(db, flowId);
  const graph = getGraph(db, flowId);
  const issues = validateGraph(graph);
  if (issues.length) throw new HttpError(422, issues[0]!.message, 'invalid_flow', issues);
  if ([...runs.values()].some((r) => r.flowId === flowId)) throw new HttpError(409, 'This flow is already running', 'busy');
  const envId = environmentId === undefined ? (activeEnvironment(db)?.id ?? null) : environmentId;
  const executionId = newId();
  db.insert(flowExecutions).values({ id: executionId, flowId, environmentId: envId, status: 'running', trigger: 'run', startedAt: Date.now() }).run();

  return startRun(db, executionId, flowId, async (run, emit) => {
    emit({ type: 'execution', execution: executionRow(db, executionId) });
    const c: StepContext = { db, flow, environmentId: envId, signal: run.controller.signal };
    const result = await executeFlow(graph, { stopOnError: flow.settings.stopOnError, signal: run.controller.signal, ...persistence(db, c, executionId, emit) });
    db.update(flowExecutions).set({ status: result.status, error: result.error, finishedAt: Date.now() }).where(eq(flowExecutions.id, executionId)).run();
    emit({ type: 'execution', execution: executionRow(db, executionId) });
  });
}

export function stopExecution(executionId: string): void {
  const run = runs.get(executionId);
  if (!run) throw badRequest('This execution is not running');
  run.controller.abort();
}

function latestAttempts(db: Db, executionId: string): Map<string, ExecutionStep> {
  const rows = db.select().from(flowExecutionSteps).where(eq(flowExecutionSteps.executionId, executionId)).orderBy(asc(flowExecutionSteps.attempt)).all() as ExecutionStep[];
  const out = new Map<string, ExecutionStep>();
  for (const r of rows) out.set(r.stepId, r);
  return out;
}

function recordOf(s: ExecutionStep, name: string): ResponseRecord | null {
  if (!s.response || s.response.status === null || (s.status !== 'success' && s.status !== 'failed')) return null;
  return { name, status: s.response.status, headers: s.response.headers, body: s.response.body ?? s.response.bodyText, source: 'execution' };
}

/** Re-runs one step with the responses its execution already produced; the result is a new attempt. */
export function rerunStep(db: Db, executionId: string, stepId: string): FlowExecution {
  const exec = executionRow(db, executionId);
  if (runs.has(executionId)) throw new HttpError(409, 'This execution is still running', 'busy');
  if ([...runs.values()].some((r) => r.flowId === exec.flowId)) throw new HttpError(409, 'This flow is already running', 'busy');
  const flow = getFlowRow(db, exec.flowId);
  const graph = getGraph(db, exec.flowId);
  const step = graph.steps.find((s) => s.id === stepId);
  if (!step) throw notFound('Step');
  const names = new Map(graph.steps.map((s) => [s.id, s.name]));
  const seed = new Map<string, ResponseRecord>();
  for (const [sid, attempt] of latestAttempts(db, executionId)) {
    if (sid === stepId) continue;
    const r = recordOf(attempt, names.get(sid) ?? attempt.stepName);
    if (r) seed.set(r.name, r);
  }
  db.update(flowExecutions).set({ status: 'running', trigger: 'rerun', error: null, finishedAt: null }).where(eq(flowExecutions.id, executionId)).run();

  return startRun(db, executionId, exec.flowId, async (run, emit) => {
    emit({ type: 'execution', execution: executionRow(db, executionId) });
    const c: StepContext = { db, flow, environmentId: exec.environmentId, signal: run.controller.signal };
    const hooks = persistence(db, c, executionId, emit);
    hooks.onStart(step);
    let outcome: StepOutcome;
    try {
      outcome = await hooks.run(step, seed);
    } catch (e) {
      outcome = { ok: false, error: (e as Error).message };
    }
    const status: StepStatus = step.kind === 'condition' ? (outcome.error ? 'failed' : 'success') : outcome.ok ? 'success' : 'failed';
    const handle: FlowHandle | null = step.kind === 'condition' ? (outcome.error ? null : outcome.branch ? 'true' : 'false') : outcome.ok ? 'out' : null;
    hooks.onFinish(step, status, handle, outcome);
    const latest = [...latestAttempts(db, executionId).values()];
    const failedStep = latest.find((s) => s.status === 'failed');
    db.update(flowExecutions)
      .set({ status: failedStep ? 'failed' : 'success', error: failedStep ? `Step "${failedStep.stepName}" failed: ${failedStep.error ?? 'error'}` : null, finishedAt: Date.now() })
      .where(eq(flowExecutions.id, executionId))
      .run();
    emit({ type: 'execution', execution: executionRow(db, executionId) });
  });
}

export async function waitForExecution(executionId: string): Promise<void> {
  await runs.get(executionId)?.done;
}

// ---------- editor helpers ----------

/**
 * Upstream steps of a step with sample data for the picker: the step's response in the
 * latest execution of this flow, else its request's latest successful snapshot.
 */
export function flowSources(db: Db, flowId: string, stepId: string): FlowSource[] {
  getFlowRow(db, flowId);
  const graph = getGraph(db, flowId);
  if (!graph.steps.some((s) => s.id === stepId)) throw notFound('Step');
  const lastExec = db.select({ id: flowExecutions.id }).from(flowExecutions).where(eq(flowExecutions.flowId, flowId)).orderBy(desc(flowExecutions.startedAt)).limit(1).get();
  const attempts = lastExec ? latestAttempts(db, lastExec.id) : new Map<string, ExecutionStep>();
  return upstreamSteps(graph, stepId)
    .filter((s) => s.kind === 'request')
    .map((s) => {
      const saved = savedRequest(db, s.requestId);
      const attempt = attempts.get(s.id);
      if (attempt?.response && attempt.response.status !== null && attempt.status === 'success')
        return { stepId: s.id, name: s.name, method: saved?.method ?? null, origin: 'execution', body: attempt.response.body ?? attempt.response.bodyText, status: attempt.response.status };
      const snapId = saved?.pinnedSnapshotId ?? saved?.latestSuccessSnapshotId;
      const snap = snapId ? db.select().from(responseSnapshots).where(eq(responseSnapshots.id, snapId)).get() : undefined;
      if (snap) return { stepId: s.id, name: s.name, method: saved!.method, origin: 'snapshot', body: JSON.parse(snap.body), status: snap.status };
      return { stepId: s.id, name: s.name, method: saved?.method ?? null, origin: 'none', body: null, status: null };
    });
}

/** Response lookup used only for editor previews: upstream steps' sample data by step name. */
export function previewLookup(db: Db, flowId: string, stepId: string) {
  const map = new Map<string, ResponseRecord>();
  for (const s of flowSources(db, flowId, stepId))
    if (s.origin !== 'none') map.set(s.name, { name: s.name, status: s.status ?? 0, headers: {}, body: s.body, source: s.origin === 'execution' ? 'execution' : 'snapshot' });
  return lookupFrom(map);
}

export function stepCollectionId(db: Db, flowId: string, stepId: string): string | null {
  const step = getGraph(db, flowId).steps.find((s) => s.id === stepId);
  return savedRequest(db, step?.requestId ?? null)?.collectionId ?? getFlowRow(db, flowId).collectionId;
}

export function suggestStepMappings(db: Db, flowId: string, stepId: string): MappingSuggestion[] {
  const graph = getGraph(db, flowId);
  const step = graph.steps.find((s) => s.id === stepId);
  if (!step) throw notFound('Step');
  const saved = savedRequest(db, step.requestId);
  if (step.kind !== 'request' || !saved) return [];
  const def = applyOverrides(toDefinition(saved), step.overrides);
  const sources = flowSources(db, flowId, stepId).filter((s) => s.origin !== 'none');
  const { ctx } = buildContext(db, { collectionId: saved.collectionId, flowId, responses: previewLookup(db, flowId, stepId) });
  const isUnresolved = (t: string) => {
    const r = resolveTemplate(t, ctx);
    return r.unresolved.length > 0 || r.value.trim() === '';
  };
  return suggestMappings(def, effectiveAuth(db, saved.collectionId, def.auth), sources, isUnresolved);
}
