import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BotIcon, CopyIcon, DatabaseIcon, FolderOpenIcon, SendIcon, SlidersHorizontalIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import type { RequestDefaults } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { McpSettingsPanel, Row } from '@/features/mcp/McpSettings';
import { useCookieManager } from '@/features/cookies/CookieManager';
import { api, errorMessage } from '@/lib/api';
import { openExternal } from '@/lib/openExternal';
import { isTauri } from '@/lib/server';
import { checkForUpdates, useAutoUpdateCheck } from '@/lib/updates';
import { cn, formatBytes } from '@/lib/utils';
import { useUi, type Theme } from '@/stores/ui';

export type SettingsSection = 'general' | 'requests' | 'claude' | 'data';

export const useSettings = create<{ section: SettingsSection | null; open: (s?: SettingsSection) => void; close: () => void }>((set) => ({
  section: null,
  open: (section = 'general') => set({ section }),
  close: () => set({ section: null }),
}));

const SECTIONS: { id: SettingsSection; label: string; icon: React.ElementType }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontalIcon },
  { id: 'requests', label: 'Requests', icon: SendIcon },
  { id: 'claude', label: 'Claude (MCP)', icon: BotIcon },
  { id: 'data', label: 'Data', icon: DatabaseIcon },
];

export const requestDefaultsKey = ['settings', 'requests'] as const;

export function useRequestDefaults() {
  return useQuery({ queryKey: requestDefaultsKey, queryFn: () => api('GET /settings/requests'), staleTime: 60_000 });
}

/** Settings, opened with ⌘, from ⌘K or the app menu; one page per section. */
export function SettingsDialog() {
  const { section, open, close } = useSettings();
  React.useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) => listen('open-settings', () => useSettings.getState().open('general')).then((u) => (unlisten = u)));
    return () => unlisten?.();
  }, []);
  return (
    <Dialog open={!!section} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex h-[560px] max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r bg-sidebar p-2" aria-label="Settings sections">
          <DialogTitle className="px-2 pt-1 pb-2 text-sm">Settings</DialogTitle>
          <DialogDescription className="sr-only">App settings</DialogDescription>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={section === s.id}
              onClick={() => open(s.id)}
              className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent', section === s.id && 'bg-accent text-foreground')}
            >
              <s.icon className="size-4" /> {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto p-5">
          <h2 className="mb-3 text-base font-semibold">{SECTIONS.find((s) => s.id === section)?.label}</h2>
          {section === 'general' && <GeneralSettings />}
          {section === 'requests' && <RequestSettings />}
          {section === 'claude' && <McpSettingsPanel />}
          {section === 'data' && <DataSettings />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ title, detail, children }: { title: string; detail?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      </span>
      {children}
    </div>
  );
}

function useAppVersion() {
  const [version, setVersion] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!isTauri) return;
    void import('@tauri-apps/api/app').then((m) => m.getVersion()).then(setVersion);
  }, []);
  return version;
}

function GeneralSettings() {
  const { theme, setTheme } = useUi();
  const updates = useAutoUpdateCheck();
  const version = useAppVersion();
  return (
    <div className="flex flex-col divide-y">
      <Field title="Theme">
        <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <SelectTrigger className="w-36" aria-label="Theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">Match system</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Row
        title="Check for updates automatically"
        detail="At most once a day, a single request to GitHub. Nothing installs until you choose to."
        checked={updates.on}
        onChange={updates.set}
      />
      <Field title="Version" detail={version ? `Postguy ${version}` : 'Development build'}>
        <div className="flex gap-1.5">
          {version && (
            <Button size="sm" variant="ghost" onClick={() => void openExternal(`https://github.com/paulcoding810/postguy/releases/tag/v${version}`)}>
              Release notes
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void checkForUpdates()}>
            Check now
          </Button>
        </div>
      </Field>
    </div>
  );
}

const MAX_TIMEOUT_MS = 600_000;

function RequestSettings() {
  const qc = useQueryClient();
  const defaults = useRequestDefaults();
  const save = useMutation({
    mutationFn: (patch: Partial<RequestDefaults>) => api('PATCH /settings/requests', { body: patch }),
    onSuccess: (next) => qc.setQueryData(requestDefaultsKey, next),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = defaults.data;
  const [timeout, setTimeoutText] = React.useState('');
  React.useEffect(() => {
    if (d) setTimeoutText(String(d.timeoutMs));
  }, [d?.timeoutMs]);
  if (!d) return null;
  const commitTimeout = () => {
    const n = Math.round(Number(timeout));
    if (!Number.isFinite(n) || n < 1) return setTimeoutText(String(d.timeoutMs));
    const clamped = Math.min(n, MAX_TIMEOUT_MS);
    setTimeoutText(String(clamped));
    if (clamped !== d.timeoutMs) save.mutate({ timeoutMs: clamped });
  };
  return (
    <div className="flex flex-col">
      <p className="mb-2 text-xs text-muted-foreground">
        Every request uses these unless its own <b className="font-medium text-foreground">Settings</b> tab says otherwise. Flows and Claude use them too.
      </p>
      <div className="flex flex-col divide-y">
        <Field title="Timeout (ms)" detail={`Abort a request after this long. Maximum ${MAX_TIMEOUT_MS.toLocaleString()}.`}>
          <Input
            type="number"
            className="w-32"
            min={1}
            max={MAX_TIMEOUT_MS}
            aria-label="Default timeout"
            value={timeout}
            onChange={(e) => setTimeoutText(e.target.value)}
            onBlur={commitTimeout}
            onKeyDown={(e) => e.key === 'Enter' && commitTimeout()}
          />
        </Field>
        <Row title="Follow redirects" detail="Follow 3xx responses, up to 5." checked={d.followRedirects} onChange={(v) => save.mutate({ followRedirects: v })} />
        <Row title="Verify TLS certificates" detail="Turn off only for self-signed certificates in development." checked={d.rejectUnauthorized} onChange={(v) => save.mutate({ rejectUnauthorized: v })} />
      </div>
    </div>
  );
}

function DataSettings() {
  const info = useQuery({ queryKey: ['settings', 'app'], queryFn: () => api('GET /settings/app') });
  const d = info.data;
  const reveal = async (path: string) => {
    if (!isTauri) return void navigator.clipboard.writeText(path).then(() => toast.success('Path copied'));
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(path);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (!d) return null;
  return (
    <div className="flex flex-col divide-y">
      <Field title="Data folder" detail="Your requests, history, variables and settings, in one SQLite database. Nothing leaves this machine unless you send it.">
        {d.database ? (
          <Button size="sm" variant="outline" onClick={() => void reveal(d.database!)}>
            {isTauri ? <FolderOpenIcon /> : <CopyIcon />} {isTauri ? 'Show in folder' : 'Copy path'}
          </Button>
        ) : null}
      </Field>
      {d.dataDir && <p className="py-2 font-mono text-[11px] break-all text-muted-foreground select-text">{d.dataDir}</p>}
      <div className="py-2">
        <span className="text-sm font-medium">Backups</span>
        <p className="text-xs text-muted-foreground">Copies of the database taken before an update changed it; the latest three are kept.</p>
        {d.backups.length ? (
          <ul className="mt-2 flex flex-col gap-1">
            {d.backups.map((b) => (
              <li key={b.name} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-mono">{b.name}</span>
                <span className="text-muted-foreground">{new Date(b.createdAt).toLocaleDateString()}</span>
                <span className="w-16 text-right text-muted-foreground">{formatBytes(b.size)}</span>
                <Button size="icon-xs" variant="ghost" aria-label={`Show ${b.name}`} onClick={() => void reveal(b.path)}>
                  {isTauri ? <FolderOpenIcon /> : <CopyIcon />}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground italic">None yet.</p>
        )}
      </div>
      <Field title="Cookies" detail="Cookies responses have set, sent with later requests to the same site.">
        <Button size="sm" variant="outline" onClick={() => useCookieManager.getState().setOpen(true)}>
          Manage cookies
        </Button>
      </Field>
    </div>
  );
}
