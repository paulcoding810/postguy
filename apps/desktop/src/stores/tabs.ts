import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { newId, type RequestDefinition, type SavedRequest, type SendResult } from '@postguy/shared';

export interface RequestTab {
  kind?: 'request';
  id: string;
  requestId: string | null;
  collectionId: string | null;
  draft: RequestDefinition;
  saved: RequestDefinition | null;
  response: SendResult | null;
  sending: boolean;
  preview: boolean;
}

export interface FlowTab {
  kind: 'flow';
  id: string;
  flowId: string;
  name: string;
}

export type Tab = RequestTab | FlowTab;

export function isRequestTab(t: Tab | null | undefined): t is RequestTab {
  return !!t && t.kind !== 'flow';
}

export function blankRequest(name = 'New Request'): RequestDefinition {
  return {
    name,
    method: 'GET',
    url: '',
    params: [],
    pathParams: [],
    headers: [],
    auth: { type: 'inherit' },
    body: { mode: 'none' },
    settings: {},
  };
}

export function toDefinition(r: SavedRequest | RequestDefinition): RequestDefinition {
  return {
    name: r.name,
    method: r.method,
    url: r.url,
    params: r.params ?? [],
    pathParams: r.pathParams ?? [],
    headers: r.headers ?? [],
    auth: r.auth ?? { type: 'inherit' },
    body: r.body ?? { mode: 'none' },
    settings: r.settings ?? {},
  };
}

export function isDirty(tab: Tab): boolean {
  if (!isRequestTab(tab)) return false;
  if (!tab.saved) return true;
  return JSON.stringify(tab.draft) !== JSON.stringify(tab.saved);
}

interface TabsState {
  tabs: Tab[];
  openFlow: (flow: { id: string; name: string }) => void;
  onFlowRenamed: (flowId: string, name: string) => void;
  onFlowDeleted: (flowId: string) => void;
  activeId: string | null;
  openRequest: (saved: SavedRequest, opts?: { pin?: boolean }) => void;
  newRequest: (collectionId?: string | null, def?: RequestDefinition) => string;
  activate: (id: string) => void;
  pin: (id: string) => void;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  updateDraft: (id: string, fn: (d: RequestDefinition) => RequestDefinition) => void;
  markSaved: (id: string, saved: SavedRequest) => void;
  setSending: (id: string, sending: boolean) => void;
  setResponse: (id: string, res: SendResult | null) => void;
  onRequestDeleted: (requestId: string) => void;
  onRequestRenamed: (requestId: string, name: string) => void;
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,

      openFlow: (flow) => {
        const existing = get().tabs.find((t) => t.kind === 'flow' && t.flowId === flow.id);
        if (existing) return set({ activeId: existing.id });
        const tab: FlowTab = { kind: 'flow', id: newId(), flowId: flow.id, name: flow.name };
        set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
      },
      onFlowRenamed: (flowId, name) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.kind === 'flow' && t.flowId === flowId ? { ...t, name } : t)) })),
      onFlowDeleted: (flowId) => {
        const tab = get().tabs.find((t) => t.kind === 'flow' && t.flowId === flowId);
        if (tab) get().close(tab.id);
      },

      openRequest: (saved, opts) => {
        const existing = get().tabs.find((t) => isRequestTab(t) && t.requestId === saved.id);
        if (existing) {
          set((s) => ({
            activeId: existing.id,
            tabs: opts?.pin ? s.tabs.map((t) => (t.id === existing.id ? { ...t, preview: false } : t)) : s.tabs,
          }));
          return;
        }
        const def = toDefinition(saved);
        const tab: RequestTab = {
          id: newId(),
          requestId: saved.id,
          collectionId: saved.collectionId,
          draft: def,
          saved: def,
          response: null,
          sending: false,
          preview: !opts?.pin,
        };
        set((s) => {
          const replaceable = s.tabs.find((t) => isRequestTab(t) && t.preview && !isDirty(t) && !t.response);
          const tabs = replaceable ? s.tabs.map((t) => (t.id === replaceable.id ? tab : t)) : [...s.tabs, tab];
          return { tabs, activeId: tab.id };
        });
      },

      newRequest: (collectionId = null, def) => {
        const tab: RequestTab = {
          id: newId(),
          requestId: null,
          collectionId,
          draft: def ?? blankRequest(),
          saved: null,
          response: null,
          sending: false,
          preview: false,
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
        return tab.id;
      },

      activate: (id) => set({ activeId: id }),
      pin: (id) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && isRequestTab(t) ? { ...t, preview: false } : t)) })),

      close: (id) =>
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          const tabs = s.tabs.filter((t) => t.id !== id);
          const activeId = s.activeId === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.activeId;
          return { tabs, activeId };
        }),

      closeOthers: (id) => set((s) => ({ tabs: s.tabs.filter((t) => t.id === id), activeId: id })),

      updateDraft: (id, fn) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && isRequestTab(t) ? { ...t, draft: fn(t.draft), preview: false } : t)) })),

      markSaved: (id, saved) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id && isRequestTab(t)
              ? { ...t, requestId: saved.id, collectionId: saved.collectionId, saved: toDefinition(saved), draft: toDefinition(saved) }
              : t,
          ),
        })),

      setSending: (id, sending) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && isRequestTab(t) ? { ...t, sending } : t)) })),
      setResponse: (id, response) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && isRequestTab(t) ? { ...t, response } : t)) })),

      onRequestDeleted: (requestId) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (isRequestTab(t) && t.requestId === requestId ? { ...t, requestId: null, saved: null } : t)),
        })),

      onRequestRenamed: (requestId, name) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            isRequestTab(t) && t.requestId === requestId
              ? { ...t, draft: { ...t.draft, name }, saved: t.saved ? { ...t.saved, name } : t.saved }
              : t,
          ),
        })),
    }),
    {
      name: 'postguy.tabs',
      version: 1,
      partialize: (s) => ({
        activeId: s.activeId,
        tabs: s.tabs.map((t) => (isRequestTab(t) ? { ...t, response: null, sending: false } : t)),
      }),
    },
  ),
);

export function useActiveTab(): Tab | null {
  return useTabs((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
}

export function useActiveRequestTab(): RequestTab | null {
  return useTabs((s) => {
    const t = s.tabs.find((x) => x.id === s.activeId);
    return isRequestTab(t) ? t : null;
  });
}
