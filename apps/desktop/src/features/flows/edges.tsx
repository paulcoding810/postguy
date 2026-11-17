import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { XIcon } from 'lucide-react';

export type ConnectionEdge = Edge<{ label?: string; color: string; onRemove: (id: string) => void }, 'connection'>;

/** A connection arrow with its label; when selected it shows a button that removes it. */
function ConnectionEdgeView({ id, selected, data, ...p }: EdgeProps<ConnectionEdge>) {
  const [path, x, y] = getBezierPath(p);
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={p.markerEnd} style={p.style} interactionWidth={24} />
      {(data?.label || selected) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute flex items-center gap-1 rounded bg-background px-1 text-[11px]"
            style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, color: data?.color }}
          >
            {data?.label}
            {selected && data && (
              <button
                type="button"
                aria-label="Remove connection"
                title="Remove connection (Backspace)"
                onClick={() => data.onRemove(id)}
                className="flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground hover:border-destructive hover:text-destructive"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { connection: ConnectionEdgeView };
