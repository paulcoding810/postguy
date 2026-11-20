import { useQuery } from '@tanstack/react-query';
import { ExternalLinkIcon, GitCompareIcon, LoaderIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import type { HistoryEntry, HistorySummary } from '@postguy/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeEditor } from '@/components/CodeEditor';
import { keys, useHistory } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { cn, formatBytes, formatMs, statusTone, timeAgo, tryParseJson } from '@/lib/utils';
import { comparableBody, headersText } from './compare';
import { TextDiff } from '@/components/TextDiff';

function useHistoryEntry(id: string | null) {
  return useQuery({ queryKey: keys.historyEntry(id ?? ''), queryFn: () => api('GET /history/:id', { params: { id: id! } }), enabled: !!id, staleTime: Infinity });
}

function entryLabel(h: Pick<HistorySummary, 'method' | 'url' | 'status' | 'createdAt'>) {
  return `${h.method} ${h.status ?? 'ERR'} · ${h.url.replace(/^https?:\/\//, '')} · ${timeAgo(h.createdAt)}`;
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const rows = Object.entries(headers);
  if (!rows.length) return <p className="p-3 text-xs text-muted-foreground">No headers.</p>;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b align-top">
              <td className="w-1/3 px-3 py-1 font-mono font-medium break-all select-text">{k}</td>
              <td className="px-3 py-1 font-mono break-all text-muted-foreground select-text">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Body({ text, path }: { text: string | null; path: string }) {
  if (!text) return <p className="p-3 text-xs text-muted-foreground">No body.</p>;
  const parsed = tryParseJson(text);
  return <CodeEditor readOnly value={parsed.ok ? JSON.stringify(parsed.value, null, 2) : text} language={parsed.ok ? 'json' : 'plaintext'} path={path} wordWrap />;
}

function Summary({ e }: { e: HistoryEntry }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className={cn('font-mono font-bold', `method-${e.method}`)}>{e.method}</span>
      <span className="min-w-0 flex-1 truncate font-mono select-text">{e.url}</span>
      <span className={cn('font-semibold', statusTone(e.status))}>{e.status ? `${e.status} ${e.statusText ?? ''}` : 'Error'}</span>
      <span className="text-muted-foreground">{formatMs(e.timing.totalMs)}</span>
      <span className="text-muted-foreground">{formatBytes(e.bodySize)}</span>
      <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
    </div>
  );
}

function Compare({ a, b }: { a: HistoryEntry; b: HistoryEntry }) {
  const [what, setWhat] = React.useState<'body' | 'headers'>('body');
  const left = what === 'body' ? comparableBody(b.responseBody) : { text: headersText(b.responseHeaders), json: false };
  const right = what === 'body' ? comparableBody(a.responseBody) : { text: headersText(a.responseHeaders), json: false };
  const same = left.text === right.text;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <Tabs value={what} onValueChange={(v) => setWhat(v as 'body' | 'headers')}>
          <TabsList className="px-0">
            <TabsTrigger value="body">Body</TabsTrigger>
            <TabsTrigger value="headers">Headers</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-muted-foreground">
          Left: <span className={statusTone(b.status)}>{b.status ?? 'ERR'}</span> {timeAgo(b.createdAt)} · Right: <span className={statusTone(a.status)}>{a.status ?? 'ERR'}</span>{' '}
          {timeAgo(a.createdAt)}
        </span>
        {same && <Badge variant="outline">Identical</Badge>}
        {what === 'body' && (left.json || right.json) && <span className="ml-auto text-muted-foreground">JSON keys sorted</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
        <TextDiff original={left.text} modified={right.text} language={left.json && right.json ? 'json' : 'plaintext'} />
      </div>
    </div>
  );
}

/** Read-only view of one sent request and its response, with a diff against another entry. */
export function HistoryDetailDialog({ id, onClose, onOpenRequest }: { id: string | null; onClose: () => void; onOpenRequest: (id: string) => void }) {
  const entry = useHistoryEntry(id);
  const all = useHistory();
  const [tab, setTab] = React.useState('response');
  const [otherId, setOtherId] = React.useState<string | null>(null);
  const other = useHistoryEntry(tab === 'compare' ? otherId : null);
  const e = entry.data;

  const candidates = React.useMemo(() => {
    const list = (all.data ?? []).filter((h) => h.id !== id);
    if (!e) return list;
    const same = list.filter((h) => e.requestId ? h.requestId === e.requestId : h.method === e.method && h.url === e.url);
    return [...same, ...list.filter((h) => !same.includes(h))];
  }, [all.data, id, e]);

  React.useEffect(() => {
    setTab('response');
    setOtherId(null);
  }, [id]);

  React.useEffect(() => {
    if (otherId || !e || !candidates.length) return;
    const older = candidates.find((h) => (e.requestId ? h.requestId === e.requestId : h.url === e.url) && h.createdAt < e.createdAt);
    setOtherId((older ?? candidates[0])!.id);
  }, [candidates, e, otherId]);

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          <DialogDescription>A request as it was sent, and the response it got. Secret values were masked when it was recorded.</DialogDescription>
        </DialogHeader>
        {entry.isError && <EmptyState title="Entry not found">{errorMessage(entry.error)}</EmptyState>}
        {!e && !entry.isError && <EmptyState icon={<LoaderIcon className="size-5 animate-spin" />} title="Loading…" />}
        {e && (
          <>
            <Summary e={e} />
            {e.error && <div className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive select-text">{e.error}</div>}
            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2">
                <TabsList className="px-0">
                  <TabsTrigger value="response">Response</TabsTrigger>
                  <TabsTrigger value="response-headers">Response headers</TabsTrigger>
                  <TabsTrigger value="request">Request</TabsTrigger>
                  <TabsTrigger value="compare">
                    <GitCompareIcon className="size-3.5" /> Compare
                  </TabsTrigger>
                </TabsList>
                {tab === 'compare' && (
                  <Select value={otherId ?? undefined} onValueChange={setOtherId}>
                    <SelectTrigger className="ml-2 h-7 max-w-md min-w-0 flex-1 text-xs" aria-label="Compare with">
                      <SelectValue placeholder="Compare with…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {candidates.slice(0, 100).map((h) => (
                        <SelectItem key={h.id} value={h.id} className="text-xs">
                          {entryLabel(h)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button size="xs" variant="outline" className="ml-auto" onClick={() => onOpenRequest(e.id)}>
                  <ExternalLinkIcon /> Open request
                </Button>
              </div>
              <TabsContent value="response" className="min-h-0 flex-1 overflow-hidden rounded-md border data-[state=active]:flex data-[state=active]:flex-col">
                {e.truncated && <p className="border-b bg-warning/10 px-3 py-1 text-xs text-warning">The body was larger than the history limit and is cut off.</p>}
                <div className="min-h-0 flex-1">
                  <Body text={e.responseBody} path={`history/${e.id}/response`} />
                </div>
              </TabsContent>
              <TabsContent value="response-headers" className="min-h-0 flex-1 overflow-hidden rounded-md border">
                <HeadersTable headers={e.responseHeaders} />
              </TabsContent>
              <TabsContent value="request" className="min-h-0 flex-1 overflow-hidden rounded-md border data-[state=active]:flex data-[state=active]:flex-col">
                <div className="border-b px-3 py-1.5 font-mono text-xs break-all select-text">
                  {e.method} {e.url}
                </div>
                <div className="max-h-48 shrink-0 overflow-auto border-b">
                  <HeadersTable headers={e.request.headers} />
                </div>
                <div className="min-h-0 flex-1">
                  <Body text={e.request.body} path={`history/${e.id}/request`} />
                </div>
              </TabsContent>
              <TabsContent value="compare" className="min-h-0 flex-1 overflow-hidden">
                {!candidates.length ? (
                  <EmptyState icon={<XIcon className="size-5" />} title="Nothing to compare">Send the request again to compare responses.</EmptyState>
                ) : other.data ? (
                  <Compare a={e} b={other.data} />
                ) : (
                  <EmptyState icon={<LoaderIcon className="size-5 animate-spin" />} title="Loading…" />
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
