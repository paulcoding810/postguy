import { ChevronRightIcon, ClipboardIcon, CopyIcon, CornerDownLeftIcon } from 'lucide-react';
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
  /** Levels open at first; 3 by default. */
  openDepth?: number;
  /** Shows a copy-value action on each row. */
  onCopyValue?: (value: unknown) => void;
  /** Tooltip for the copy action; defaults to copying a reference. */
  copyLabel?: (path: string) => string;
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

const ROW = 24;
const OVERSCAN = 20;
/** Past this many rows the tree stops listing and asks for a filter. */
const MAX_ROWS = 200_000;

interface FlatRow {
  name: string;
  value: unknown;
  segs: Seg[];
  depth: number;
  path: string;
  open: boolean;
  container: boolean;
}

/** Path of a child, built from its parent's the same way `formatSegs` does. */
function childPath(parent: string, k: Seg): string {
  const seg = formatSegs([k]);
  return !parent || seg.startsWith('[') ? parent + seg : `${parent}.${seg}`;
}

/** Paths of nodes that match the filter or contain a match, found in one pass. */
function matching(value: unknown, q: string): Set<string> {
  const hits = new Set<string>();
  const walk = (v: unknown, path: string): boolean => {
    let hit = path.toLowerCase().includes(q);
    if (v !== null && typeof v === 'object') {
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) if (walk(v[i], `${path}[${i}]`)) hit = true;
      } else for (const k in v) if (walk((v as Record<string, unknown>)[k], childPath(path, k))) hit = true;
    } else if (!hit) hit = String(v).toLowerCase().includes(q);
    if (hit) hits.add(path);
    return hit;
  };
  walk(value, '');
  return hits;
}

function flatten(value: unknown, openDepth: number, toggled: Set<string>, hits: Set<string> | null): { rows: FlatRow[]; truncated: boolean } {
  const rows: FlatRow[] = [];
  let truncated = false;
  const visit = (v: unknown, segs: Seg[], parentPath: string, depth: number) => {
    const entries: [Seg, unknown][] = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v as object);
    for (const [k, x] of entries) {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        return;
      }
      const childSegs = [...segs, k];
      const path = childPath(parentPath, k);
      if (hits && !hits.has(path)) continue;
      const container = x !== null && typeof x === 'object';
      const open = container && (hits ? true : depth < openDepth !== toggled.has(path));
      rows.push({ name: typeof k === 'number' ? `[${k}]` : k, value: x, segs: childSegs, depth, path, open, container });
      if (open) visit(x, childSegs, path, depth + 1);
    }
  };
  visit(value, [], '', 0);
  return { rows, truncated };
}

function Row({ row, props, onToggle }: { row: FlatRow; props: JsonTreeProps; onToggle: (path: string) => void }) {
  const { value, path, depth } = row;
  const k = kind(value);
  return (
    <div
      style={{ paddingLeft: depth * 12 + 4 }}
      className="group flex h-6 items-center gap-1 pr-1 font-mono text-[12px] hover:bg-accent/60"
      onDoubleClick={() => path && props.canInsert && props.onInsert(path)}
    >
      <button type="button" onClick={() => onToggle(path)} className={cn('shrink-0', !row.container && 'invisible')} aria-label="Toggle">
        <ChevronRightIcon className={cn('size-3 text-muted-foreground transition-transform', row.open && 'rotate-90')} />
      </button>
      <span className="shrink-0 text-foreground">{row.name}</span>
      <span className="shrink-0 text-muted-foreground">:</span>
      {row.container ? (
        <span className="truncate text-muted-foreground">{k === 'array' ? `[${(value as unknown[]).length}]` : `{${Object.keys(value as object).length}}`}</span>
      ) : (
        <span className={cn('truncate', TONE[k])}>{scalarText(value)}</span>
      )}
      <span className="ml-auto flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
        {props.onCopyValue && (
          <Tooltip content="Copy value">
            <button type="button" className="rounded p-0.5 hover:bg-background" onClick={() => props.onCopyValue!(value)} aria-label="Copy value">
              <ClipboardIcon className="size-3" />
            </button>
          </Tooltip>
        )}
        <Tooltip content={props.copyLabel?.(path) ?? `Copy {{…${path}}}`}>
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
    </div>
  );
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

/** Rows on screen in the nearest scrolling ancestor, so only those are rendered. */
function useVisibleRange(ref: React.RefObject<HTMLDivElement | null>, count: number): [number, number] {
  const [range, setRange] = React.useState<[number, number]>([0, 60]);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = scrollParent(el);
    const update = () => {
      const top = el.getBoundingClientRect().top - (parent?.getBoundingClientRect().top ?? 0);
      const height = parent?.clientHeight ?? window.innerHeight;
      const start = Math.max(0, Math.floor(-top / ROW) - OVERSCAN);
      const end = Math.min(count, Math.ceil((height - top) / ROW) + OVERSCAN);
      setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]));
    };
    update();
    const target = parent ?? window;
    target.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    if (parent) observer.observe(parent);
    return () => {
      target.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref, count]);
  return range;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function JsonTree(props: JsonTreeProps) {
  const { value, openDepth = 3 } = props;
  const q = useDebounced(props.filter?.trim().toLowerCase() ?? '', 250);
  const [toggled, setToggled] = React.useState<Set<string>>(() => new Set());
  const isTree = value !== null && typeof value === 'object';
  const hits = React.useMemo(() => (isTree && q ? matching(value, q) : null), [isTree, value, q]);
  const { rows, truncated } = React.useMemo(() => (isTree ? flatten(value, openDepth, toggled, hits) : { rows: [], truncated: false }), [isTree, value, openDepth, toggled, hits]);
  const ref = React.useRef<HTMLDivElement>(null);
  const [start, end] = useVisibleRange(ref, rows.length);

  const toggle = React.useCallback((path: string) => {
    setToggled((t) => {
      const next = new Set(t);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);

  if (!isTree) return <div className="p-2 font-mono text-xs">{scalarText(value)}</div>;
  return (
    <div className="py-1">
      <div ref={ref} style={{ height: rows.length * ROW, position: 'relative' }}>
        <div style={{ position: 'absolute', top: start * ROW, left: 0, right: 0 }}>
          {rows.slice(start, end).map((row) => (
            <Row key={row.path} row={row} props={props} onToggle={toggle} />
          ))}
        </div>
      </div>
      {truncated && <p className="px-3 py-1 text-[11px] text-muted-foreground">Showing the first {MAX_ROWS.toLocaleString()} rows. Collapse some, or filter, to see the rest.</p>}
      {q && !rows.length && <p className="px-3 py-1 text-[11px] text-muted-foreground">Nothing matches.</p>}
    </div>
  );
}
