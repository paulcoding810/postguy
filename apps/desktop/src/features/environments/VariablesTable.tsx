import { EyeIcon, EyeOffIcon, LockIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { newId, type VariableScope } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/input';
import { Checkbox, Tooltip } from '@/components/ui/misc';
import { useSaveVariables, useVariables } from '@/hooks/queries';
import { cn } from '@/lib/utils';
import { TemplateInput } from '@/features/template/TemplateInput';

interface Row {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
}

const MASK = '••••••';

export function VariablesTable({
  scope,
  ownerId,
  hint,
  overrideNote,
}: {
  scope: VariableScope;
  ownerId: string;
  hint?: string;
  /** Explains that a variable hides a lower-precedence one, e.g. the active environment's. */
  overrideNote?: (key: string) => string | null;
}) {
  const [reveal, setReveal] = React.useState(false);
  const query = useVariables(scope, ownerId, reveal);
  const save = useSaveVariables(scope, ownerId);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [dirty, setDirty] = React.useState(false);
  const ghostId = React.useRef(newId(8));

  React.useEffect(() => {
    if (query.data && !dirty) setRows(query.data.map((v) => ({ id: v.id, key: v.key, value: v.value, isSecret: v.isSecret, enabled: v.enabled })));
  }, [query.data, dirty]);

  const edit = (id: string, patch: Partial<Row>) => {
    setDirty(true);
    if (id === ghostId.current) ghostId.current = newId(8);
    setRows((rs) => (rs.some((r) => r.id === id) ? rs.map((r) => (r.id === id ? { ...r, ...patch } : r)) : [...rs, { id, key: '', value: '', isSecret: false, enabled: true, ...patch }]));
  };

  const onSave = async () => {
    const list = rows.filter((r) => r.key.trim());
    const dupes = list.map((r) => r.key).filter((k, i, a) => a.indexOf(k) !== i);
    if (dupes.length) return toast.error(`Duplicate variable: ${dupes[0]}`);
    await save.mutateAsync(list.map(({ key, value, isSecret, enabled }) => ({ key: key.trim(), value, isSecret, enabled })));
    setDirty(false);
    toast.success('Variables saved');
  };

  const ghost: Row = { id: ghostId.current, key: '', value: '', isSecret: false, enabled: true };
  const cell = cn(inputClass, 'h-8 rounded-none border-0 shadow-none focus-visible:ring-0 font-mono text-xs dark:bg-transparent');

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 pb-2">
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip content={reveal ? 'Hide secret values' : 'Reveal secret values'}>
            <Button variant="ghost" size="icon-sm" onClick={() => setReveal((r) => !r)} disabled={dirty} aria-label="Toggle secret values">
              {reveal ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          </Tooltip>
          <Button size="sm" onClick={onSave} disabled={!dirty || save.isPending}>
            <SaveIcon /> Save
          </Button>
        </div>
      </div>
      <div className="min-h-0 overflow-auto rounded-md border">
        <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1.6fr)_36px_32px] border-b bg-muted/40 text-[11px] font-medium text-muted-foreground uppercase">
          <div />
          <div className="px-2.5 py-1.5">Variable</div>
          <div className="px-2.5 py-1.5">Value</div>
          <Tooltip content="Secret: masked in the UI, logs and exports">
            <div className="flex items-center justify-center">
              <LockIcon className="size-3" />
            </div>
          </Tooltip>
          <div />
        </div>
        {[...rows, ghost].map((r) => {
          const isGhost = r === ghost;
          const masked = r.isSecret && r.value === MASK;
          return (
            <div key={r.id} className={cn('group grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1.6fr)_36px_32px] border-b last:border-b-0', !r.enabled && !isGhost && 'opacity-50')}>
              <div className="flex items-center justify-center">
                {!isGhost && <Checkbox checked={r.enabled} onCheckedChange={(v) => edit(r.id, { enabled: !!v })} />}
              </div>
              <div className="relative flex min-w-0 items-center border-l">
                <input
                  className={cn(cell, 'min-w-0 flex-1')}
                  placeholder={isGhost ? 'Add variable' : ''}
                  value={r.key}
                  spellCheck={false}
                  onChange={(e) => edit(r.id, { key: e.target.value })}
                />
                {!isGhost && r.enabled && overrideNote?.(r.key) && (
                  <Tooltip content={overrideNote(r.key)}>
                    <span className="mr-1.5 shrink-0 rounded bg-warning/15 px-1 text-[10px] font-medium text-warning">overrides env</span>
                  </Tooltip>
                )}
              </div>
              {masked ? (
                <input
                  className={cn(cell, 'border-l')}
                  value={r.value}
                  spellCheck={false}
                  type="password"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => edit(r.id, { value: e.target.value })}
                />
              ) : (
                <TemplateInput
                  className="border-l"
                  borderless
                  inputClassName="h-8 font-mono text-xs"
                  value={r.value}
                  fieldLabel={`${r.key || 'Variable'} value`}
                  placeholder={isGhost ? '' : 'Value, or {{Login.data.token}}'}
                  onChange={(v) => edit(r.id, { value: v })}
                />
              )}
              <div className="flex items-center justify-center border-l">
                {!isGhost && <Checkbox checked={r.isSecret} onCheckedChange={(v) => edit(r.id, { isSecret: !!v })} aria-label="Secret" />}
              </div>
              <div className="flex items-center justify-center">
                {!isGhost && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover:opacity-100"
                    aria-label="Remove variable"
                    onClick={() => {
                      setDirty(true);
                      setRows((rs) => rs.filter((x) => x.id !== r.id));
                    }}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
