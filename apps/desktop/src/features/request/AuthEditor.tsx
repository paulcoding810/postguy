import { InfoIcon } from 'lucide-react';
import type { Auth, AuthType } from '@postguy/shared';
import { Label } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TemplateInput } from '@/features/template/TemplateInput';

const LABELS: Record<AuthType, string> = {
  inherit: 'Inherit from parent',
  none: 'No auth',
  bearer: 'Bearer token',
  basic: 'Basic auth',
  apikey: 'API key',
  oauth2: 'OAuth 2.0',
};

function blank(type: AuthType): Auth {
  switch (type) {
    case 'bearer':
      return { type, token: '' };
    case 'basic':
      return { type, username: '', password: '' };
    case 'apikey':
      return { type, key: 'X-API-Key', value: '', in: 'header' };
    case 'oauth2':
      return { type, grantType: 'client_credentials', tokenUrl: '', clientId: '', clientSecret: '', scope: '' };
    default:
      return { type } as Auth;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function AuthEditor({
  auth,
  onChange,
  allowInherit = true,
  inheritedFrom,
}: {
  auth: Auth;
  onChange: (auth: Auth) => void;
  allowInherit?: boolean;
  inheritedFrom?: string | null;
}) {
  const types = (Object.keys(LABELS) as AuthType[]).filter((t) => allowInherit || t !== 'inherit');
  const set = <K extends string>(key: K, value: string) => onChange({ ...auth, [key]: value } as Auth);

  return (
    <div className="flex max-w-2xl flex-col gap-3 p-4">
      <Field label="Type">
        <Select value={auth.type} onValueChange={(t) => onChange(blank(t as AuthType))}>
          <SelectTrigger className="w-56" aria-label="Auth type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {auth.type === 'inherit' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <InfoIcon className="size-3.5" />
          {inheritedFrom ? `Uses auth from "${inheritedFrom}".` : 'Uses the auth of the parent folder or collection.'}
        </p>
      )}
      {auth.type === 'none' && <p className="text-xs text-muted-foreground">This request does not use authorization.</p>}
      {auth.type === 'bearer' && (
        <Field label="Token">
          <TemplateInput value={auth.token} onChange={(v) => set('token', v)} fieldLabel="Bearer token" placeholder="{{access_token}}" />
        </Field>
      )}
      {auth.type === 'basic' && (
        <>
          <Field label="Username">
            <TemplateInput value={auth.username} onChange={(v) => set('username', v)} fieldLabel="Username" />
          </Field>
          <Field label="Password">
            <TemplateInput value={auth.password} onChange={(v) => set('password', v)} fieldLabel="Password" />
          </Field>
        </>
      )}
      {auth.type === 'apikey' && (
        <>
          <Field label="Key">
            <TemplateInput value={auth.key} onChange={(v) => set('key', v)} fieldLabel="API key name" />
          </Field>
          <Field label="Value">
            <TemplateInput value={auth.value} onChange={(v) => set('value', v)} fieldLabel="API key value" />
          </Field>
          <Field label="Add to">
            <Select value={auth.in} onValueChange={(v) => onChange({ ...auth, in: v as 'header' | 'query' })}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">Header</SelectItem>
                <SelectItem value="query">Query params</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      )}
      {auth.type === 'oauth2' && (
        <>
          <Field label="Grant type">
            <Select value={auth.grantType} onValueChange={(v) => onChange({ ...auth, grantType: v as typeof auth.grantType })}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client_credentials">Client credentials</SelectItem>
                <SelectItem value="password">Password</SelectItem>
                <SelectItem value="authorization_code">Authorization code</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Token URL">
            <TemplateInput value={auth.tokenUrl} onChange={(v) => set('tokenUrl', v)} fieldLabel="Token URL" />
          </Field>
          <Field label="Client ID">
            <TemplateInput value={auth.clientId} onChange={(v) => set('clientId', v)} fieldLabel="Client ID" />
          </Field>
          <Field label="Client secret">
            <TemplateInput value={auth.clientSecret} onChange={(v) => set('clientSecret', v)} fieldLabel="Client secret" />
          </Field>
          <Field label="Scope">
            <TemplateInput value={auth.scope ?? ''} onChange={(v) => set('scope', v)} fieldLabel="Scope" />
          </Field>
          <Field label="Access token">
            <TemplateInput
              value={auth.accessToken ?? ''}
              onChange={(v) => set('accessToken', v)}
              fieldLabel="OAuth access token"
              placeholder="Paste a token or reference {{Login.data.access_token}}"
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            The access token is sent as a Bearer header. Automatic token exchange is planned for a later release.
          </p>
        </>
      )}
    </div>
  );
}
