import { CheckIcon, XIcon } from 'lucide-react';
import type { ScriptRun } from '@postguy/shared';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export function testCounts(runs: ScriptRun[] | null | undefined) {
  const all = (runs ?? []).flatMap((r) => r.assertions);
  return { passed: all.filter((a) => a.ok).length, total: all.length, errors: (runs ?? []).filter((r) => r.error).length };
}

export function TestsTab({ runs }: { runs: ScriptRun[] | null | undefined }) {
  if (!runs?.length)
    return <EmptyState title="No scripts ran">Add a pre-request or post-response script to log values and check responses with flow.assert().</EmptyState>;
  return (
    <div className="h-full overflow-auto p-3 text-xs">
      {runs.map((r, i) => (
        <section key={i} className="mb-3 rounded-md border">
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <span className="font-medium">{r.phase === 'pre' ? 'Pre-request' : 'Post-response'} script</span>
            {r.source && <Badge variant="outline">{r.source}</Badge>}
            <Badge variant={r.ok ? 'success' : 'destructive'}>{r.ok ? 'passed' : 'failed'}</Badge>
            <span className="ml-auto text-muted-foreground">{r.durationMs} ms</span>
          </div>
          {r.error && <div className="border-b bg-destructive/10 px-3 py-1.5 font-mono text-destructive select-text">{r.error}</div>}
          {r.assertions.length > 0 && (
            <ul className="border-b px-3 py-1.5">
              {r.assertions.map((a, j) => (
                <li key={j} className="flex items-center gap-1.5 py-0.5">
                  {a.ok ? <CheckIcon className="size-3.5 text-success" /> : <XIcon className="size-3.5 text-destructive" />}
                  <span className={cn(!a.ok && 'text-destructive')}>{a.message}</span>
                </li>
              ))}
            </ul>
          )}
          {r.logs.length > 0 && (
            <div className="px-3 py-1.5 font-mono text-[11px]">
              {r.logs.map((l, j) => (
                <div key={j} className={cn('break-all whitespace-pre-wrap select-text', l.level === 'error' ? 'text-destructive' : l.level === 'warn' ? 'text-warning' : 'text-muted-foreground')}>
                  {l.message}
                </div>
              ))}
            </div>
          )}
          {!r.error && !r.assertions.length && !r.logs.length && <p className="px-3 py-1.5 text-muted-foreground">No output.</p>}
        </section>
      ))}
    </div>
  );
}
