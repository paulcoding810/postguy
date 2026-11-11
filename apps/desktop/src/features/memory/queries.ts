import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useReferenceSources(collectionId: string | null) {
  return useQuery({
    queryKey: ['reference-sources', collectionId],
    queryFn: () => api('GET /reference-sources', { query: { collectionId: collectionId ?? undefined } }),
    placeholderData: keepPreviousData,
  });
}

export function useSnapshots(requestId: string | null) {
  return useQuery({
    queryKey: ['snapshots', requestId],
    queryFn: () => api('GET /requests/:id/snapshots', { params: { id: requestId! } }),
    enabled: !!requestId,
  });
}

export function useSnapshot(id: string | null) {
  return useQuery({
    queryKey: ['snapshot', id],
    queryFn: () => api('GET /snapshots/:id', { params: { id: id! } }),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function useEffectiveSchema(requestId: string | null) {
  return useQuery({
    queryKey: ['schema', requestId],
    queryFn: () => api('GET /requests/:id/schema', { params: { id: requestId! } }),
    enabled: !!requestId,
  });
}
