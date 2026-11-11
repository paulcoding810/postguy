import { keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { VariableInput, VariableScope } from '@postguy/shared';
import { api, errorMessage } from '@/lib/api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { onError: (e) => toast.error(errorMessage(e)) },
  },
});

export const keys = {
  tree: ['tree'] as const,
  environments: ['environments'] as const,
  variables: (scope: VariableScope, ownerId: string) => ['variables', scope, ownerId] as const,
  contextVars: (collectionId: string | null, requestId: string | null, flowId?: string | null) => ['context-vars', collectionId, requestId, flowId ?? null] as const,
  history: (requestId?: string) => ['history', requestId ?? 'all'] as const,
  historyEntry: (id: string) => ['history-entry', id] as const,
  request: (id: string) => ['request', id] as const,
  preview: (templates: string[], collectionId: string | null, requestId: string | null, flow?: FlowRef | null) =>
    ['preview', collectionId, requestId, flow?.flowId ?? null, flow?.stepId ?? null, templates] as const,
};

export function useTree() {
  return useQuery({ queryKey: keys.tree, queryFn: () => api('GET /collections/tree') });
}

export function useEnvironments() {
  return useQuery({ queryKey: keys.environments, queryFn: () => api('GET /environments') });
}

export function useVariables(scope: VariableScope, ownerId: string | null | undefined, reveal = false) {
  return useQuery({
    queryKey: [...keys.variables(scope, ownerId ?? ''), reveal],
    queryFn: () => api('GET /variables/:scope/:ownerId', { params: { scope, ownerId: ownerId! }, query: reveal ? { reveal: '1' } : {} }),
    enabled: !!ownerId,
  });
}

export interface FlowRef {
  flowId: string;
  stepId: string;
}

export function useContextVariables(collectionId: string | null, requestId: string | null, flowId?: string | null) {
  return useQuery({
    queryKey: keys.contextVars(collectionId, requestId, flowId),
    queryFn: () =>
      api('GET /context-variables', {
        query: { collectionId: collectionId ?? undefined, requestId: requestId ?? undefined, flowId: flowId ?? undefined },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useHistory(requestId?: string) {
  return useQuery({
    queryKey: keys.history(requestId),
    queryFn: () => api('GET /history', { query: { requestId, limit: 200 } }),
  });
}

export function useResolvePreview(templates: string[], collectionId: string | null, requestId: string | null, flow?: FlowRef | null) {
  const unique = [...new Set(templates.filter((t) => t.includes('{{')))].sort();
  return useQuery({
    queryKey: keys.preview(unique, collectionId, requestId, flow),
    queryFn: () =>
      api('POST /resolve-preview', { body: { templates: unique, collectionId, requestId, flowId: flow?.flowId, stepId: flow?.stepId } }).then(
        (list) => new Map(list.map((p) => [p.template, p])),
      ),
    enabled: unique.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 2_000,
  });
}

/** Invalidates everything that depends on variable values. */
export function useInvalidateVariables() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['variables'] });
    qc.invalidateQueries({ queryKey: ['context-vars'] });
    qc.invalidateQueries({ queryKey: ['preview'] });
  };
}

export function useSaveVariables(scope: VariableScope, ownerId: string) {
  const invalidate = useInvalidateVariables();
  return useMutation({
    mutationFn: (variables: VariableInput[]) =>
      api('PUT /variables/:scope/:ownerId', { params: { scope, ownerId }, body: { variables } }),
    onSuccess: invalidate,
  });
}

export function useActivateEnvironment() {
  const qc = useQueryClient();
  const invalidate = useInvalidateVariables();
  return useMutation({
    mutationFn: async (id: string | null) => {
      if (id) await api('POST /environments/:id/activate', { params: { id }, body: {} });
      else await api('POST /environments/deactivate', { body: {} });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.environments });
      invalidate();
    },
  });
}
