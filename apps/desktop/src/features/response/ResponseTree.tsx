import { ChevronsDownUpIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/misc';
import { JsonTree } from '@/features/memory/JsonTree';
import { refFor } from '@/features/memory/refs';
import { useInsertTarget } from '@/features/template/TemplateContext';

/**
 * A collapsible view of a JSON response. For a saved request, rows copy or insert a
 * `{{Name.path}}` reference; otherwise they copy the plain path, since only saved requests are remembered.
 */
export function ResponseTree({ value, requestName }: { value: unknown; requestName: string | null }) {
  const [filter, setFilter] = React.useState('');
  const [depth, setDepth] = React.useState(3);
  const [generation, setGeneration] = React.useState(0);
  const target = useInsertTarget((s) => s.last);

  const expand = (d: number) => {
    setDepth(d);
    setGeneration((g) => g + 1);
  };
  const reference = (path: string) => (requestName ? `{{${refFor(requestName, path)}}}` : path);
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`, { description: text.length > 120 ? `${text.slice(0, 120)}…` : text }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter keys and values"
            aria-label="Filter response"
            className="h-6 w-full rounded bg-muted/60 pr-2 pl-6 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <Tooltip content="Expand all">
          <Button variant="ghost" size="icon-xs" aria-label="Expand all" onClick={() => expand(Infinity)}>
            <ChevronsUpDownIcon className="size-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="Collapse all">
          <Button variant="ghost" size="icon-xs" aria-label="Collapse all" onClick={() => expand(0)}>
            <ChevronsDownUpIcon className="size-3.5" />
          </Button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto select-text">
        <JsonTree
          key={generation}
          value={value}
          filter={filter}
          openDepth={depth}
          canInsert={!!requestName && !!target}
          onInsert={(path) => {
            if (!requestName || !target) return;
            target.insert(reference(path));
            toast.success(`Inserted into ${target.label}`);
          }}
          onCopy={(path) => copy(reference(path), requestName ? 'Reference' : 'Path')}
          copyLabel={(path) => (requestName ? `Copy ${reference(path)}` : `Copy path ${path} (save the request to reference it)`)}
          onCopyValue={(v) => copy(typeof v === 'string' ? v : JSON.stringify(v, null, 2), 'Value')}
        />
      </div>
    </div>
  );
}
