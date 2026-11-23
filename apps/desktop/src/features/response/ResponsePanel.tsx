import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangleIcon, BookmarkPlusIcon, CookieIcon, LoaderIcon, SendIcon, WifiOffIcon } from 'lucide-react';
import * as React from 'react';
import type { ExampleRequest, SendResult } from '@postguy/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Kbd, Tooltip } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCookieManager } from '@/features/cookies/CookieManager';
import { cn, formatBytes, formatMs, modKey, statusTone } from '@/lib/utils';
import { EmptyAuthBanner } from './EmptyAuthBanner';
import { ExamplesView, saveExample, useExamples, useOpenExample } from './Examples';
import { ResponseBody } from './ResponseBody';
import { SchemaTab } from './SchemaTab';
import { TestsTab, testCounts } from './TestsTab';

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
  requestName = null,
  onResend,
  hasCollection = false,
  onAddScript,
  exampleRequest,
  onUseRequest,
  graphql = false,
}: {
  /** The request was a GraphQL query: errors in the body are shown, as such responses are usually 200. */
  graphql?: boolean;
  /** The request as written, saved with an example. */
  exampleRequest?: () => ExampleRequest;
  /** Fills the editor from an example's request. */
  onUseRequest?: (request: ExampleRequest, name: string) => void;
  hasCollection?: boolean;
  /** Appends lines to the post-response script, from the tree view's save and test actions. */
  onAddScript?: (code: string, message: string) => void;
  response: SendResult | null;
  sending: boolean;
  requestId: string | null;
  /** The saved request's name, used for `{{Name.path}}` references in the tree view. */
  requestName?: string | null;
  onResend?: () => void;
}) {
  const qc = useQueryClient();
  const [section, setSection] = React.useState('body');
  const [example, setExample] = React.useState<string | null>(null);
  const examples = useExamples(requestId);
  const exampleCount = examples.data?.length ?? 0;
  const openRequest = useOpenExample();
  React.useEffect(() => {
    if (!openRequest.nonce || openRequest.requestId !== requestId) return;
    setSection('examples');
    setExample(openRequest.exampleId);
  }, [openRequest.nonce]);

  const examplesView = requestId ? <ExamplesView requestId={requestId} selected={example} onSelect={setExample} onUseRequest={onUseRequest} /> : null;

  if (!response) {
    if (sending) return <EmptyState icon={<LoaderIcon className="size-6 animate-spin" />} title="Sending request…" />;
    const idle = (
      <EmptyState icon={<SendIcon className="size-6" />} title="No response yet">
        Press Send or <Kbd>{modKey}↵</Kbd> to execute the request.
      </EmptyState>
    );
    if (!exampleCount) return idle;
    return (
      <Tabs value={section === 'examples' ? 'examples' : 'none'} onValueChange={setSection} className="flex h-full min-h-0 flex-col">
        <TabsList>
          <TabsTrigger value="none">Response</TabsTrigger>
          <TabsTrigger value="examples">
            Examples <span className="text-muted-foreground">{exampleCount}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="none">{idle}</TabsContent>
        <TabsContent value="examples" className="flex min-h-0 flex-col">
          {examplesView}
        </TabsContent>
      </Tabs>
    );
  }

  const canSave = !!requestId && !response.error && !response.truncated && !!exampleRequest;


  return (
    <Tabs value={section} onValueChange={setSection} className="flex h-full min-h-0 flex-col">
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
          {requestId && (
            <TabsTrigger value="examples">
              Examples {exampleCount > 0 && <span className="text-muted-foreground">{exampleCount}</span>}
            </TabsTrigger>
          )}
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

      {graphql && <GraphqlErrors response={response} />}

      {response.unresolved.length > 0 && (
        <div className="flex items-center gap-2 border-b bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <AlertTriangleIcon className="size-3.5" />
          Unresolved: {response.unresolved.map((u) => `{{${u}}}`).join(', ')}
        </div>
      )}

      {response.emptyAuth && <EmptyAuthBanner warning={response.emptyAuth} onResend={onResend} />}

      <TabsContent value="body" className="flex min-h-0 flex-col">
        {response.error ? (
          <EmptyState icon={<WifiOffIcon className="size-6 text-destructive" />} title={response.error.code}>
            <span className="select-text">{response.error.message}</span>
          </EmptyState>
        ) : (
          <ResponseBody
            body={response.body}
            bodyEncoding={response.bodyEncoding}
            contentType={response.contentType}
            size={response.size}
            requestName={requestName}
            hasCollection={hasCollection}
            onAddScript={onAddScript}
            actions={
              requestId && (
                <Tooltip content={canSave ? 'Save as example' : response.truncated ? 'The response was cut short, so it can’t be kept as an example' : 'Save the request first'}>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={!canSave}
                    onClick={async () => {
                      const id = await saveExample(qc, requestId, response, exampleRequest!());
                      if (id) setExample(id);
                    }}
                  >
                    <BookmarkPlusIcon /> Save as example
                  </Button>
                </Tooltip>
              )
            }
          />
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
      <TabsContent value="examples" className="flex min-h-0 flex-col">
        {examplesView}
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

/** GraphQL reports failures in an `errors` array, usually with status 200; this makes them visible. */
function GraphqlErrors({ response }: { response: SendResult }) {
  const errors = React.useMemo(() => {
    if (response.bodyEncoding !== 'utf8') return [];
    try {
      const body = JSON.parse(response.body) as { errors?: { message?: string; path?: unknown[] }[] };
      return Array.isArray(body.errors) ? body.errors : [];
    } catch {
      return [];
    }
  }, [response]);
  if (!errors.length) return null;
  return (
    <div className="flex items-start gap-2 border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive" role="alert">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <span className="font-medium">GraphQL {errors.length === 1 ? 'error' : `errors (${errors.length})`}</span>
        {errors.slice(0, 3).map((e, i) => (
          <div key={i} className="truncate select-text">
            {e.message ?? 'Unknown error'}
            {Array.isArray(e.path) && <span className="text-destructive/70"> at {e.path.join('.')}</span>}
          </div>
        ))}
        {errors.length > 3 && <div className="text-destructive/70">and {errors.length - 3} more in the body</div>}
      </div>
    </div>
  );
}
