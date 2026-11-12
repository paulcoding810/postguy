import { useQueries } from '@tanstack/react-query';
import { BookOpenIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/menu';
import { CodeEditor } from '@/components/CodeEditor';
import { api } from '@/lib/api';
import { scriptLib, setScriptLib, type ScriptTypeInput } from '@/lib/scriptTypes';
import type { monaco } from '@/lib/monaco';
import { useReferenceSources, useSnapshot } from '@/features/memory/queries';
import { useFlowSources, useSavedRequest } from '@/features/flows/queries';

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
}: {
  value: string;
  onChange: (v: string) => void;
  phase: 'pre' | 'post';
  types: ScriptTypeInput;
  path: string;
}) {
  const editor = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const lib = React.useMemo(() => scriptLib(types), [types]);
  const libRef = React.useRef(lib);
  libRef.current = lib;
  const focused = React.useRef(false);
  React.useEffect(() => {
    if (focused.current) setScriptLib(lib);
  }, [lib]);

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" className="ml-auto">
              <BookOpenIcon /> Snippets
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
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
