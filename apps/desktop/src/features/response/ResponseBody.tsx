import { CopyIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { CodeEditor } from '@/components/CodeEditor';
import { cn, formatBytes, tryParseJson } from '@/lib/utils';
import { ResponseTree } from './ResponseTree';

function languageFor(contentType: string | null): string {
  if (!contentType) return 'plaintext';
  if (/json/i.test(contentType)) return 'json';
  if (/html/i.test(contentType)) return 'html';
  if (/xml/i.test(contentType)) return 'xml';
  if (/javascript/i.test(contentType)) return 'javascript';
  if (/css/i.test(contentType)) return 'css';
  return 'plaintext';
}

type BodyView = 'pretty' | 'raw' | 'tree';
const VIEW_KEY = 'postguy.responseView';

/** The body view, remembered across responses and restarts. */
function useBodyView(): [BodyView, (v: BodyView) => void] {
  const [view, setView] = React.useState<BodyView>(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      return saved === 'raw' || saved === 'tree' ? saved : 'pretty';
    } catch {
      return 'pretty';
    }
  });
  const set = (v: BodyView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable */
    }
  };
  return [view, set];
}

/** A response body as pretty, raw or tree text, or an image, whichever fits its type. */
export function ResponseBody({
  body,
  bodyEncoding,
  contentType,
  size,
  requestName = null,
  hasCollection = false,
  onAddScript,
  actions,
}: {
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  contentType: string | null;
  size: number;
  requestName?: string | null;
  hasCollection?: boolean;
  onAddScript?: (code: string, message: string) => void;
  /** Extra buttons next to Copy. */
  actions?: React.ReactNode;
}) {
  const [view, setView] = useBodyView();
  const json = React.useMemo(() => (bodyEncoding === 'utf8' && /json/i.test(contentType ?? '') ? tryParseJson(body) : null), [body, bodyEncoding, contentType]);
  const pretty = React.useMemo(() => (json?.ok ? JSON.stringify(json.value, null, 2) : body), [json, body]);
  const shown: BodyView = view === 'tree' && !json?.ok ? 'pretty' : view;
  const isBinary = bodyEncoding === 'base64';

  if (isBinary && /^image\//.test(contentType ?? ''))
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        <img alt="Response" src={`data:${contentType};base64,${body}`} className="max-h-full max-w-full" />
      </div>
    );
  if (isBinary) return <EmptyState title="Binary response">{formatBytes(size)} of {contentType ?? 'unknown type'}</EmptyState>;
  return (
    <>
      <div className="flex items-center gap-1 border-b px-3 py-1">
        {(json?.ok ? (['pretty', 'raw', 'tree'] as const) : (['pretty', 'raw'] as const)).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn('rounded px-2 py-0.5 text-xs capitalize text-muted-foreground', shown === v && 'bg-secondary text-foreground')}
          >
            {v}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          {actions}
          <Button variant="ghost" size="icon-xs" aria-label="Copy body" onClick={() => navigator.clipboard.writeText(body).then(() => toast.success('Copied'))}>
            <CopyIcon className="size-3.5" />
          </Button>
        </span>
      </div>
      {shown === 'tree' && json?.ok ? (
        <ResponseTree value={json.value} requestName={requestName} hasCollection={hasCollection} onAddScript={onAddScript} />
      ) : (
        <div className="min-h-0 flex-1">
          <CodeEditor key={shown} readOnly wordWrap={shown === 'raw'} language={shown === 'raw' ? 'plaintext' : languageFor(contentType)} value={shown === 'raw' ? body : pretty} />
        </div>
      )}
    </>
  );
}
