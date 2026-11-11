import type { RequestSettings } from '@postguy/shared';
import { Input, Label } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';

export function SettingsEditor({ settings, onChange }: { settings: RequestSettings; onChange: (s: RequestSettings) => void }) {
  return (
    <div className="flex max-w-xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-foreground">Timeout (ms)</Label>
          <p className="text-xs text-muted-foreground">Abort the request after this long. Default 30000.</p>
        </div>
        <Input
          type="number"
          className="w-32"
          min={1}
          placeholder="30000"
          value={settings.timeoutMs ?? ''}
          onChange={(e) => onChange({ ...settings, timeoutMs: e.target.value ? Number(e.target.value) : undefined })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-foreground">Follow redirects</Label>
          <p className="text-xs text-muted-foreground">Automatically follow 3xx responses (up to 5).</p>
        </div>
        <Switch checked={settings.followRedirects !== false} onCheckedChange={(v) => onChange({ ...settings, followRedirects: v })} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-foreground">Verify TLS certificates</Label>
          <p className="text-xs text-muted-foreground">Turn off for self-signed certificates in development.</p>
        </div>
        <Switch
          checked={settings.rejectUnauthorized !== false}
          onCheckedChange={(v) => onChange({ ...settings, rejectUnauthorized: v })}
        />
      </div>
    </div>
  );
}
