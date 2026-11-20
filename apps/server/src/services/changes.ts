import { EventEmitter } from 'node:events';

export interface WorkspaceChange {
  /** The app window that made the change (its X-Postguy-Client header), or null for Claude and other API users. */
  origin: string | null;
  /** What changed, e.g. "POST /requests" or "mcp:create_request". */
  what: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function notifyChange(change: WorkspaceChange) {
  bus.emit('change', change);
}

export function onChange(fn: (change: WorkspaceChange) => void): () => void {
  bus.on('change', fn);
  return () => bus.off('change', fn);
}
