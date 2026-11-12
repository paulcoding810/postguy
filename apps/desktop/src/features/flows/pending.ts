import { create } from 'zustand';
import type { AddChoice } from './AddStepMenu';

/** Steps queued for a flow that is about to open, e.g. from "Create flow from folder". */
export const usePendingSteps = create<{ byFlow: Record<string, AddChoice[]>; queue: (flowId: string, steps: AddChoice[]) => void; take: (flowId: string) => void }>((set) => ({
  byFlow: {},
  queue: (flowId, steps) => set((s) => ({ byFlow: { ...s.byFlow, [flowId]: steps } })),
  take: (flowId) =>
    set((s) => {
      const { [flowId]: _taken, ...rest } = s.byFlow;
      return { byFlow: rest };
    }),
}));
