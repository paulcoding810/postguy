import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import type { ExecutionStep, Flow, FlowExecution, FlowExecutionDetail } from '@postguy/shared';
import { api } from '@/lib/api';
import { streamEvents } from '@/lib/sse';

export const flowKeys = {
  list: ['flows'] as const,
  flow: (id: string) => ['flow', id] as const,
  executions: (id: string) => ['flow-executions', id] as const,
  execution: (id: string) => ['execution', id] as const,
  sources: (flowId: string, stepId: string) => ['flow-sources', flowId, stepId] as const,
};

/** Warns, without blocking, when a rename gives a flow the same name as another one. */
export function warnIfNameTaken(qc: QueryClient, flowId: string, name: string) {
  const clash = qc.getQueryData<Flow[]>(flowKeys.list)?.some((f) => f.id !== flowId && f.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (clash) toast.warning(`Another flow is also called "${name.trim()}"`, { description: 'Both keep working; a different name makes them easier to tell apart.' });
}

export function useFlows() {
  return useQuery({ queryKey: flowKeys.list, queryFn: () => api('GET /flows') });
}

export function useFlow(id: string) {
  return useQuery({ queryKey: flowKeys.flow(id), queryFn: () => api('GET /flows/:id', { params: { id } }), staleTime: Infinity });
}

export function useExecutions(flowId: string) {
  return useQuery({ queryKey: flowKeys.executions(flowId), queryFn: () => api('GET /flows/:id/executions', { params: { id: flowId } }) });
}

export function useFlowSources(flowId: string | null, stepId: string | null) {
  return useQuery({
    queryKey: flowKeys.sources(flowId ?? '', stepId ?? ''),
    queryFn: () => api('GET /flows/:id/sources', { params: { id: flowId! }, query: { stepId: stepId! } }),
    enabled: !!flowId && !!stepId,
  });
}

export function useSavedRequest(id: string | null) {
  return useQuery({ queryKey: ['request', id], queryFn: () => api('GET /requests/:id', { params: { id: id! } }), enabled: !!id, staleTime: 10_000 });
}

/** Execution detail kept live from the server's event stream while it runs. */
export function useLiveExecution(executionId: string | null, flowId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: flowKeys.execution(executionId ?? ''),
    queryFn: () => api('GET /executions/:id', { params: { id: executionId! } }),
    enabled: !!executionId,
  });
  const running = query.data?.status === 'running' || query.data?.status === 'paused';

  React.useEffect(() => {
    if (!executionId || !running) return;
    const ctl = new AbortController();
    const key = flowKeys.execution(executionId);
    streamEvents(
      `/executions/${executionId}/events`,
      (event, data) => {
        if (event === 'snapshot') qc.setQueryData(key, data as FlowExecutionDetail);
        else if (event === 'execution')
          qc.setQueryData<FlowExecutionDetail>(key, (old) => (old ? { ...old, ...(data as FlowExecution) } : old));
        else if (event === 'step')
          qc.setQueryData<FlowExecutionDetail>(key, (old) => {
            if (!old) return old;
            const step = data as ExecutionStep;
            const exists = old.steps.some((s) => s.id === step.id);
            return { ...old, steps: exists ? old.steps.map((s) => (s.id === step.id ? step : s)) : [...old.steps, step] };
          });
        else if (event === 'end') {
          qc.invalidateQueries({ queryKey: flowKeys.executions(flowId) });
          qc.invalidateQueries({ queryKey: ['flow-sources', flowId] });
          qc.invalidateQueries({ queryKey: ['history'] });
          qc.invalidateQueries({ queryKey: ['reference-sources'] });
          qc.invalidateQueries({ queryKey: ['preview'] });
        }
      },
      ctl.signal,
    ).catch(() => {
      if (!ctl.signal.aborted) void qc.invalidateQueries({ queryKey: key });
    });
    return () => ctl.abort();
  }, [executionId, running, flowId, qc]);

  return query;
}

/** Latest attempt of each step in an execution. */
export function latestByStep(detail: FlowExecutionDetail | undefined): Map<string, ExecutionStep> {
  const out = new Map<string, ExecutionStep>();
  for (const s of detail?.steps ?? []) {
    const cur = out.get(s.stepId);
    if (!cur || s.attempt >= cur.attempt) out.set(s.stepId, s);
  }
  return out;
}
