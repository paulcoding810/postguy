import type { RequestSettings } from '@postguy/shared';
import { Input, Label } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { useRequestDefaults, useSettings } from '@/features/settings/SettingsDialog';

const MAX_TIMEOUT_MS = 600_000;

function clampTimeout(text: string): number | undefined {
  const n = Math.round(Number(text));
  if (!text || !Number.isFinite(n) || n < 1) return undefined;
  return Math.min(n, MAX_TIMEOUT_MS);
}

/** Where a setting's value comes from: this request, or the defaults in Settings. */
function Source({ own, onReset }: { own: boolean; onReset: () => void }) {
  return own ? (
    <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={onReset}>
      Use default
    </button>
  ) : (
    <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => useSettings.getState().open('requests')}>
      Default
    </button>
  );
}

export function SettingsEditor({ settings, onChange }: { settings: RequestSettings; onChange: (s: RequestSettings) => void }) {
  const defaults = useRequestDefaults().data ?? { timeoutMs: 30_000, followRedirects: true, rejectUnauthorized: true };
  const reset = (key: 'timeoutMs' | 'followRedirects' | 'rejectUnauthorized') => {
    const { [key]: _gone, ...rest } = settings;
    onChange(rest);
  };
  return (
    <div className="flex max-w-xl flex-col gap-4 p-4">
      <p className="text-xs text-muted-foreground">
        Settings marked <i>Default</i> follow{' '}
        <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => useSettings.getState().open('requests')}>
          Settings → Requests
        </button>
        ; changing one here applies to this request only.
      </p>
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-foreground">Timeout (ms)</Label>
          <p className="text-xs text-muted-foreground">Abort the request after this long. Maximum 600000.</p>
        </div>
        <Source own={settings.timeoutMs !== undefined} onReset={() => reset('timeoutMs')} />
        <Input
          type="number"
          className="w-32"
          min={1}
          max={MAX_TIMEOUT_MS}
          step={1}
          placeholder={String(defaults.timeoutMs)}
          value={settings.timeoutMs ?? ''}
          onChange={(e) => onChange({ ...settings, timeoutMs: clampTimeout(e.target.value) })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-foreground">Follow redirects</Label>
          <p className="text-xs text-muted-foreground">Automatically follow 3xx responses (up to 5).</p>
        </div>
        <Source own={settings.followRedirects !== undefined} onReset={() => reset('followRedirects')} />
        <Switch checked={settings.followRedirects ?? defaults.followRedirects} onCheckedChange={(v) => onChange({ ...settings, followRedirects: v })} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-foreground">Verify TLS certificates</Label>
          <p className="text-xs text-muted-foreground">Turn off for self-signed certificates in development.</p>
        </div>
        <Source own={settings.rejectUnauthorized !== undefined} onReset={() => reset('rejectUnauthorized')} />
        <Switch
          checked={settings.rejectUnauthorized ?? defaults.rejectUnauthorized}
          onCheckedChange={(v) => onChange({ ...settings, rejectUnauthorized: v })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-foreground">Use the cookie jar</Label>
          <p className="text-xs text-muted-foreground">Send stored cookies and keep the ones this response sets.</p>
        </div>
        <Switch checked={settings.cookies !== false} onCheckedChange={(v) => onChange({ ...settings, cookies: v ? undefined : false })} />
      </div>
    </div>
  );
}
