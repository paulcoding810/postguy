import { GitBranchIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/misc';
import { useTree } from '@/hooks/queries';
import { cn } from '@/lib/utils';
import { allRequests } from '@/features/collections/treeUtils';

export type AddChoice = { kind: 'request'; requestId: string; name: string } | { kind: 'condition' };

/**
 * Picks steps to add. Ticking several requests adds them as a chain, in the order ticked;
 * the condition entry is added on its own.
 */
export function AddStepMenu({ onAdd, label = 'Add step', variant = 'outline' }: { onAdd: (c: AddChoice[]) => void; label?: string; variant?: 'outline' | 'default' }) {
  const tree = useTree();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [picked, setPicked] = React.useState<{ requestId: string; name: string }[]>([]);
  const list = allRequests(tree.data).filter((r) => !q || `${r.name} ${r.path} ${r.url}`.toLowerCase().includes(q.toLowerCase()));

  const close = () => {
    setOpen(false);
    setQ('');
    setPicked([]);
  };
  const toggle = (r: { id: string; name: string }) =>
    setPicked((p) => (p.some((x) => x.requestId === r.id) ? p.filter((x) => x.requestId !== r.id) : [...p, { requestId: r.id, name: r.name }]));
  const add = (choices: AddChoice[]) => {
    if (!choices.length) return;
    close();
    onAdd(choices);
  };
  const addPicked = () => add(picked.map((p) => ({ kind: 'request' as const, ...p })));
  /** The two clicks of a double-click have toggled `r` on and off again; add it after whatever else is ticked. */
  const addWith = (r: { id: string; name: string }) =>
    add([...picked.filter((p) => p.requestId !== r.id), { requestId: r.id, name: r.name }].map((p) => ({ kind: 'request' as const, ...p })));

  return (
    <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={variant}>
          <PlusIcon /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-[26rem] flex-col p-0" align="start">
        <div className="relative border-b">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && picked.length) {
                e.preventDefault();
                addPicked();
              }
            }}
            placeholder="Search saved requests"
            className="h-9 w-full bg-transparent pr-2 pl-8 text-xs outline-none"
          />
        </div>
        <div className="max-h-80 overflow-auto p-1">
          <button type="button" onClick={() => add([{ kind: 'condition' }])} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent">
            <GitBranchIcon className="size-3.5 text-warning" /> Condition (branch on a response value)
          </button>
          <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">Saved requests · tick several to add them as a chain</div>
          {list.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">No saved requests match.</p>}
          {list.map((r) => {
            const order = picked.findIndex((p) => p.requestId === r.id);
            return (
              <button
                key={r.id}
                type="button"
                role="checkbox"
                aria-checked={order >= 0}
                onClick={() => toggle(r)}
                onDoubleClick={() => addWith(r)}
                className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent', order >= 0 && 'bg-primary/10')}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold',
                    order >= 0 ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                  )}
                >
                  {order >= 0 ? order + 1 : ''}
                </span>
                <span className={cn('w-10 shrink-0 font-mono text-[10px] font-bold', `method-${r.method}`)}>{r.method}</span>
                <span className="truncate">{r.name}</span>
                <span className="ml-auto truncate pl-2 text-[11px] text-muted-foreground">{r.path}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 border-t p-2">
          {picked.length > 0 ? (
            <>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{picked.map((p) => p.name).join(' → ')}</span>
              <Button size="icon-xs" variant="ghost" aria-label="Clear selection" onClick={() => setPicked([])}>
                <XIcon />
              </Button>
              <Button size="xs" onClick={addPicked}>
                Add {picked.length} step{picked.length > 1 ? 's' : ''}
              </Button>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">Click to tick requests, or double-click to add one now.</span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
