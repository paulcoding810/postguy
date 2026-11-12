import { useQueryClient } from '@tanstack/react-query';
import { ArrowRightIcon, FileUpIcon, LoaderIcon, RefreshCwIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import type { OpenApiSpecDetail, SpecDiffSummary, SyncAction, SyncInput, SyncPlan } from '@postguy/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { pickFile } from '@/features/collections/transfer';

const ACTION: Record<SyncAction, { label: string; variant: 'success' | 'default' | 'warning' | 'destructive' | 'outline' }> = {
  create: { label: 'new request', variant: 'success' },
  update: { label: 'will update', variant: 'default' },
  'keep-edited': { label: 'edited, kept as is', variant: 'warning' },
  orphaned: { label: 'removed from spec, kept', variant: 'destructive' },
  unchanged: { label: 'unchanged', variant: 'outline' },
};

export function DiffView({ diff }: { diff: SpecDiffSummary }) {
  const row = (m: string, p: string, s?: string) => (
    <>
      <span className={cn('w-14 shrink-0 font-mono text-[10px] font-bold', `method-${m}`)}>{m}</span>
      <span className="font-mono">{p}</span>
      {s && <span className="truncate text-muted-foreground">{s}</span>}
    </>
  );
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="success">+{diff.added.length} added</Badge>
        <Badge variant="destructive">−{diff.removed.length} removed</Badge>
        <Badge variant="warning">~{diff.changed.length} changed</Badge>
        <Badge variant="outline">{diff.unchanged} unchanged</Badge>
        {diff.info && <Badge variant="secondary">version {diff.info.before} → {diff.info.after}</Badge>}
      </div>
      {diff.servers && <p className="text-muted-foreground">Servers: {diff.servers.before.join(', ') || 'none'} → {diff.servers.after.join(', ') || 'none'}</p>}
      <div className="rounded-md border">
        {diff.added.map((o) => (
          <div key={`a${o.id}`} className="flex items-center gap-2 border-b px-2 py-1 last:border-b-0">
            <span className="w-3 text-success">+</span>
            {row(o.method, o.path, o.summary)}
          </div>
        ))}
        {diff.removed.map((o) => (
          <div key={`r${o.id}`} className="flex items-center gap-2 border-b px-2 py-1 last:border-b-0">
            <span className="w-3 text-destructive">−</span>
            {row(o.method, o.path, o.summary)}
          </div>
        ))}
        {diff.changed.map((o) => (
          <div key={`c${o.id}`} className="border-b px-2 py-1 last:border-b-0">
            <div className="flex items-center gap-2">
              <span className="w-3 text-warning">~</span>
              {row(o.method, o.path, o.summary)}
            </div>
            <ul className="ml-[76px] list-disc pl-4 text-muted-foreground">
              {o.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ))}
        {!diff.added.length && !diff.removed.length && !diff.changed.length && <p className="px-2 py-2 text-muted-foreground">No operation changes.</p>}
      </div>
    </div>
  );
}

export function SyncPanel({ spec }: { spec: OpenApiSpecDetail }) {
  const qc = useQueryClient();
  const [plan, setPlan] = React.useState<SyncPlan | null>(null);
  const [input, setInput] = React.useState<SyncInput | null>(null);
  const [paste, setPaste] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const preview = async (body: SyncInput) => {
    setBusy(true);
    try {
      const p = await api('POST /openapi/:id/sync/preview', { params: { id: spec.id }, body });
      setPlan(p);
      setInput(body);
      if (p.upToDate) toast.message('Already up to date');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!input) return;
    setBusy(true);
    try {
      const r = await api('POST /openapi/:id/sync', { params: { id: spec.id }, body: input });
      const created = r.requests.filter((x) => x.action === 'create').length;
      const updated = r.requests.filter((x) => x.action === 'update').length;
      toast.success(`Synced to ${r.toVersion}: ${created} new, ${updated} updated`);
      setPlan(null);
      await Promise.all(['openapi', 'tree', 'operation', 'request'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        {spec.sourceUrl && (
          <Button size="sm" variant="outline" onClick={() => preview({})} disabled={busy}>
            <RefreshCwIcon /> Check source URL for changes
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            const f = await pickFile('.json,.yaml,.yml');
            if (f) void preview({ sourceType: 'file', content: f.text });
          }}
        >
          <FileUpIcon /> Compare with a file…
        </Button>
        {busy && <LoaderIcon className="size-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex gap-2">
        <Textarea className="h-16 font-mono text-xs" placeholder="…or paste the new JSON/YAML here" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <Button size="sm" variant="outline" className="self-end" disabled={!paste.trim() || busy} onClick={() => preview({ sourceType: 'paste', content: paste })}>
          Compare
        </Button>
      </div>
      {plan && !plan.upToDate && (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            Version {plan.fromVersion} <ArrowRightIcon className="size-3" /> {plan.toVersion}
          </div>
          <DiffView diff={plan.diff} />
          <div>
            <h5 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Effect on your requests</h5>
            <div className="max-h-56 overflow-auto rounded-md border">
              {plan.requests
                .filter((r) => r.action !== 'unchanged')
                .map((r, i) => (
                  <div key={i} className="flex items-center gap-2 border-b px-2 py-1 text-xs last:border-b-0">
                    <span className="truncate">{r.name}</span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">{r.label}</span>
                    <Badge variant={ACTION[r.action].variant} className="ml-auto">{ACTION[r.action].label}</Badge>
                  </div>
                ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Requests you edited after import are never overwritten. Requests whose operation was removed stay in place.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPlan(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply} disabled={busy}>
              Apply sync
            </Button>
          </div>
        </div>
      )}
      <VersionCompare spec={spec} />
    </div>
  );
}

function VersionCompare({ spec }: { spec: OpenApiSpecDetail }) {
  const [from, setFrom] = React.useState<string | undefined>(spec.versions[1]?.id);
  const [to, setTo] = React.useState<string | undefined>(spec.versions[0]?.id);
  const [diff, setDiff] = React.useState<SpecDiffSummary | null>(null);
  React.useEffect(() => {
    setFrom(spec.versions[1]?.id);
    setTo(spec.versions[0]?.id);
    setDiff(null);
  }, [spec.versions]);
  if (spec.versions.length < 2) return <p className="text-xs text-muted-foreground">Version history: {spec.versions.map((v) => v.label).join(', ')}. Compare appears once there are two versions.</p>;
  const label = (v: OpenApiSpecDetail['versions'][number]) => `${v.label} · ${new Date(v.importedAt).toLocaleString()}`;
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h5 className="text-xs font-semibold text-muted-foreground uppercase">Compare versions</h5>
      <div className="flex items-center gap-2">
        {[
          [from, setFrom],
          [to, setTo],
        ].map(([value, set], i) => (
          <Select key={i} value={value as string | undefined} onValueChange={set as (v: string) => void}>
            <SelectTrigger className="h-7 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {spec.versions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {label(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        <Button
          size="xs"
          variant="outline"
          disabled={!from || !to || from === to}
          onClick={() => api('GET /openapi/:id/compare', { params: { id: spec.id }, query: { from: from!, to: to! } }).then(setDiff, (e) => toast.error(errorMessage(e)))}
        >
          Compare
        </Button>
      </div>
      {diff && <DiffView diff={diff} />}
    </div>
  );
}
