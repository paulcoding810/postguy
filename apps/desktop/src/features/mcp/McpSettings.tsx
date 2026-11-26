import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyIcon, FolderOpenIcon, ShieldCheckIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import type { McpSettings as Settings } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useUi } from '@/stores/ui';
import { pickFolderPath } from '@/features/request/FilePathField';

const KEY = ['settings', 'mcp'] as const;

export function Row({ title, detail, checked, disabled, onChange }: { title: string; detail: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
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

/** The one folder Claude may upload files from; none means Claude can't upload. */
function UploadFolder({ folder, disabled, onChange }: { folder: string | null; disabled: boolean; onChange: (folder: string | null) => void }) {
  const [typed, setTyped] = React.useState('');
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Upload folder</span>
        <span className="text-xs text-muted-foreground">Claude may send files in form-data and binary bodies only from this folder. None: Claude can't upload.</span>
      </span>
      <div className="flex items-center gap-1">
        {folder ? (
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1 font-mono text-[11px]" title={folder}>
            {folder}
          </code>
        ) : (
          <input
            aria-label="Upload folder path"
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px]"
            placeholder="None"
            value={typed}
            disabled={disabled}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && typed.trim() && onChange(typed.trim())}
          />
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={async () => {
            const path = await pickFolderPath();
            if (path) onChange(path);
          }}
        >
          <FolderOpenIcon /> Choose…
        </Button>
        {folder && (
          <Button size="icon-xs" variant="ghost" aria-label="No upload folder" disabled={disabled} onClick={() => onChange(null)}>
            <XIcon />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Settings → Claude: whether Claude may read, send and edit through MCP, and how to connect it. */
export function McpSettingsPanel() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: KEY, queryFn: () => api('GET /settings/mcp') });
  const setup = useQuery({ queryKey: ['settings', 'mcp', 'setup'], queryFn: () => api('GET /settings/mcp/setup') });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api('PATCH /settings/mcp', { body: patch }),
    onSuccess: (next) => qc.setQueryData(KEY, next),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = settings.data;
  const set = (patch: Partial<Settings>) => save.mutate(patch);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">Let Claude Code use your requests, environments and flows through the Model Context Protocol.</p>
        {s && (
          <div className="flex flex-col">
            <Row title="Allow Claude" detail="Off by default. While off, Claude sees the tools but every call is refused." checked={s.enabled} onChange={(v) => set({ enabled: v })} />
            <div className="ml-3 flex flex-col border-l pl-3">
              <Row title="Read" detail="Requests, variables (secrets masked), history and flow runs." checked={s.read} disabled={!s.enabled} onChange={(v) => set({ read: v })} />
              <Row title="Send requests" detail="Send requests and run flows; labelled “MCP” in your history." checked={s.send} disabled={!s.enabled} onChange={(v) => set({ send: v })} />
              <div className="ml-3 border-l pl-3">
                <Row
                  title="Must name the environment"
                  detail="Claude has to say which environment to send with or write to, so switching the active one here never redirects it."
                  checked={s.requireEnvironment}
                  disabled={!s.enabled}
                  onChange={(v) => set({ requireEnvironment: v })}
                />
              </div>
              <div className="ml-3 border-l pl-3">
                <UploadFolder folder={s.uploadFolder} disabled={!s.enabled || !s.send} onChange={(uploadFolder) => set({ uploadFolder })} />
              </div>
              <Row title="Edit" detail="Create and change requests, set variables, switch environment, import." checked={s.edit} disabled={!s.enabled} onChange={(v) => set({ edit: v })} />
              <div className="ml-3 border-l pl-3">
                <Row
                  title="Delete"
                  detail="Delete requests and folders, up to 50 requests at a time. Each deletion can be brought back from Change history or Recently deleted."
                  checked={s.delete && s.edit}
                  disabled={!s.enabled || !s.edit}
                  onChange={(v) => set({ delete: v })}
                />
              </div>
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
    </div>
  );
}
