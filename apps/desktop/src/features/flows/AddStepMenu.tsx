import { GitBranchIcon, PlusIcon, SearchIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/misc';
import { useTree } from '@/hooks/queries';
import { cn } from '@/lib/utils';
import { allRequests } from '@/features/collections/treeUtils';

export type AddChoice = { kind: 'request'; requestId: string; name: string } | { kind: 'condition' };

export function AddStepMenu({ onAdd, label = 'Add step', variant = 'outline' }: { onAdd: (c: AddChoice) => void; label?: string; variant?: 'outline' | 'default' }) {
  const tree = useTree();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const list = allRequests(tree.data).filter((r) => !q || `${r.name} ${r.path} ${r.url}`.toLowerCase().includes(q.toLowerCase()));
  const choose = (c: AddChoice) => {
    setOpen(false);
    setQ('');
    onAdd(c);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={variant}>
          <PlusIcon /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <div className="relative border-b">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search saved requests" className="h-9 w-full bg-transparent pr-2 pl-8 text-xs outline-none" />
        </div>
        <div className="max-h-80 overflow-auto p-1">
          <button type="button" onClick={() => choose({ kind: 'condition' })} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent">
            <GitBranchIcon className="size-3.5 text-warning" /> Condition (branch on a response value)
          </button>
          <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">Saved requests</div>
          {list.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">No saved requests match.</p>}
          {list.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => choose({ kind: 'request', requestId: r.id, name: r.name })}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className={cn('w-10 shrink-0 font-mono text-[10px] font-bold', `method-${r.method}`)}>{r.method}</span>
              <span className="truncate">{r.name}</span>
              <span className="ml-auto truncate pl-2 text-[11px] text-muted-foreground">{r.path}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
