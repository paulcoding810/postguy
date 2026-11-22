import { EyeIcon, EyeOffIcon, LoaderIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import type { ResolvedPreview, VariableScope } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/misc';
import { useEnvironments, useInvalidateVariables, useTree, useVariables } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { chainTo } from '@/features/collections/treeUtils';
import { scopeLabel, shadowNotes } from './scopeNote';
import { useTemplateCtx } from './TemplateContext';

type PreviewRef = ResolvedPreview['refs'][number];

const EDITABLE: readonly string[] = ['request', 'flow', 'collection', 'environment', 'global'];

const field =
  'h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11.5px] outline-none focus:border-ring focus:ring-1 focus:ring-ring/40';

function useSaveVariable() {
  const invalidate = useInvalidateVariables();
  const [saving, setSaving] = React.useState(false);
  const save = async (
    scope: VariableScope,
    ownerId: string,
    key: string,
    value: string,
    isSecret?: boolean,
  ) => {
    setSaving(true);
    try {
      await api('PUT /variables/:scope/:ownerId/:key', {
        params: { scope, ownerId, key },
        body: { value, isSecret },
      });
      invalidate();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { save, saving };
}

/** Names that usually hold credentials, so a new variable starts out secret. */
const LOOKS_SECRET = /token|secret|password|passwd|api[_-]?key|apikey|auth|credential|private|session|cookie/i;

function SecretCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground select-none">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} aria-label="Secret" />
      Secret
    </label>
  );
}

function SecretToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      onClick={onToggle}
      aria-label={shown ? 'Hide value' : 'Show value'}
    >
      {shown ? <EyeOffIcon /> : <EyeIcon />}
    </Button>
  );
}

interface EditProps {
  /** Focus the value and select it, ready to type over. */
  focus?: boolean;
  /** Called after a successful save. */
  onDone?: () => void;
}

/** Focuses and selects an input once it exists and `when` turns true. */
function useFocusSelect(ref: React.RefObject<HTMLInputElement | null>, when: boolean, ready = true) {
  React.useEffect(() => {
    if (!when || !ready) return;
    const id = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [ref, when, ready]);
}

function EditValue({ name, scope, ownerId, focus, onDone }: { name: string; scope: VariableScope; ownerId: string } & EditProps) {
  const vars = useVariables(scope, ownerId, true);
  const current = vars.data?.find((v) => v.key === name);
  const [value, setValue] = React.useState<string | null>(null);
  const [secret, setSecret] = React.useState<boolean | null>(null);
  const [shown, setShown] = React.useState(false);
  const { save, saving } = useSaveVariable();
  const inputRef = React.useRef<HTMLInputElement>(null);
  useFocusSelect(inputRef, !!focus, !!current);
  if (!current) return <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />;
  const text = value ?? current.value;
  const isSecret = secret ?? current.isSecret;
  const dirty = (value !== null && value !== current.value) || isSecret !== current.isSecret;
  const submit = async () => {
    if (!dirty) return onDone?.();
    if (await save(scope, ownerId, name, text, isSecret)) {
      setValue(null);
      setSecret(null);
      onDone?.();
    }
  };
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        ref={inputRef}
        aria-label={`Value of ${name}`}
        className={field}
        type={isSecret && !shown ? 'password' : 'text'}
        value={text}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          setValue(null);
          setSecret(null);
        }}
      />
      {isSecret && <SecretToggle shown={shown} onToggle={() => setShown((s) => !s)} />}
      <SecretCheck checked={isSecret} onChange={setSecret} />
      {dirty && (
        <Button type="submit" size="xs" disabled={saving}>
          Save
        </Button>
      )}
    </form>
  );
}

function AddValue({ name, focus, onDone }: { name: string } & EditProps) {
  const { owner } = useTemplateCtx();
  const tree = useTree();
  const active = useEnvironments().data?.find((e) => e.kind === 'environment' && e.isActive);
  const global = useEnvironments().data?.find((e) => e.kind === 'global');
  const root = owner.collectionId ? chainTo(tree.data, owner.collectionId)[0] : undefined;
  const targets = [
    active && {
      key: `environment:${active.id}`,
      scope: 'environment' as const,
      ownerId: active.id,
      label: `Environment "${active.name}"`,
    },
    root && {
      key: `collection:${root.id}`,
      scope: 'collection' as const,
      ownerId: root.id,
      label: `Collection "${root.name}"`,
    },
    global && { key: `global:${global.id}`, scope: 'global' as const, ownerId: global.id, label: 'Globals' },
    owner.requestId ? { key: `request:${owner.requestId}`, scope: 'request' as const, ownerId: owner.requestId, label: 'This request' } : null,
  ].filter((t): t is NonNullable<typeof t> => !!t);
  const [target, setTarget] = React.useState<string | null>(null);
  const [value, setValue] = React.useState('');
  const [secret, setSecret] = React.useState(() => LOOKS_SECRET.test(name));
  const { save, saving } = useSaveVariable();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const chosen = targets.find((t) => t.key === target) ?? targets[0];
  useFocusSelect(inputRef, !!focus, !!chosen);
  if (!chosen) return null;
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save(chosen.scope, chosen.ownerId, name, value, secret).then((ok) => ok && onDone?.());
      }}
    >
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          aria-label={`Value of ${name}`}
          className={field}
          placeholder="Value"
          type={secret ? 'password' : 'text'}
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" size="xs" disabled={saving}>
          Add
        </Button>
      </div>
      <div className="flex items-center gap-2">
      <select
        aria-label="Where to add it"
        className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-[11.5px]"
        value={chosen.key}
        onChange={(e) => setTarget(e.target.value)}
      >
        {targets.map((t) => (
          <option key={t.key} value={t.key}>
            Add to {t.label}
          </option>
        ))}
      </select>
        <SecretCheck checked={secret} onChange={setSecret} />
      </div>
    </form>
  );
}

/** One `{{name}}` in the variable popup: its value, where it comes from, and a way to change it. */
export function VariableRow({ name, preview, focus, onDone }: { name: string; preview: PreviewRef | undefined } & EditProps) {
  const editable = !!preview?.resolved && EDITABLE.includes(preview.source ?? '') && !!preview.ownerId;
  const builtIn = name.startsWith('$') && !name.startsWith('$res');
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[11.5px]">
        <span className="font-mono font-medium">{`{{${name}}}`}</span>
        <span
          className={cn(
            'rounded px-1 text-[10px]',
            preview?.resolved ? 'bg-muted text-muted-foreground' : 'bg-destructive/15 text-destructive',
          )}
        >
          {!preview ? '…' : preview.resolved ? scopeLabel(preview.source) : 'not defined'}
        </span>
        {preview?.resolved && preview.preview === '' && <span className="rounded bg-warning/15 px-1 text-[10px] text-warning">empty</span>}
      </div>
      {editable ? (
        <EditValue name={name} scope={preview.source as VariableScope} ownerId={preview.ownerId!} focus={focus} onDone={onDone} />
      ) : preview?.resolved ? (
        <div className="truncate font-mono text-[11.5px] text-muted-foreground" title={preview.preview ?? ''}>
          {preview.preview}
        </div>
      ) : preview && !builtIn && !/[.[]/.test(name) ? (
        <AddValue name={name} focus={focus} onDone={onDone} />
      ) : preview?.preview ? (
        <div className="text-[11px] text-destructive">{preview.preview}</div>
      ) : null}
      {shadowNotes(preview).map((n) => (
        <span key={n} className="text-[11px] text-warning">
          {n}
        </span>
      ))}
    </div>
  );
}
