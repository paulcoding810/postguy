import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangleIcon, CheckCircle2Icon, CircleDashedIcon, GitBranchIcon, LoaderIcon, SkipForwardIcon, XCircleIcon } from 'lucide-react';
import type { ExecutionStep, FlowStep, StepStatus } from '@postguy/shared';
import { cn, formatMs } from '@/lib/utils';

export interface StepNodeData extends Record<string, unknown> {
  step: FlowStep;
  method: string | null;
  requestName: string | null;
  run: ExecutionStep | undefined;
  issue: string | null;
}

export type StepNode = Node<StepNodeData, 'request' | 'condition'>;

const BORDER: Record<StepStatus | 'idle', string> = {
  idle: 'border-border',
  pending: 'border-border',
  running: 'border-info shadow-[0_0_0_3px] shadow-info/20',
  success: 'border-success',
  failed: 'border-destructive',
  skipped: 'border-dashed border-muted-foreground/50 opacity-70',
};

export function StatusIcon({ status, className }: { status: StepStatus | undefined; className?: string }) {
  const c = cn('size-3.5 shrink-0', className);
  switch (status) {
    case 'running':
      return <LoaderIcon className={cn(c, 'animate-spin text-info')} />;
    case 'success':
      return <CheckCircle2Icon className={cn(c, 'text-success')} />;
    case 'failed':
      return <XCircleIcon className={cn(c, 'text-destructive')} />;
    case 'skipped':
      return <SkipForwardIcon className={cn(c, 'text-muted-foreground')} />;
    default:
      return <CircleDashedIcon className={cn(c, 'text-muted-foreground')} />;
  }
}

function RunLine({ run }: { run: ExecutionStep | undefined }) {
  if (!run) return <span className="text-muted-foreground">Not run yet</span>;
  if (run.status === 'running') return <span className="text-info">Running…</span>;
  if (run.status === 'skipped') return <span className="text-muted-foreground">Skipped</span>;
  const r = run.response;
  return (
    <span className={cn('truncate', run.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
      {r?.status ? `${r.status} · ${formatMs(r.timeMs)}` : ''}
      {run.handle && run.handle !== 'out' ? ` → ${run.handle}` : ''}
      {run.status === 'failed' && run.error ? `${r?.status ? ' · ' : ''}${run.error}` : ''}
    </span>
  );
}

const handleClass = '!size-2.5 !border-2 !border-background';

export function RequestNode({ data, selected }: NodeProps<StepNode>) {
  const { step, method, requestName, run, issue } = data;
  return (
    <div className={cn('w-60 rounded-lg border-2 bg-card text-[12px] shadow-sm', BORDER[run?.status ?? 'idle'], selected && 'ring-2 ring-primary/60')}>
      <Handle type="target" position={Position.Top} className={cn(handleClass, '!bg-muted-foreground')} />
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className={cn('font-mono text-[10px] font-bold', method ? `method-${method}` : 'text-muted-foreground')}>{method ?? '—'}</span>
        <span className="truncate font-semibold">{step.name}</span>
        <StatusIcon status={run?.status} className="ml-auto" />
      </div>
      <div className="flex flex-col gap-0.5 px-3 py-1.5">
        {requestName && requestName !== step.name && <span className="truncate text-muted-foreground">{requestName}</span>}
        {issue ? (
          <span className="flex items-center gap-1 text-warning">
            <AlertTriangleIcon className="size-3" /> {issue}
          </span>
        ) : (
          <RunLine run={run} />
        )}
      </div>
      <Handle type="source" id="out" position={Position.Bottom} className={cn(handleClass, '!bg-success')} />
      <Handle type="source" id="error" position={Position.Right} className={cn(handleClass, '!bg-destructive')} title="On error" />
    </div>
  );
}

export function ConditionNode({ data, selected }: NodeProps<StepNode>) {
  const { step, run, issue } = data;
  return (
    <div className={cn('relative w-60 rounded-lg border-2 bg-card text-[12px] shadow-sm', BORDER[run?.status ?? 'idle'], selected && 'ring-2 ring-primary/60')}>
      <Handle type="target" position={Position.Top} className={cn(handleClass, '!bg-muted-foreground')} />
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <GitBranchIcon className="size-3.5 text-warning" />
        <span className="truncate font-semibold">{step.name}</span>
        <StatusIcon status={run?.status} className="ml-auto" />
      </div>
      <div className="flex flex-col gap-0.5 px-3 pt-1.5 pb-4">
        <span className="truncate font-mono text-[11px] text-muted-foreground">{step.expression || 'No expression'}</span>
        {issue ? <span className="text-warning">{issue}</span> : <RunLine run={run} />}
      </div>
      <span className="pointer-events-none absolute bottom-1 left-[30%] -translate-x-1/2 text-[10px] font-medium text-success">true</span>
      <span className="pointer-events-none absolute bottom-1 left-[70%] -translate-x-1/2 text-[10px] font-medium text-destructive">false</span>
      <Handle type="source" id="true" position={Position.Bottom} style={{ left: '30%' }} className={cn(handleClass, '!bg-success')} />
      <Handle type="source" id="false" position={Position.Bottom} style={{ left: '70%' }} className={cn(handleClass, '!bg-destructive')} />
    </div>
  );
}

export const nodeTypes = { request: RequestNode, condition: ConditionNode };
