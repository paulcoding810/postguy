import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIcon, BotIcon, ChevronRightIcon, FilePlusIcon, PencilIcon, PlayIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import type { ActivityItem, ChangeEntry } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, Tooltip } from '@/components/ui/misc';
import { confirm } from '@/components/dialogs';
import { TextDiff } from '@/components/TextDiff';
import { keys, useTree } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { cn, formatMs, statusTone, timeAgo } from '@/lib/utils';
import { useTabs } from '@/stores/tabs';
import { allRequests, chainTo } from '@/features/collections/treeUtils';
import { summary } from '@/features/collections/ChangeHistory';
import { changeText } from '@/features/collections/changeText';
import { HistoryDetailDialog } from './HistoryDetail';
import { dayLabel, openHistoryEntry, pathOf } from './historyEntries';

type Kind = ActivityItem['kind'];
type Who = 'all' | 'you' | 'claude' | 'script' | 'other';

const KINDS: { id: Kind; label: string }[] = [
  { id: 'send', label: 'Sent' },
  { id: 'change', label: 'Changes' },
  { id: 'flow', label: 'Flow runs' },
];
const WHO: { id: Who; label: string }[] = [
  { id: 'all', label: 'Everyone' },
  { id: 'you', label: 'You' },
  { id: 'claude', label: 'Claude' },
  { id: 'script', label: 'Scripts' },
  { id: 'other', label: 'Other' },
];
const WHO_BADGE: Record<string, { label: string; tone: string } | undefined> = {
  claude: { label: 'Claude', tone: 'bg-info/15 text-info' },
  script: { label: 'script', tone: 'bg-muted text-muted-foreground' },
  api: { label: 'API', tone: 'bg-muted text-muted-foreground' },
  sync: { label: 'sync', tone: 'bg-warning/15 text-warning' },
  import: { label: 'import', tone: 'bg-muted text-muted-foreground' },
};

const PAGE = 60;
/** Claude's changes this close together, of the same kind, show as one expandable row. */
const BATCH_MS = 3000;

type Row = { type: 'item'; item: ActivityItem } | { type: 'batch'; items: Extract<ActivityItem, { kind: 'change' }>[] };

function batchKey(i: ActivityItem): string | null {
  if (i.kind !== 'change' || i.who !== 'claude') return null;
  return `${i.change.entityType}:${i.change.action}:${isMove(i.change) ? 'move' : ''}`;
}

function isMove(c: ChangeEntry): boolean {
  const parent = (s: unknown) => {
    const o = s as { request?: { collectionId?: string }; collection?: { parentId?: string | null } } | null;
    return o?.request?.collectionId ?? o?.collection?.parentId;
  };
  return c.action === 'update' && !!c.before && !!c.after && parent(c.before) !== parent(c.after);
}

function rowsOf(items: ActivityItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    const key = batchKey(item);
    const last = rows.at(-1);
    const lastItem = last?.type === 'batch' ? last.items.at(-1) : last?.item;
    if (key && lastItem && batchKey(lastItem) === key && lastItem.at - item.at < BATCH_MS) {
      if (last!.type === 'batch') last!.items.push(item as never);
      else rows[rows.length - 1] = { type: 'batch', items: [lastItem as never, item as never] };
    } else rows.push({ type: 'item', item });
  }
  return rows;
}

/** History, changes and flow runs in one timeline, with who did each. */
export function ActivityList({ filter }: { filter: string }) {
  const [kinds, setKinds] = React.useState<Set<Kind>>(() => new Set(['send', 'change', 'flow']));
  const [who, setWho] = React.useState<Who>('all');
  const q = filter.trim();
  const tree = useTree();
  const names = React.useMemo(() => new Map(allRequests(tree.data).map((r) => [r.id, r.name])), [tree.data]);
  const qc = useQueryClient();
  const activity = useInfiniteQuery({
    queryKey: ['history', 'activity', [...kinds].sort().join(','), who, q],
    queryFn: ({ pageParam }) =>
      api('GET /activity', { query: { limit: PAGE, kinds: [...kinds].join(','), ...(who !== 'all' && { who }), ...(q && { q }), ...(pageParam && { before: pageParam }) } }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next,
    refetchInterval: 5000,
  });
  const items = React.useMemo(() => activity.data?.pages.flatMap((p) => p.items) ?? [], [activity.data]);
  const rows = React.useMemo(() => rowsOf(items), [items]);
  const [viewingSend, setViewingSend] = React.useState<string | null>(null);
  const [viewingChange, setViewingChange] = React.useState<{ change: ChangeEntry; collection: string | null } | null>(null);

  const toggleKind = (k: Kind) =>
    setKinds((s) => {
      const next = new Set(s);
      if (next.has(k) && next.size > 1) next.delete(k);
      else next.add(k);
      return next;
    });

  const clearSends = async () => {
    if (!(await confirm({ title: 'Clear the requests you sent?', description: 'Changes and flow runs stay.', destructive: true, confirmLabel: 'Clear' }))) return;
    await api('DELETE /history');
    await qc.invalidateQueries({ queryKey: ['history'] });
  };

  let lastDay = '';
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            aria-pressed={kinds.has(k.id)}
            onClick={() => toggleKind(k.id)}
            className={cn('rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground', kinds.has(k.id) && 'border-primary/50 bg-primary/10 text-foreground')}
          >
            {k.label}
          </button>
        ))}
        <select aria-label="Who" value={who} onChange={(e) => setWho(e.target.value as Who)} className="ml-auto h-6 rounded border bg-background px-1 text-[11px]">
          {WHO.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
      </div>
      {!rows.length && !activity.isLoading ? (
        <EmptyState icon={<ActivityIcon className="size-6" />} title={q || who !== 'all' || kinds.size < 3 ? 'Nothing matches' : 'No activity yet'}>
          {q || who !== 'all' || kinds.size < 3 ? 'Try other filters.' : 'Requests you send, changes to collections and flow runs appear here, including what Claude does.'}
        </EmptyState>
      ) : (
        <div className="py-1">
          {rows.map((row) => {
            const at = row.type === 'batch' ? row.items[0]!.at : row.item.at;
            const day = dayLabel(at);
            const header = day !== lastDay;
            lastDay = day;
            return (
              <React.Fragment key={row.type === 'batch' ? `b-${row.items[0]!.id}` : `${row.item.kind}-${row.item.id}`}>
                {header && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground uppercase">{day}</div>}
                {row.type === 'batch' ? (
                  <BatchRow items={row.items} onOpen={(c) => setViewingChange(c)} />
                ) : (
                  <ItemRow item={row.item} names={names} onSend={setViewingSend} onChange={(c) => setViewingChange(c)} />
                )}
              </React.Fragment>
            );
          })}
          {activity.hasNextPage && (
            <div className="flex justify-center py-2">
              <Button variant="ghost" size="xs" disabled={activity.isFetchingNextPage} onClick={() => activity.fetchNextPage()}>
                Load older
              </Button>
            </div>
          )}
          {kinds.has('send') && (
            <div className="flex justify-center pb-2">
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={clearSends}>
                <Trash2Icon /> Clear sent requests
              </Button>
            </div>
          )}
        </div>
      )}
      <HistoryDetailDialog
        id={viewingSend}
        onClose={() => setViewingSend(null)}
        onOpenRequest={(id) => {
          setViewingSend(null);
          void openHistoryEntry(id);
        }}
      />
      <ChangeDialog value={viewingChange} onClose={() => setViewingChange(null)} />
    </div>
  );
}

function WhoBadge({ who }: { who: string }) {
  const b = WHO_BADGE[who];
  return b ? <span className={cn('shrink-0 rounded px-1 text-[9.5px] font-medium', b.tone)}>{b.label}</span> : null;
}

const CHANGE_ICON = { create: FilePlusIcon, update: PencilIcon, delete: Trash2Icon };

function ItemRow({
  item,
  names,
  onSend,
  onChange,
}: {
  item: ActivityItem;
  names: Map<string, string>;
  onSend: (id: string) => void;
  onChange: (c: { change: ChangeEntry; collection: string | null }) => void;
}) {
  const row = 'flex h-7 w-full items-center gap-2 px-3 text-left text-[12px] hover:bg-accent';
  if (item.kind === 'send')
    return (
      <Tooltip content={item.error ?? `${item.url} · ${timeAgo(item.at)}`} side="right">
        <button type="button" className={row} onClick={() => onSend(item.id)}>
          <span className={cn('w-11 shrink-0 text-right font-mono text-[10px] font-bold', `method-${item.method}`)}>{item.method}</span>
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
            {item.requestId && names.has(item.requestId) ? (
              <>
                <span className="shrink-0 truncate font-medium">{names.get(item.requestId)}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">{pathOf(item.url)}</span>
              </>
            ) : (
              <span className="truncate font-mono text-[11.5px]">{item.url.replace(/^https?:\/\//, '')}</span>
            )}
          </span>
          <WhoBadge who={item.who} />
          <span className={cn('shrink-0 font-mono text-[10px]', statusTone(item.status))}>{item.status ?? 'ERR'}</span>
          <span className="w-12 shrink-0 text-right text-[10px] text-muted-foreground">{item.timeMs !== null ? formatMs(item.timeMs) : ''}</span>
        </button>
      </Tooltip>
    );
  if (item.kind === 'change') {
    const Icon = isMove(item.change) ? ChevronRightIcon : CHANGE_ICON[item.change.action];
    return (
      <Tooltip content={`${item.collection ? `${item.collection} · ` : ''}${timeAgo(item.at)}`} side="right">
        <button type="button" className={row} onClick={() => onChange({ change: item.change, collection: item.collection })}>
          <span className="flex w-11 shrink-0 justify-end">
            <Icon className={cn('size-3.5', item.change.action === 'delete' ? 'text-destructive' : 'text-muted-foreground')} />
          </span>
          <span className="min-w-0 flex-1 truncate">{isMove(item.change) ? `Moved ${kindWord(item.change)} “${item.change.label}”` : summary(item.change)}</span>
          <WhoBadge who={item.who} />
        </button>
      </Tooltip>
    );
  }
  const failed = item.failed > 0 || item.status === 'failed';
  return (
    <button type="button" className={row} onClick={() => useTabs.getState().openFlow({ id: item.flowId, name: item.flow })}>
      <span className="flex w-11 shrink-0 justify-end">
        <PlayIcon className={cn('size-3.5', failed ? 'text-destructive' : 'text-success')} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        Ran flow <span className="font-medium">{item.flow}</span>
      </span>
      <WhoBadge who={item.who} />
      <span className={cn('shrink-0 font-mono text-[10px]', failed ? 'text-destructive' : 'text-success')}>
        {item.status === 'running' ? 'running' : `${item.passed}/${item.total}`}
      </span>
    </button>
  );
}

function kindWord(c: ChangeEntry): string {
  return c.entityType === 'request' ? 'request' : 'folder';
}

function BatchRow({ items, onOpen }: { items: Extract<ActivityItem, { kind: 'change' }>[]; onOpen: (c: { change: ChangeEntry; collection: string | null }) => void }) {
  const [open, setOpen] = React.useState(false);
  const first = items[0]!.change;
  const verb = isMove(first) ? 'Moved' : first.action === 'create' ? 'Created' : first.action === 'delete' ? 'Deleted' : 'Changed';
  const noun = first.entityType === 'request' ? 'requests' : first.entityType === 'collection' ? 'folders' : 'items';
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-7 w-full items-center gap-2 px-3 text-left text-[12px] hover:bg-accent" aria-expanded={open}>
        <span className="flex w-11 shrink-0 justify-end">
          <ChevronRightIcon className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <BotIcon className="mr-1 inline size-3.5 text-info" />
          {verb} {items.length} {noun}
        </span>
        <WhoBadge who="claude" />
      </button>
      {open &&
        items.map((i) => (
          <button key={i.id} type="button" onClick={() => onOpen({ change: i.change, collection: i.collection })} className="flex h-6 w-full items-center gap-2 pr-3 pl-16 text-left text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
            <span className="truncate">{i.change.label}</span>
          </button>
        ))}
    </div>
  );
}

function ChangeDialog({ value, onClose }: { value: { change: ChangeEntry; collection: string | null } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const tree = useTree();
  const [busy, setBusy] = React.useState(false);
  const c = value?.change;
  const where = (snap: unknown) => {
    const o = snap as { request?: { collectionId?: string }; collection?: { parentId?: string | null } } | null;
    const id = o?.request?.collectionId ?? o?.collection?.parentId;
    return id ? chainTo(tree.data, id).map((n) => n.name).join(' / ') : '(top level)';
  };
  const restore = async () => {
    if (!c) return;
    setBusy(true);
    try {
      const { message } = await api('POST /changes/:id/restore', { params: { id: c.id } });
      toast.success(message);
      await Promise.all([qc.invalidateQueries({ queryKey: ['history'] }), qc.invalidateQueries({ queryKey: ['changes'] }), qc.invalidateQueries({ queryKey: keys.tree }), qc.invalidateQueries({ queryKey: ['variables'] }), qc.invalidateQueries({ queryKey: ['environments'] })]);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!c} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[70vh] flex-col gap-3 sm:max-w-3xl">
        {c && (
          <>
            <DialogHeader>
              <DialogTitle>{isMove(c) ? `Moved “${c.label}”` : summary(c)}</DialogTitle>
              <DialogDescription>
                {value?.collection ? `${value.collection} · ` : ''}
                {new Date(c.updatedAt).toLocaleString()} · {c.source === 'mcp' ? 'Claude' : c.source === 'app' ? 'You' : c.source}
                {isMove(c) && ` · from ${where(c.before)} to ${where(c.after)}`}
              </DialogDescription>
            </DialogHeader>
            {isMove(c) && changeText(c, 'before') === changeText(c, 'after') ? (
              <p className="flex-1 text-sm text-muted-foreground">
                Only its place changed: from <b className="text-foreground">{where(c.before)}</b> to <b className="text-foreground">{where(c.after)}</b>.
              </p>
            ) : (
              <div className="min-h-0 flex-1 rounded-md border">
                <TextDiff key={c.id} original={changeText(c, 'before')} modified={changeText(c, 'after')} />
              </div>
            )}
            {c.restorable && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" disabled={busy} onClick={restore}>
                  <RotateCcwIcon /> {c.action === 'delete' ? 'Bring back' : c.entityType === 'active-environment' ? 'Switch back' : isMove(c) ? 'Move back' : 'Restore previous version'}
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
