import { ChevronRightIcon, CopyIcon, CornerDownLeftIcon } from 'lucide-react';
import * as React from 'react';
import { Tooltip } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { formatSegs, type Seg } from './refs';

export interface JsonTreeProps {
  value: unknown;
  onInsert: (path: string) => void;
  onCopy: (path: string) => void;
  canInsert: boolean;
  filter?: string;
}

function kind(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function scalarText(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v.length > 80 ? `${v.slice(0, 80)}…` : v);
  return String(v);
}

const TONE: Record<string, string> = {
  string: 'text-success',
  number: 'text-info',
  boolean: 'text-warning',
  null: 'text-muted-foreground italic',
};

function matchesFilter(v: unknown, segs: Seg[], q: string): boolean {
  if (!q) return true;
  if (formatSegs(segs).toLowerCase().includes(q)) return true;
  if (v !== null && typeof v === 'object') {
    const entries = Array.isArray(v) ? v.slice(0, 50).map((x, i) => [i, x] as const) : Object.entries(v);
    return entries.some(([k, x]) => matchesFilter(x, [...segs, k], q));
  }
  return String(v).toLowerCase().includes(q);
}

function Row({ name, value, segs, depth, props }: { name: string; value: unknown; segs: Seg[]; depth: number; props: JsonTreeProps }) {
  const k = kind(value);
  const container = k === 'object' || k === 'array';
  const q = props.filter?.trim().toLowerCase() ?? '';
  const [open, setOpen] = React.useState(depth < 3);
  const isOpen = q ? true : open;
  const path = formatSegs(segs);
  if (!matchesFilter(value, segs, q)) return null;

  const entries: [Seg, unknown][] = container
    ? Array.isArray(value)
      ? value.slice(0, 200).map((x, i) => [i, x])
      : Object.entries(value as Record<string, unknown>)
    : [];

  return (
    <div>
      <div
        style={{ paddingLeft: depth * 12 + 4 }}
        className="group flex h-6 items-center gap-1 pr-1 font-mono text-[12px] hover:bg-accent/60"
        onDoubleClick={() => path && props.canInsert && props.onInsert(path)}
      >
        <button type="button" onClick={() => setOpen(!open)} className={cn('shrink-0', !container && 'invisible')} aria-label="Toggle">
          <ChevronRightIcon className={cn('size-3 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
        </button>
        <span className="shrink-0 text-foreground">{name}</span>
        <span className="shrink-0 text-muted-foreground">:</span>
        {container ? (
          <span className="truncate text-muted-foreground">
            {k === 'array' ? `[${(value as unknown[]).length}]` : `{${Object.keys(value as object).length}}`}
          </span>
        ) : (
          <span className={cn('truncate', TONE[k])}>{scalarText(value)}</span>
        )}
        {path && (
          <span className="ml-auto flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
            <Tooltip content={`Copy {{…${path}}}`}>
              <button type="button" className="rounded p-0.5 hover:bg-background" onClick={() => props.onCopy(path)} aria-label="Copy reference">
                <CopyIcon className="size-3" />
              </button>
            </Tooltip>
            {props.canInsert && (
              <Tooltip content="Insert reference into the focused field (or double-click)">
                <button type="button" className="rounded p-0.5 text-primary hover:bg-background" onClick={() => props.onInsert(path)} aria-label="Insert reference">
                  <CornerDownLeftIcon className="size-3" />
                </button>
              </Tooltip>
            )}
          </span>
        )}
      </div>
      {container && isOpen && entries.map(([key, v]) => (
        <Row key={String(key)} name={typeof key === 'number' ? `[${key}]` : key} value={v} segs={[...segs, key]} depth={depth + 1} props={props} />
      ))}
      {container && isOpen && Array.isArray(value) && value.length > 200 && (
        <div style={{ paddingLeft: (depth + 1) * 12 + 20 }} className="text-[11px] text-muted-foreground">
          … {value.length - 200} more items
        </div>
      )}
    </div>
  );
}

export function JsonTree(props: JsonTreeProps) {
  const { value } = props;
  if (value === null || typeof value !== 'object') {
    return <div className="p-2 font-mono text-xs">{scalarText(value)}</div>;
  }
  const entries: [Seg, unknown][] = Array.isArray(value) ? value.map((x, i) => [i, x]) : Object.entries(value);
  return (
    <div className="py-1">
      {entries.map(([k, v]) => (
        <Row key={String(k)} name={typeof k === 'number' ? `[${k}]` : k} value={v} segs={[k]} depth={0} props={props} />
      ))}
    </div>
  );
}
