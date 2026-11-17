import * as React from 'react';
import type { FlowGraph } from '@postguy/shared';

const LIMIT = 100;
/** Changes closer together than this (a drag, a step and its auto-mapping) undo as one. */
const COALESCE_MS = 400;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('.monaco-editor');
}

/** Undo and redo for the flow graph, with ⌘Z / ⇧⌘Z (Ctrl off macOS) outside text fields. */
export function useGraphHistory(graph: FlowGraph, apply: (g: FlowGraph) => void) {
  const past = React.useRef<FlowGraph[]>([]);
  const future = React.useRef<FlowGraph[]>([]);
  const last = React.useRef(graph);
  const lastAt = React.useRef(0);
  const restoring = React.useRef(false);
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  const applyRef = React.useRef(apply);
  applyRef.current = apply;

  React.useEffect(() => {
    if (graph === last.current) return;
    if (restoring.current) {
      restoring.current = false;
    } else {
      const now = Date.now();
      if (now - lastAt.current > COALESCE_MS) {
        past.current = [...past.current, last.current].slice(-LIMIT);
      }
      future.current = [];
      lastAt.current = now;
      rerender();
    }
    last.current = graph;
  }, [graph]);

  const undo = React.useCallback(() => {
    const prev = past.current.at(-1);
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, last.current];
    restoring.current = true;
    lastAt.current = 0;
    applyRef.current(prev);
    rerender();
  }, []);

  const redo = React.useCallback(() => {
    const next = future.current.at(-1);
    if (!next) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, last.current];
    restoring.current = true;
    lastAt.current = 0;
    applyRef.current(next);
    rerender();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return { undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
