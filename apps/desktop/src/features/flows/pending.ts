import { create } from 'zustand';
import type { AddChoice } from './AddStepMenu';

export interface PendingWork {
  steps: AddChoice[];
  /** Start a run once the steps are in. */
  run: boolean;
}

/** Work queued for a flow that is about to open, e.g. from "Run collection". */
export const usePendingSteps = create<{
  byFlow: Record<string, PendingWork>;
  queue: (flowId: string, steps: AddChoice[], opts?: { run?: boolean }) => void;
  take: (flowId: string) => void;
}>((set) => ({
  byFlow: {},
  queue: (flowId, steps, opts) => set((s) => ({ byFlow: { ...s.byFlow, [flowId]: { steps, run: !!opts?.run } } })),
  take: (flowId) =>
    set((s) => {
      const { [flowId]: _taken, ...rest } = s.byFlow;
      return { byFlow: rest };
    }),
}));
