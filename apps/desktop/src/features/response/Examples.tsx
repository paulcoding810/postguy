import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkIcon, CornerUpLeftIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import type { ExampleRequest, ExampleSummary, SendResult } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, Tooltip } from '@/components/ui/misc';
import { confirm, prompt } from '@/components/dialogs';
import { api, errorMessage } from '@/lib/api';
import { cn, formatBytes, statusTone } from '@/lib/utils';
import { ResponseBody } from './ResponseBody';

export const exampleKeys = {
  list: (requestId: string) => ['examples', requestId] as const,
  one: (id: string) => ['example', id] as const,
};

export function useExamples(requestId: string | null) {
  return useQuery({
    queryKey: exampleKeys.list(requestId ?? ''),
    queryFn: () => api('GET /requests/:id/examples', { params: { id: requestId! } }),
    enabled: !!requestId,
  });
}

/** Asks the response panel to show one example, e.g. from the Docs tab. */
export const useOpenExample = create<{ requestId: string | null; exampleId: string | null; nonce: number; open: (requestId: string, exampleId: string) => void }>((set) => ({
  requestId: null,
  exampleId: null,
  nonce: 0,
  open: (requestId, exampleId) => set((s) => ({ requestId, exampleId, nonce: s.nonce + 1 })),
}));

/** Names the response and keeps it with the request; secret values are swapped for their variables on the server. */
export async function saveExample(qc: ReturnType<typeof useQueryClient>, requestId: string, response: SendResult, request: ExampleRequest): Promise<string | null> {
  const name = await prompt({
    title: 'Save as example',
    description: 'Keeps this response with the request, with its headers and the request that produced it. Secret values are replaced by their variables.',
    initial: [response.status, response.statusText].filter(Boolean).join(' ') || 'Example',
    confirmLabel: 'Save example',
  });
  if (!name?.trim()) return null;
  try {
    const saved = await api('POST /requests/:id/examples', {
      params: { id: requestId },
      body: {
        name: name.trim(),
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        contentType: response.contentType,
        body: response.body,
        bodyEncoding: response.bodyEncoding,
        request,
      },
    });
    await qc.invalidateQueries({ queryKey: exampleKeys.list(requestId) });
    toast.success(`Saved example “${saved.name}”`);
    return saved.id;
  } catch (e) {
    toast.error(errorMessage(e));
    return null;
  }
}

const VIEWS = ['body', 'headers', 'request'] as const;

/** A request's saved examples: a list, and the chosen one shown like a response. */
export function ExamplesView({
  requestId,
  selected,
  onSelect,
  onUseRequest,
}: {
  requestId: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onUseRequest?: (request: ExampleRequest, name: string) => void;
}) {
  const qc = useQueryClient();
  const list = useExamples(requestId);
  const items = list.data ?? [];
  const current = items.find((e) => e.id === selected) ?? items[0] ?? null;
  const detail = useQuery({
    queryKey: exampleKeys.one(current?.id ?? ''),
    queryFn: () => api('GET /examples/:id', { params: { id: current!.id } }),
    enabled: !!current,
  });
  const [view, setView] = React.useState<(typeof VIEWS)[number]>('body');

  const rename = async (e: ExampleSummary) => {
    const name = await prompt({ title: 'Rename example', initial: e.name, confirmLabel: 'Rename' });
    if (!name?.trim() || name.trim() === e.name) return;
    try {
      await api('PATCH /examples/:id', { params: { id: e.id }, body: { name: name.trim() } });
      await Promise.all([qc.invalidateQueries({ queryKey: exampleKeys.list(requestId) }), qc.invalidateQueries({ queryKey: exampleKeys.one(e.id) })]);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const remove = async (e: ExampleSummary) => {
    if (!(await confirm({ title: `Delete example “${e.name}”?`, description: 'The saved response is removed for good.', destructive: true, confirmLabel: 'Delete' }))) return;
    try {
      await api('DELETE /examples/:id', { params: { id: e.id } });
      onSelect(null);
      qc.setQueryData<ExampleSummary[]>(exampleKeys.list(requestId), (old) => old?.filter((x) => x.id !== e.id));
      qc.removeQueries({ queryKey: exampleKeys.one(e.id) });
      await qc.invalidateQueries({ queryKey: exampleKeys.list(requestId) });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (list.isLoading) return null;
  if (!items.length)
    return (
      <EmptyState icon={<BookmarkIcon className="size-6" />} title="No examples yet">
        Send the request, then use “Save as example” to keep a response, such as a success and an error, with the request.
      </EmptyState>
    );

  const ex = detail.data;
  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-56 shrink-0 overflow-auto border-r py-1">
        {items.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelect(e.id)}
            onDoubleClick={() => rename(e)}
            className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent', current?.id === e.id && 'bg-accent')}
          >
            <span className={cn('w-8 shrink-0 font-mono font-semibold', statusTone(e.status))}>{e.status ?? '—'}</span>
            <span className="truncate">{e.name}</span>
          </button>
        ))}
      </div>
      {current && (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b px-3 py-1 text-xs">
            {VIEWS.map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={cn('rounded px-2 py-0.5 capitalize text-muted-foreground', view === v && 'bg-secondary text-foreground')}>
                {v}
              </button>
            ))}
            <span className="ml-2 truncate font-medium">{current.name}</span>
            <span className={cn('shrink-0 font-semibold', statusTone(current.status))}>
              {current.status} {current.statusText}
            </span>
            <span className="shrink-0 text-muted-foreground">{formatBytes(current.size)}</span>
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              {onUseRequest && ex && (
                <Tooltip content="Fill the editor with the request this example came from">
                  <Button variant="ghost" size="xs" onClick={() => onUseRequest(ex.request, ex.name)}>
                    <CornerUpLeftIcon /> Use its request
                  </Button>
                </Tooltip>
              )}
              <Button variant="ghost" size="icon-xs" aria-label="Rename example" onClick={() => rename(current)}>
                <PencilIcon />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="Delete example" onClick={() => remove(current)}>
                <Trash2Icon />
              </Button>
            </span>
          </div>
          {ex && view === 'body' && <ResponseBody body={ex.body} bodyEncoding={ex.bodyEncoding} contentType={ex.contentType} size={current.size} />}
          {ex && view === 'headers' && <Rows rows={Object.entries(ex.headers)} empty="No headers" />}
          {ex && view === 'request' && (
            <Rows
              rows={[
                ['Method', ex.request.method],
                ['URL', ex.request.url],
                ...ex.request.params.filter((p) => p.enabled !== false).map((p) => [`param: ${p.key}`, p.value] as [string, string]),
                ...ex.request.headers.filter((p) => p.enabled !== false).map((p) => [`header: ${p.key}`, p.value] as [string, string]),
                ...(ex.request.body.mode !== 'none' ? [[`body (${ex.request.body.mode})`, ex.request.body.raw ?? (ex.request.body.form ?? []).map((f) => `${f.key}=${f.value}`).join('&')] as [string, string]] : []),
              ]}
              empty=""
            />
          )}
        </div>
      )}
    </div>
  );
}

function Rows({ rows, empty }: { rows: [string, string][]; empty: string }) {
  if (!rows.length) return <p className="p-4 text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} className="border-b align-top">
              <td className="w-1/3 px-3 py-1.5 font-mono font-medium break-all text-muted-foreground">{k}</td>
              <td className="px-3 py-1.5 font-mono break-all whitespace-pre-wrap select-text">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The request's examples in its Docs tab; each opens in the response panel. */
export function DocsExamples({ requestId }: { requestId: string }) {
  const list = useExamples(requestId);
  const open = useOpenExample((s) => s.open);
  if (!list.data?.length) return null;
  return (
    <section>
      <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Examples</h4>
      <div className="flex flex-col">
        {list.data.map((e) => (
          <button key={e.id} type="button" onClick={() => open(requestId, e.id)} className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent">
            <span className={cn('w-8 shrink-0 font-mono font-semibold', statusTone(e.status))}>{e.status ?? '—'}</span>
            <span className="truncate">{e.name}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">
              {e.contentType ?? ''} · {formatBytes(e.size)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
