import * as React from 'react';
import { create } from 'zustand';
import type { ContextVariable, ResolvedPreview } from '@postguy/shared';

export interface Suggestion {
  value: string;
  label: string;
  detail: string;
  kind: 'variable' | 'response';
}

export interface TemplateCtx {
  status: (ref: string) => 'ok' | 'bad' | 'pending';
  preview: (ref: string) => ResolvedPreview['refs'][number] | undefined;
  variables: ContextVariable[];
  suggestions: (query: string) => Suggestion[];
}

const fallback: TemplateCtx = {
  status: () => 'pending',
  preview: () => undefined,
  variables: [],
  suggestions: () => [],
};

export const TemplateContext = React.createContext<TemplateCtx>(fallback);

export function useTemplateCtx() {
  return React.useContext(TemplateContext);
}

export interface InsertTarget {
  id: string;
  label: string;
  insert: (text: string) => void;
}

interface InsertRegistry {
  last: InsertTarget | null;
  setLast: (t: InsertTarget | null) => void;
}

/** Tracks the last focused template field so the data picker can insert into it. */
export const useInsertTarget = create<InsertRegistry>((set) => ({
  last: null,
  setLast: (last) => set({ last }),
}));
