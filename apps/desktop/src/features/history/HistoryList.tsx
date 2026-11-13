import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { HistoryIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { newId, type HttpMethod } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, Tooltip } from '@/components/ui/misc';
import { confirm } from '@/components/dialogs';
import { useHistory } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { cn, formatMs, statusTone, timeAgo } from '@/lib/utils';
import { blankRequest, useTabs } from '@/stores/tabs';
import { HistoryDetailDialog } from './HistoryDetail';

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function HistoryList({ filter }: { filter: string }) {
  const history = useHistory();
  const qc = useQueryClient();
  const q = filter.trim().toLowerCase();
  const [viewing, setViewing] = React.useState<string | null>(null);
  const items = (history.data ?? []).filter((h) => !q || h.url.toLowerCase().includes(q) || h.method.toLowerCase().includes(q));

  const restore = async (id: string) => {
    setViewing(null);
    try {
      const entry = await api('GET /history/:id', { params: { id } });
      if (entry.requestId) {
        try {
          const saved = await api('GET /requests/:id', { params: { id: entry.requestId } });
          useTabs.getState().openRequest(saved, { pin: true });
          return;
        } catch {
          /* request was deleted; fall back to a draft */
        }
      }
      const url = new URL(entry.url);
      const def = blankRequest(`${entry.method} ${url.pathname}`);
      def.method = entry.method as HttpMethod;
      def.url = `${url.origin}${url.pathname}`;
      def.params = [...url.searchParams.entries()].map(([key, value]) => ({ id: newId(8), key, value, enabled: true }));
      def.headers = Object.entries(entry.request.headers)
        .filter(([k]) => !/^content-type$/i.test(k) || !entry.request.body)
        .map(([key, value]) => ({ id: newId(8), key, value, enabled: true }));
      if (entry.request.body) def.body = { mode: /json/i.test(entry.request.headers['Content-Type'] ?? '') ? 'json' : 'text', raw: entry.request.body };
      useTabs.getState().newRequest(null, def);
      toast.message('Restored as a new draft. Secret values were masked in history.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const clear = async () => {
    if (!(await confirm({ title: 'Clear all history?', destructive: true, confirmLabel: 'Clear' }))) return;
    await api('DELETE /history');
    qc.invalidateQueries({ queryKey: ['history'] });
  };

  if (!items.length)
    return history.data?.length ? (
      <EmptyState icon={<HistoryIcon className="size-6" />} title="No matches">
        No sent request matches "{filter.trim()}".
      </EmptyState>
    ) : (
      <EmptyState icon={<HistoryIcon className="size-6" />} title="No history yet">
        Sent requests appear here.
      </EmptyState>
    );

  let lastDay = '';
  return (
    <div className="py-1">
      <div className="flex justify-end px-2">
        <Button variant="ghost" size="xs" onClick={clear}>
          <Trash2Icon /> Clear
        </Button>
      </div>
      {items.map((h) => {
        const day = dayLabel(h.createdAt);
        const header = day !== lastDay;
        lastDay = day;
        return (
          <div key={h.id}>
            {header && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground uppercase">{day}</div>}
            <Tooltip content={h.error ?? `${h.url} · ${timeAgo(h.createdAt)}`} side="right">
              <button
                type="button"
                onClick={() => setViewing(h.id)}
                className="flex h-7 w-full items-center gap-2 px-3 text-left text-[12px] hover:bg-accent"
              >
                <span className={cn('w-11 shrink-0 text-right font-mono text-[10px] font-bold', `method-${h.method}`)}>{h.method}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{h.url.replace(/^https?:\/\//, '')}</span>
                <span className={cn('shrink-0 font-mono text-[10px]', statusTone(h.status))}>{h.status ?? 'ERR'}</span>
                <span className="w-12 shrink-0 text-right text-[10px] text-muted-foreground">{formatMs(h.timing.totalMs)}</span>
              </button>
            </Tooltip>
          </div>
        );
      })}
      <HistoryDetailDialog id={viewing} onClose={() => setViewing(null)} onOpenRequest={restore} />
    </div>
  );
}
