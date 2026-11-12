import { FileDownIcon, HistoryIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/menu';
import { api, errorMessage } from '@/lib/api';
import { downloadText } from '@/features/collections/transfer';
import type { FlowExecution, FlowExecutionDetail } from '@postguy/shared';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn, formatMs, statusTone } from '@/lib/utils';
import { StatusIcon } from './nodes';

const TONE: Record<FlowExecution['status'], 'success' | 'destructive' | 'secondary' | 'default'> = {
  running: 'default',
  paused: 'default',
  success: 'success',
  failed: 'destructive',
  stopped: 'secondary',
};

export function ExecutionPanel({
  executions,
  executionId,
  onSelectExecution,
  detail,
  selectedStepId,
  onSelectStep,
}: {
  executions: FlowExecution[];
  executionId: string | null;
  onSelectExecution: (id: string) => void;
  detail: FlowExecutionDetail | undefined;
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="font-semibold tracking-wide text-muted-foreground uppercase">Execution log</span>
        {executions.length > 0 && (
          <Select value={executionId ?? undefined} onValueChange={onSelectExecution}>
            <SelectTrigger className="h-7 w-60 text-xs" aria-label="Execution">
              <SelectValue placeholder="Choose a run" />
            </SelectTrigger>
            <SelectContent>
              {executions.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {new Date(e.startedAt).toLocaleString()} · {e.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {detail && (
          <>
            <Badge variant={TONE[detail.status]} className="capitalize">{detail.status}</Badge>
            {detail.finishedAt && <span className="text-muted-foreground">{formatMs(detail.finishedAt - detail.startedAt)}</span>}
            {detail.error && <span className="truncate text-destructive">{detail.error}</span>}
            {detail.status !== 'running' && detail.status !== 'paused' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="xs" className="ml-auto">
                    <FileDownIcon /> Report
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(
                    [
                      ['md', 'Markdown', 'text/markdown'],
                      ['html', 'HTML', 'text/html'],
                      ['json', 'JSON', 'application/json'],
                    ] as const
                  ).map(([format, label, type]) => (
                    <DropdownMenuItem
                      key={format}
                      onSelect={async () => {
                        try {
                          const data = await api('GET /executions/:id/report', { params: { id: detail.id }, query: { format } });
                          const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
                          const stamp = new Date(detail.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
                          await downloadText(`flow-report-${stamp}.${format}`, text, type);
                        } catch (e) {
                          toast.error(errorMessage(e));
                        }
                      }}
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
      </div>
      {!detail ? (
        <EmptyState icon={<HistoryIcon className="size-5" />} title="No runs yet">
          Run the flow to see each step’s status, timing and logs here.
        </EmptyState>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-xs">
            <tbody>
              {detail.steps.map((s) => {
                const first = s.logs.find((l) => l.level !== 'info') ?? s.logs.find((l) => / → \d{3}\b/.test(l.message)) ?? s.logs.at(-1);
                return (
                  <tr
                    key={s.id}
                    onClick={() => onSelectStep(s.stepId)}
                    className={cn('cursor-pointer border-b hover:bg-accent/50', selectedStepId === s.stepId && 'bg-accent')}
                  >
                    <td className="w-6 py-1.5 pl-3">
                      <StatusIcon status={s.status} />
                    </td>
                    <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                      {s.stepName}
                      {s.attempt > 1 && <span className="ml-1 text-muted-foreground">#{s.attempt}</span>}
                    </td>
                    <td className={cn('px-2 py-1.5 font-mono', statusTone(s.response?.status ?? null))}>{s.response?.status ?? ''}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{s.response ? formatMs(s.response.timeMs) : ''}</td>
                    <td className={cn('w-full truncate px-2 py-1.5 font-mono text-[11px]', first?.level === 'error' ? 'text-destructive' : first?.level === 'warn' ? 'text-warning' : 'text-muted-foreground')}>
                      {s.error ?? first?.message ?? ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
