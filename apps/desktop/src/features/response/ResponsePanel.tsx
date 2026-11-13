import { AlertTriangleIcon, CookieIcon, CopyIcon, LoaderIcon, SendIcon, WifiOffIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import type { SendResult } from '@postguy/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Kbd } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeEditor } from '@/components/CodeEditor';
import { useCookieManager } from '@/features/cookies/CookieManager';
import { cn, formatBytes, formatMs, modKey, statusTone, tryParseJson } from '@/lib/utils';
import { SchemaTab } from './SchemaTab';
import { TestsTab, testCounts } from './TestsTab';

function languageFor(contentType: string | null): string {
  if (!contentType) return 'plaintext';
  if (/json/i.test(contentType)) return 'json';
  if (/html/i.test(contentType)) return 'html';
  if (/xml/i.test(contentType)) return 'xml';
  if (/javascript/i.test(contentType)) return 'javascript';
  if (/css/i.test(contentType)) return 'css';
  return 'plaintext';
}

function Table({ rows, empty }: { rows: [string, React.ReactNode][]; empty: string }) {
  if (!rows.length) return <p className="p-4 text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} className="border-b align-top">
              <td className="w-1/3 px-3 py-1.5 font-mono font-medium break-all text-muted-foreground">{k}</td>
              <td className="px-3 py-1.5 font-mono break-all select-text">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResponsePanel({
  response,
  sending,
  requestId,
}: {
  response: SendResult | null;
  sending: boolean;
  requestId: string | null;
}) {
  const [view, setView] = React.useState<'pretty' | 'raw'>('pretty');

  if (!response) {
    return sending ? (
      <EmptyState icon={<LoaderIcon className="size-6 animate-spin" />} title="Sending request…" />
    ) : (
      <EmptyState icon={<SendIcon className="size-6" />} title="No response yet">
        Press Send or <Kbd>{modKey}↵</Kbd> to execute the request.
      </EmptyState>
    );
  }

  const json = response.bodyEncoding === 'utf8' && /json/i.test(response.contentType ?? '') ? tryParseJson(response.body) : null;
  const pretty = json?.ok ? JSON.stringify(json.value, null, 2) : response.body;
  const isBinary = response.bodyEncoding === 'base64';
  const isImage = isBinary && /^image\//.test(response.contentType ?? '');

  return (
    <Tabs defaultValue="body" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b pr-3">
        <TabsList className="border-0">
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="headers">
            Headers <span className="text-muted-foreground">{Object.keys(response.headers).length}</span>
          </TabsTrigger>
          <TabsTrigger value="cookies">
            Cookies {response.cookies.length > 0 && <span className="text-muted-foreground">{response.cookies.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="tests">
            Tests{' '}
            {(() => {
              const c = testCounts(response.scripts);
              if (!response.scripts?.length) return null;
              const bad = c.passed < c.total || c.errors > 0;
              return <span className={bad ? 'text-destructive' : 'text-success'}>{c.total ? `${c.passed}/${c.total}` : c.errors ? '!' : '✓'}</span>;
            })()}
          </TabsTrigger>
          <TabsTrigger value="request">Request</TabsTrigger>
        </TabsList>
        <div className="ml-auto flex items-center gap-3 text-xs">
          {sending && <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />}
          {response.validation && (
            <Badge variant={response.validation.ok ? 'success' : 'warning'}>
              {response.validation.ok ? 'Schema valid' : `${response.validation.errors.length} schema issue(s)`}
            </Badge>
          )}
          <span className={cn('font-semibold', statusTone(response.status))}>
            {response.status ?? 'Error'} {response.statusText}
          </span>
          <span className="text-muted-foreground">{formatMs(response.timing.totalMs)}</span>
          <span className="text-muted-foreground">{formatBytes(response.size)}</span>
        </div>
      </div>

      {response.unresolved.length > 0 && (
        <div className="flex items-center gap-2 border-b bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <AlertTriangleIcon className="size-3.5" />
          Unresolved: {response.unresolved.map((u) => `{{${u}}}`).join(', ')}
        </div>
      )}

      <TabsContent value="body" className="flex min-h-0 flex-col">
        {response.error ? (
          <EmptyState icon={<WifiOffIcon className="size-6 text-destructive" />} title={response.error.code}>
            <span className="select-text">{response.error.message}</span>
          </EmptyState>
        ) : isImage ? (
          <div className="flex flex-1 items-center justify-center overflow-auto p-4">
            <img alt="Response" src={`data:${response.contentType};base64,${response.body}`} className="max-h-full max-w-full" />
          </div>
        ) : isBinary ? (
          <EmptyState title="Binary response">{formatBytes(response.size)} of {response.contentType ?? 'unknown type'}</EmptyState>
        ) : (
          <>
            <div className="flex items-center gap-1 border-b px-3 py-1">
              {(['pretty', 'raw'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn('rounded px-2 py-0.5 text-xs capitalize text-muted-foreground', view === v && 'bg-secondary text-foreground')}
                >
                  {v}
                </button>
              ))}
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-auto"
                aria-label="Copy body"
                onClick={() => navigator.clipboard.writeText(response.body).then(() => toast.success('Copied'))}
              >
                <CopyIcon className="size-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <CodeEditor
                key={view}
                readOnly
                wordWrap={view === 'raw'}
                language={view === 'raw' ? 'plaintext' : languageFor(response.contentType)}
                value={view === 'raw' ? response.body : pretty}
              />
            </div>
          </>
        )}
      </TabsContent>
      <TabsContent value="headers">
        <Table rows={Object.entries(response.headers)} empty="No headers" />
      </TabsContent>
      <TabsContent value="cookies">
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <span>Cookies set here are kept and sent on later requests to the same site.</span>
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => useCookieManager.getState().setOpen(true)}>
            <CookieIcon /> Manage cookies
          </Button>
        </div>
        {response.cookies.length ? (
          <div className="h-full overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[11px] text-muted-foreground uppercase">
                <tr className="border-b">
                  {['Name', 'Value', 'Domain', 'Path', 'Expires', 'HttpOnly', 'Secure'].map((h) => (
                    <th key={h} className="px-3 py-1.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {response.cookies.map((c, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-3 py-1.5">{c.name}</td>
                    <td className="max-w-64 truncate px-3 py-1.5 select-text">{c.value}</td>
                    <td className="px-3 py-1.5">{c.domain ?? '—'}</td>
                    <td className="px-3 py-1.5">{c.path ?? '—'}</td>
                    <td className="px-3 py-1.5">{c.expires ?? (c.maxAge !== undefined ? `${c.maxAge}s` : 'Session')}</td>
                    <td className="px-3 py-1.5">{c.httpOnly ? 'yes' : 'no'}</td>
                    <td className="px-3 py-1.5">{c.secure ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-4 text-xs text-muted-foreground">No cookies were set by this response.</p>
        )}
      </TabsContent>
      <TabsContent value="schema">
        <SchemaTab requestId={requestId} response={response} />
      </TabsContent>
      <TabsContent value="tests">
        <TestsTab runs={response.scripts} />
      </TabsContent>
      <TabsContent value="request">
        <Table
          rows={[
            ['Method', response.request.method],
            ['URL', response.request.url],
            ...Object.entries(response.request.headers).map(([k, v]) => [`header: ${k}`, v] as [string, string]),
          ]}
          empty=""
        />
      </TabsContent>
    </Tabs>
  );
}
