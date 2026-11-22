import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import type { SavedRequest } from '@postguy/shared';
import { api, errorMessage } from '@/lib/api';
import { keys } from '@/hooks/queries';
import { useTabs, type RequestTab } from '@/stores/tabs';
import { create } from 'zustand';

const controllers = new Map<string, AbortController>();

export function useSendRequest() {
  const qc = useQueryClient();
  return React.useCallback(
    async (tab: RequestTab) => {
      const { setSending, setResponse } = useTabs.getState();
      controllers.get(tab.id)?.abort();
      const controller = new AbortController();
      controllers.set(tab.id, controller);
      setSending(tab.id, true);
      const sent = tab.draft;
      try {
        const res = await api('POST /send', {
          body: { requestId: tab.requestId, collectionId: tab.collectionId, request: sent },
          signal: controller.signal,
        });
        setResponse(tab.id, res, sent);
        qc.invalidateQueries({ queryKey: ['history'] });
        qc.invalidateQueries({ queryKey: ['snapshots'] });
        qc.invalidateQueries({ queryKey: ['reference-sources'] });
        qc.invalidateQueries({ queryKey: ['schema'] });
        qc.invalidateQueries({ queryKey: ['preview'] });
        qc.invalidateQueries({ queryKey: ['context-vars'] });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') toast.error(errorMessage(e));
      } finally {
        if (controllers.get(tab.id) === controller) controllers.delete(tab.id);
        setSending(tab.id, false);
      }
    },
    [qc],
  );
}

export function cancelSend(tabId: string) {
  controllers.get(tabId)?.abort();
}

interface SaveDialogState {
  tabId: string | null;
  open: (tabId: string) => void;
  close: () => void;
}

export const useSaveDialog = create<SaveDialogState>((set) => ({
  tabId: null,
  open: (tabId) => set({ tabId }),
  close: () => set({ tabId: null }),
}));

export function useSaveRequest() {
  const qc = useQueryClient();
  return React.useCallback(
    async (tab: RequestTab, opts?: { saveAs?: boolean }): Promise<SavedRequest | null> => {
      if (!tab.requestId || opts?.saveAs) {
        useSaveDialog.getState().open(tab.id);
        return null;
      }
      try {
        const saved = await api('PATCH /requests/:id', { params: { id: tab.requestId }, body: tab.draft });
        useTabs.getState().markSaved(tab.id, saved);
        qc.invalidateQueries({ queryKey: keys.tree });
        qc.setQueryData(keys.request(saved.id), saved);
        toast.success('Saved');
        return saved;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [qc],
  );
}
