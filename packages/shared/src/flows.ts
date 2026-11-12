import { z } from 'zod';
import { Auth, Body, KeyValue, Scripts, type ScriptLog, type ScriptRun, type ValidationResult } from './models.ts';

/** Fields of a request a flow step replaces; absent fields come from the saved request. */
export const StepOverrides = z.object({
  url: z.string().optional(),
  params: z.array(KeyValue).optional(),
  pathParams: z.array(KeyValue).optional(),
  headers: z.array(KeyValue).optional(),
  auth: Auth.optional(),
  body: Body.optional(),
});
export type StepOverrides = z.infer<typeof StepOverrides>;

export const FLOW_STEP_KINDS = ['request', 'condition'] as const;
export type FlowStepKind = (typeof FLOW_STEP_KINDS)[number];

export const FLOW_HANDLES = ['out', 'error', 'true', 'false'] as const;
export const FlowHandle = z.enum(FLOW_HANDLES);
export type FlowHandle = z.infer<typeof FlowHandle>;

export const FlowStepInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  kind: z.enum(FLOW_STEP_KINDS),
  requestId: z.string().nullable().default(null),
  overrides: StepOverrides.default({}),
  expression: z.string().default(''),
  failOnHttpError: z.boolean().default(true),
  breakpoint: z.boolean().default(false),
  scripts: Scripts.default({ pre: '', post: '' }),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
});
export type FlowStepInput = z.input<typeof FlowStepInput>;
export type FlowStep = z.output<typeof FlowStepInput>;

export const FlowConnectionInput = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  handle: FlowHandle.default('out'),
});
export type FlowConnection = z.output<typeof FlowConnectionInput>;

export const FlowGraphInput = z.object({
  steps: z.array(FlowStepInput).max(200),
  connections: z.array(FlowConnectionInput).max(1000),
});
export type FlowGraph = z.output<typeof FlowGraphInput>;

export const FlowSettings = z.object({
  stopOnError: z.boolean().default(true),
  stepTimeoutMs: z.number().int().positive().max(600_000).optional(),
});
export type FlowSettings = z.output<typeof FlowSettings>;

export interface Flow {
  id: string;
  name: string;
  description: string | null;
  collectionId: string | null;
  settings: FlowSettings;
  createdAt: number;
  updatedAt: number;
}

export interface FlowDetail extends Flow, FlowGraph {}

export const CreateFlowInput = z.object({
  name: z.string().min(1),
  collectionId: z.string().nullable().default(null),
  description: z.string().nullable().optional(),
});
export const UpdateFlowInput = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  collectionId: z.string().nullable().optional(),
  settings: z.object({ stopOnError: z.boolean().optional(), stepTimeoutMs: z.number().int().positive().max(600_000).optional() }).optional(),
});

export type ExecutionStatus = 'running' | 'paused' | 'success' | 'failed' | 'stopped';
export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export type StepLog = ScriptLog;

export interface StepResponse {
  status: number | null;
  statusText: string | null;
  headers: Record<string, string>;
  body: unknown;
  bodyText: string | null;
  contentType: string | null;
  size: number;
  timeMs: number;
}

export interface ExecutionStep {
  id: string;
  executionId: string;
  stepId: string;
  stepName: string;
  attempt: number;
  status: StepStatus;
  handle: FlowHandle | null;
  request: { method: string; url: string; headers: Record<string, string> } | null;
  response: StepResponse | null;
  validation: ValidationResult | null;
  scripts: ScriptRun[] | null;
  historyId: string | null;
  logs: StepLog[];
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface FlowExecution {
  id: string;
  flowId: string;
  environmentId: string | null;
  status: ExecutionStatus;
  trigger: 'run' | 'rerun';
  /** Step the debugger is paused before. */
  pausedStepId: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface FlowExecutionDetail extends FlowExecution {
  steps: ExecutionStep[];
}

export type FlowEvent =
  | { type: 'execution'; execution: FlowExecution }
  | { type: 'step'; step: ExecutionStep };

export interface FlowSource {
  stepId: string;
  name: string;
  method: string | null;
  origin: 'execution' | 'snapshot' | 'none';
  body: unknown;
  status: number | null;
}

export interface MappingSuggestion {
  field: 'pathParam' | 'param' | 'header' | 'auth';
  key: string;
  ref: string;
  reason: string;
}
