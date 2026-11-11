import { ChevronRightIcon } from 'lucide-react';
import * as React from 'react';
import type { JsonSchema } from '@postguy/shared';
import { cn } from '@/lib/utils';

type S = Record<string, any>;

function typeLabel(s: S): string {
  if (!s || typeof s !== 'object') return 'any';
  if (s.anyOf) return s.anyOf.map(typeLabel).join(' | ');
  if (s.oneOf) return `oneOf(${s.oneOf.map(typeLabel).join(', ')})`;
  if (s.allOf) return 'allOf';
  const t = Array.isArray(s.type) ? s.type.join(' | ') : (s.type ?? (s.properties ? 'object' : s.items ? 'array' : 'any'));
  if (t === 'array' && s.items) return `${typeLabel(s.items)}[]`;
  return s.format ? `${t} · ${s.format}` : t;
}

function children(s: S): [string, S, boolean][] {
  if (!s || typeof s !== 'object') return [];
  if (s.allOf) return s.allOf.flatMap((x: S) => children(x));
  if (s.oneOf || s.anyOf) return (s.oneOf ?? s.anyOf).map((x: S, i: number) => [`option ${i + 1}`, x, false] as [string, S, boolean]);
  const props = (s.properties ?? {}) as Record<string, S>;
  const req = new Set<string>(s.required ?? []);
  const own: [string, S, boolean][] = Object.entries(props).map(([k, v]) => [k, v, req.has(k)]);
  if (own.length) return own;
  const arr = Array.isArray(s.type) ? s.type.includes('array') : s.type === 'array';
  if (arr && s.items) return children(s.items).map(([k, v, r]) => [`[].${k}`, v, r]);
  return [];
}

function Node({ name, schema, required, depth }: { name: string; schema: S; required: boolean; depth: number }) {
  const kids = children(schema);
  const [open, setOpen] = React.useState(depth < 2);
  return (
    <div>
      <button
        type="button"
        onClick={() => kids.length && setOpen(!open)}
        style={{ paddingLeft: depth * 14 + 4 }}
        className={cn('flex w-full items-center gap-1.5 py-0.5 text-left font-mono text-[12px]', kids.length && 'hover:bg-accent/50')}
      >
        <ChevronRightIcon className={cn('size-3 shrink-0 text-muted-foreground', !kids.length && 'invisible', open && 'rotate-90')} />
        <span className="text-foreground">{name}</span>
        {required && <span className="text-destructive">*</span>}
        <span className="text-info">{typeLabel(schema)}</span>
        {Array.isArray(schema.enum) && <span className="truncate text-muted-foreground">enum: {schema.enum.map(String).join(', ')}</span>}
        {schema.description && <span className="truncate font-sans text-muted-foreground">— {schema.description}</span>}
      </button>
      {open && kids.map(([k, v, r]) => <Node key={k} name={k} schema={v} required={r} depth={depth + 1} />)}
    </div>
  );
}

export function SchemaView({ schema, rootName = 'root' }: { schema: JsonSchema | undefined | null; rootName?: string }) {
  if (!schema || !Object.keys(schema).length) return <p className="text-xs text-muted-foreground">No schema.</p>;
  return <Node name={rootName} schema={schema as S} required={false} depth={0} />;
}
