import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlusIcon, PencilIcon, RotateCcwIcon, Trash2Icon, XIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import type { ChangeEntry } from '@postguy/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { TextDiff } from '@/components/TextDiff';
import { keys } from '@/hooks/queries';
import { refreshCleanTabs } from '@/hooks/useLiveChanges';
import { api, errorMessage } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { changeText } from './changeText';

export const changeKeys = {
  collection: (id: string, entityId?: string | null) => ['changes', id, entityId ?? null] as const,
  deleted: ['changes', 'deleted'] as const,
};

const SOURCE: Record<ChangeEntry['source'], { label: string; tone: string }> = {
  app: { label: 'You', tone: 'bg-muted text-muted-foreground' },
  api: { label: 'API', tone: 'bg-muted text-muted-foreground' },
  mcp: { label: 'Claude', tone: 'bg-info/15 text-info' },
  sync: { label: 'OpenAPI sync', tone: 'bg-warning/15 text-warning' },
  import: { label: 'Import', tone: 'bg-muted text-muted-foreground' },
};

const KIND: Record<ChangeEntry['entityType'], string> = { request: 'request', collection: 'folder', variables: 'variables of' };

function summary(c: ChangeEntry): string {
  if (c.entityType === 'variables') return `Changed variables of “${c.label}”`;
  const kind = c.entityType === 'collection' && c.entityId === c.rootId ? 'collection' : KIND[c.entityType];
  if (c.action === 'create') return c.source === 'import' ? `Imported “${c.label}”` : `Created ${kind} “${c.label}”`;
  if (c.action === 'delete') return `Deleted ${kind} “${c.label}”`;
  return `Changed ${kind} “${c.label}”`;
}

const ICON = { create: FilePlusIcon, update: PencilIcon, delete: Trash2Icon };

function restoreLabel(c: ChangeEntry): string {
  return c.action === 'delete' ? 'Bring back' : 'Restore previous version';
}

/** A collection's changes, newest first, with a diff of each and a way to undo it. */
export function ChangeHistory({ collectionId, entityId, onClearFilter }: { collectionId: string; entityId?: string | null; onClearFilter?: () => void }) {
  const qc = useQueryClient();
  const changes = useQuery({
    queryKey: changeKeys.collection(collectionId, entityId),
    queryFn: () => api('GET /collections/:id/changes', { params: { id: collectionId }, query: entityId ? { entityId } : {} }),
  });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const list = changes.data ?? [];
  const current = list.find((c) => c.id === selected) ?? list[0] ?? null;

  const restore = async (c: ChangeEntry) => {
    setBusy(true);
    try {
      const { message } = await api('POST /changes/:id/restore', { params: { id: c.id } });
      toast.success(message);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['changes'] }),
        qc.invalidateQueries({ queryKey: keys.tree }),
        qc.invalidateQueries({ queryKey: ['variables'] }),
        qc.invalidateQueries({ queryKey: ['examples'] }),
        refreshCleanTabs(),
      ]);
      setSelected(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (changes.isLoading) return null;
  if (!list.length)
    return (
      <EmptyState title="No changes yet">
        Edits, deletions and imports in this collection appear here, with who made them, so you can undo them.
      </EmptyState>
    );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-72 shrink-0 flex-col border-r">
        {entityId && (
          <div className="flex items-center gap-1 border-b px-3 py-1.5 text-xs text-muted-foreground">
            Only “{list[0]?.label}”
            <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Show all changes" onClick={onClearFilter}>
              <XIcon />
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {list.map((c) => {
            const Icon = ICON[c.action];
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c.id)}
                className={cn('flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent', current?.id === c.id && 'bg-accent')}
              >
                <Icon className={cn('mt-0.5 size-3.5 shrink-0', c.action === 'delete' ? 'text-destructive' : 'text-muted-foreground')} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate">{summary(c)}</span>
                  <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    <span className={cn('rounded px-1', SOURCE[c.source].tone)}>{SOURCE[c.source].label}</span>
                    {timeAgo(c.updatedAt)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {current && (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
            <span className="truncate font-medium">{summary(current)}</span>
            <Badge variant="outline">{new Date(current.updatedAt).toLocaleString()}</Badge>
            {current.restorable && (
              <Button size="xs" variant="outline" className="ml-auto" disabled={busy} onClick={() => restore(current)}>
                <RotateCcwIcon /> {restoreLabel(current)}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3 px-3 py-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-destructive/60" /> Before
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-success/60" /> After
            </span>
          </div>
          <div className="min-h-0 flex-1 border-t">
            <TextDiff key={current.id} original={changeText(current, 'before')} modified={changeText(current, 'after')} />
          </div>
        </div>
      )}
    </div>
  );
}
