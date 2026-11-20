import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyIcon, ShieldCheckIcon } from 'lucide-react';
import { toast } from 'sonner';
import { create } from 'zustand';
import type { McpSettings as Settings } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useUi } from '@/stores/ui';

export const useMcpDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const KEY = ['settings', 'mcp'] as const;

function Row({ title, detail, checked, disabled, onChange }: { title: string; detail: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </label>
  );
}

/** Settings → Claude: whether Claude may read, send and edit through MCP, and how to connect it. */
export function McpSettingsDialog() {
  const { open, setOpen } = useMcpDialog();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: KEY, queryFn: () => api('GET /settings/mcp'), enabled: open });
  const setup = useQuery({ queryKey: ['settings', 'mcp', 'setup'], queryFn: () => api('GET /settings/mcp/setup'), enabled: open });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api('PATCH /settings/mcp', { body: patch }),
    onSuccess: (next) => qc.setQueryData(KEY, next),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = settings.data;
  const set = (patch: Partial<Settings>) => save.mutate(patch);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Claude (MCP)</DialogTitle>
          <DialogDescription>Let Claude Code use your requests, environments and flows through the Model Context Protocol.</DialogDescription>
        </DialogHeader>
        {s && (
          <div className="flex flex-col">
            <Row title="Allow Claude" detail="Off by default. While off, Claude sees the tools but every call is refused." checked={s.enabled} onChange={(v) => set({ enabled: v })} />
            <div className="ml-3 flex flex-col border-l pl-3">
              <Row title="Read" detail="Requests, variables (secrets masked), history and flow runs." checked={s.read} disabled={!s.enabled} onChange={(v) => set({ read: v })} />
              <Row title="Send requests" detail="Send requests and run flows; labelled “MCP” in your history." checked={s.send} disabled={!s.enabled} onChange={(v) => set({ send: v })} />
              <Row title="Edit" detail="Create and change requests, set variables, switch environment, import." checked={s.edit} disabled={!s.enabled} onChange={(v) => set({ edit: v })} />
            </div>
          </div>
        )}
        <div className="flex gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
          <p>
            Secret values are masked in everything Claude reads, and a request carrying a secret is only sent to hosts your saved requests already use. In{' '}
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => useUi.getState().openEnvManager()}>
              Environments
            </button>{' '}
            you can keep an environment away from Claude, or let it see that environment's secrets.
          </p>
        </div>
        {setup.data && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Connect Claude Code (run once in a terminal)</span>
            <div className="flex items-start gap-1 rounded-md border bg-muted/40 p-2">
              <code className="min-w-0 flex-1 font-mono text-[11px] break-all select-text">{setup.data.claudeCode}</code>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Copy command"
                onClick={() => navigator.clipboard.writeText(setup.data.claudeCode).then(() => toast.success('Command copied'))}
              >
                <CopyIcon />
              </Button>
            </div>
            <span className="text-[11px] text-muted-foreground">Claude reaches Postguy only while the app is open.</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
