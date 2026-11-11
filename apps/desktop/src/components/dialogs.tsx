import * as React from 'react';
import { create } from 'zustand';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface PromptRequest {
  kind: 'prompt' | 'confirm';
  title: string;
  description?: string;
  initial?: string;
  confirmLabel?: string;
  destructive?: boolean;
  resolve: (value: string | boolean | null) => void;
}

const useDialogs = create<{ current: PromptRequest | null; set: (r: PromptRequest | null) => void }>((set) => ({
  current: null,
  set: (current) => set({ current }),
}));

export function prompt(opts: { title: string; description?: string; initial?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) =>
    useDialogs.getState().set({ kind: 'prompt', ...opts, resolve: (v) => resolve(typeof v === 'string' ? v : null) }),
  );
}

export function confirm(opts: { title: string; description?: string; confirmLabel?: string; destructive?: boolean }): Promise<boolean> {
  return new Promise((resolve) => useDialogs.getState().set({ kind: 'confirm', ...opts, resolve: (v) => resolve(v === true) }));
}

export function DialogHost() {
  const { current, set } = useDialogs();
  const [value, setValue] = React.useState('');
  React.useEffect(() => setValue(current?.initial ?? ''), [current]);

  const finish = (v: string | boolean | null) => {
    current?.resolve(v);
    set(null);
  };

  return (
    <Dialog open={!!current} onOpenChange={(o) => !o && finish(null)}>
      {current && (
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (current.kind === 'prompt') {
                if (value.trim()) finish(value.trim());
              } else finish(true);
            }}
          >
            <DialogHeader>
              <DialogTitle>{current.title}</DialogTitle>
              {current.description && <DialogDescription>{current.description}</DialogDescription>}
            </DialogHeader>
            {current.kind === 'prompt' && <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => finish(null)}>
                Cancel
              </Button>
              <Button type="submit" variant={current.destructive ? 'destructive' : 'default'} autoFocus={current.kind === 'confirm'}>
                {current.confirmLabel ?? (current.kind === 'prompt' ? 'Save' : 'Confirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
