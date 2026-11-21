import { useQueries } from '@tanstack/react-query';
import { BookOpenIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menu';
import { CodeEditor } from '@/components/CodeEditor';
import { api } from '@/lib/api';
import { scriptLib, setScriptLib, type ScriptTypeInput } from '@/lib/scriptTypes';
import type { monaco } from '@/lib/monaco';
import { useReferenceSources, useSnapshot } from '@/features/memory/queries';
import { useFlowSources, useSavedRequest } from '@/features/flows/queries';
import { useSaveScope } from '@/features/response/SaveVariableDialog';
import { responseSnippets, type Suggestion } from '@/features/response/scriptSuggestions';

export interface LastResponse {
  status?: number;
  contentType: string | null;
  body: unknown;
}

const HIGHLIGHT_MS = 2500;

const SNIPPETS: Record<'pre' | 'post', { label: string; code: string }[]> = {
  pre: [
    { label: 'Set a header', code: `request.headers['X-Request-Id'] = String(Date.now());\n` },
    { label: 'Use a value from another response', code: `const login = flow.response('Login');\nrequest.headers['Authorization'] = 'Bearer ' + login.body.data.access_token;\n` },
    { label: 'Set a variable for this request', code: `flow.set('timestamp', new Date().toISOString());\n` },
  ],
  post: [
    { label: 'Assert status is 200', code: `flow.assert(response.status === 200, 'status is 200');\n` },
    { label: 'Save a value for later steps', code: `flow.set('token', response.body.data.access_token);\n` },
    { label: 'Save to the environment', code: `env.set('token', response.body.data.access_token);\n` },
    { label: 'Check a field exists', code: `flow.assert(response.body.data.id != null, 'has id');\n` },
  ],
};

export function ScriptEditor({
  value,
  onChange,
  phase,
  types,
  path,
  lastResponse,
  highlight,
}: {
  value: string;
  onChange: (v: string) => void;
  phase: 'pre' | 'post';
  types: ScriptTypeInput;
  path: string;
  /** The response snippets are written for; read when the menu opens. */
  lastResponse?: () => LastResponse | null;
  /** Lines just added elsewhere, revealed and highlighted; `key` changes for each addition. */
  highlight?: { text: string; key: number } | null;
}) {
  const editor = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const lib = React.useMemo(() => scriptLib(types), [types]);
  const libRef = React.useRef(lib);
  libRef.current = lib;
  const focused = React.useRef(false);
  React.useEffect(() => {
    if (focused.current) setScriptLib(lib);
  }, [lib]);

  const [fromResponse, setFromResponse] = React.useState<Suggestion[]>([]);
  const scope = useSaveScope((s) => s.scope);
  const onMenu = (open: boolean) => {
    if (!open || phase !== 'post') return;
    const r = lastResponse?.() ?? (types.self ? { contentType: null, body: types.self.body } : null);
    setFromResponse(r ? responseSnippets(r, scope) : []);
  };

  const pendingHighlight = React.useRef(highlight);
  pendingHighlight.current = highlight;
  const shown = React.useRef<number | null>(null);
  const showHighlight = React.useCallback(() => {
    const ed = editor.current;
    const h = pendingHighlight.current;
    if (!ed || !h || shown.current === h.key) return;
    const model = ed.getModel();
    const at = model?.getValue().lastIndexOf(h.text.trimEnd()) ?? -1;
    if (!model || at < 0) return;
    shown.current = h.key;
    const start = model.getPositionAt(at).lineNumber;
    const end = model.getPositionAt(at + h.text.trimEnd().length).lineNumber;
    ed.revealLinesInCenterIfOutsideViewport(start, end);
    const decorations = ed.createDecorationsCollection([{ range: { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 1 }, options: { isWholeLine: true, className: 'script-added-line' } }]);
    setTimeout(() => decorations.clear(), HIGHLIGHT_MS);
  }, []);
  React.useEffect(() => {
    const t = setTimeout(showHighlight, 0);
    return () => clearTimeout(t);
  }, [highlight?.key, showHighlight]);

  const insert = (code: string) => {
    const ed = editor.current;
    if (!ed) return onChange(value ? `${value.replace(/\n?$/, '\n')}${code}` : code);
    const pos = ed.getPosition() ?? ed.getModel()!.getFullModelRange().getEndPosition();
    const atLineStart = pos.column === 1;
    ed.executeEdits('snippet', [
      { range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }, text: (atLineStart ? '' : '\n') + code, forceMoveMarkers: true },
    ]);
    ed.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1 text-[11px] text-muted-foreground">
        {phase === 'pre' ? 'Runs before variables are resolved; edit `request` to change what is sent.' : 'Runs after the response; `response` holds it. Failed assertions fail the request.'}
        <DropdownMenu onOpenChange={onMenu}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" className="ml-auto">
              <BookOpenIcon /> Snippets
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-96">
            {phase === 'post' && fromResponse.length > 0 && (
              <>
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">From the last response</DropdownMenuLabel>
                {fromResponse.map((s) => (
                  <DropdownMenuItem key={s.label} onSelect={() => insert(s.code)}>
                    <span className="truncate">{s.label}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">Examples</DropdownMenuLabel>
              </>
            )}
            {SNIPPETS[phase].map((s) => (
              <DropdownMenuItem key={s.label} onSelect={() => insert(s.code)}>
                {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          path={path}
          language="javascript"
          value={value}
          onChange={onChange}
          fieldLabel={phase === 'pre' ? 'Pre-request script' : 'Post-response script'}
          onMount={(ed) => {
            editor.current = ed;
            setTimeout(showHighlight, 0);
            ed.onDidFocusEditorText(() => {
              focused.current = true;
              setScriptLib(libRef.current);
            });
            ed.onDidBlurEditorText(() => {
              focused.current = false;
            });
          }}
        />
      </div>
    </div>
  );
}

/** Response types for a saved request's scripts: remembered responses by request name. */
export function useRequestScriptTypes(collectionId: string | null, requestId: string | null, phase: 'pre' | 'post', name: string): ScriptTypeInput {
  const sources = useReferenceSources(collectionId);
  const top = (sources.data ?? []).filter((s) => s.snapshot && !s.shadowed).slice(0, 12);
  const snaps = useQueries({
    queries: top.map((s) => ({
      queryKey: ['snapshot', s.snapshot!.id],
      queryFn: () => api('GET /snapshots/:id', { params: { id: s.snapshot!.id } }),
      staleTime: Infinity,
    })),
  });
  const bodies = snaps.map((q) => q.data?.body);
  const selfIdx = top.findIndex((s) => s.requestId === requestId);
  return React.useMemo(
    () => ({
      phase,
      responses: top.map((s, i) => ({ name: s.name, body: bodies[i] })).filter((r) => r.body !== undefined),
      self: selfIdx >= 0 && bodies[selfIdx] !== undefined ? { name, body: bodies[selfIdx] } : null,
    }),
    [phase, name, JSON.stringify(top.map((s) => s.snapshot?.id)), bodies.map((b) => (b === undefined ? 0 : 1)).join('')],
  );
}

/** Response types for a flow step's scripts: upstream steps' sample responses by step name. */
export function useStepScriptTypes(flowId: string, stepId: string, requestId: string | null, phase: 'pre' | 'post', name: string): ScriptTypeInput {
  const sources = useFlowSources(flowId, stepId);
  const req = useSavedRequest(requestId);
  const self = useSnapshot(req.data?.pinnedSnapshotId ?? req.data?.latestSuccessSnapshotId ?? null);
  return React.useMemo(
    () => ({
      phase,
      responses: (sources.data ?? []).filter((s) => s.origin !== 'none').map((s) => ({ name: s.name, body: s.body })),
      self: self.data ? { name, body: self.data.body } : null,
    }),
    [phase, name, sources.data, self.data],
  );
}
