import * as React from 'react';
import { create } from 'zustand';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatSegs, type Seg } from '@/features/memory/refs';
import { cn } from '@/lib/utils';
import { saveLine, suggestName, type SaveScope } from './scriptSuggestions';

const SCOPE_KEY = 'postguy.saveScope';

function readScope(): SaveScope {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'environment' ? 'environment' : 'collection';
  } catch {
    return 'collection';
  }
}

/** Where "Save as variable" saves: the last choice, collection by default. */
export const useSaveScope = create<{ scope: SaveScope; setScope: (s: SaveScope) => void }>((set) => ({
  scope: readScope(),
  setScope: (scope) => {
    try {
      localStorage.setItem(SCOPE_KEY, scope);
    } catch {
      /* storage unavailable */
    }
    set({ scope });
  },
}));

const SCOPES: { id: SaveScope; label: string; hint: string }[] = [
  { id: 'collection', label: 'Collection', hint: 'Shared by the requests in this collection.' },
  { id: 'environment', label: 'Environment', hint: 'Saved in the active environment, or globals when none is active.' },
];

/** Asks for a name and scope, then hands back the post-response line that saves the value. */
export function SaveVariableDialog({
  target,
  hasCollection,
  onClose,
  onSave,
}: {
  target: Seg[] | null;
  hasCollection: boolean;
  onClose: () => void;
  onSave: (code: string, name: string) => void;
}) {
  const { scope: remembered, setScope } = useSaveScope();
  const [name, setName] = React.useState('');
  const scope: SaveScope = hasCollection ? remembered : 'environment';
  React.useEffect(() => {
    if (target) setName(suggestName(target));
  }, [target]);
  const valid = /^[A-Za-z_][\w.-]*$/.test(name);

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!target || !valid) return;
            onSave(saveLine(target, name, scope), name);
          }}
        >
          <DialogHeader>
            <DialogTitle>Save as a variable</DialogTitle>
            <DialogDescription>
              Adds a line to the post-response script that saves <code className="font-mono">{formatSegs(target ?? []) || 'the body'}</code> each time the request runs.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-xs">
            Name
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} className="font-mono" aria-invalid={!valid} />
          </label>
          <div className="grid gap-1.5 text-xs">
            Save in
            <div className="flex gap-1" role="radiogroup" aria-label="Save in">
              {SCOPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={scope === s.id}
                  disabled={s.id === 'collection' && !hasCollection}
                  onClick={() => setScope(s.id)}
                  className={cn('flex-1 rounded-md border px-2 py-1.5 text-xs disabled:opacity-50', scope === s.id ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent')}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">{hasCollection ? SCOPES.find((s) => s.id === scope)!.hint : 'Save the request in a collection to keep values there.'}</span>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Add to script
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
