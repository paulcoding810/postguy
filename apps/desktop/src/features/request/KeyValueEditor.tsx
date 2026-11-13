import { Trash2Icon } from 'lucide-react';
import * as React from 'react';
import { newId, type KeyValue } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Checkbox, Tooltip } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { TemplateInput } from '@/features/template/TemplateInput';
import { FilePathField } from './FilePathField';

export interface KeyValueEditorProps {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  label: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  fixedKeys?: boolean;
  showDescription?: boolean;
  /** Form-data: each row can switch between a text value and a file. */
  files?: boolean;
}

export function KeyValueEditor({
  items,
  onChange,
  label,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  fixedKeys,
  showDescription,
  files,
}: KeyValueEditorProps) {
  const ghostId = React.useRef(newId(8));
  const rows = fixedKeys ? items : [...items, { id: ghostId.current, key: '', value: '', enabled: true }];

  const update = (id: string, patch: Partial<KeyValue>) => {
    const exists = items.some((i) => i.id === id);
    if (!exists) {
      ghostId.current = newId(8);
      onChange([...items, { id, key: '', value: '', enabled: true, ...patch }]);
      return;
    }
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const remove = (id: string) => onChange(items.filter((i) => i.id !== id));
  const allEnabled = items.length > 0 && items.every((i) => i.enabled);

  return (
    <div className="text-[13px]">
      <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1.5fr)_32px] border-b text-[11px] font-medium text-muted-foreground uppercase">
        <div className="flex items-center justify-center py-1.5">
          {!fixedKeys && items.length > 0 && (
            <Checkbox checked={allEnabled} onCheckedChange={(v) => onChange(items.map((i) => ({ ...i, enabled: !!v })))} />
          )}
        </div>
        <div className="px-2 py-1.5">{keyPlaceholder}</div>
        <div className="px-2 py-1.5">{valuePlaceholder}</div>
        <div />
      </div>
      {rows.map((row) => {
        const ghost = !items.some((i) => i.id === row.id);
        return (
          <div
            key={row.id}
            className={cn(
              'group grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1.5fr)_32px] border-b',
              !row.enabled && !ghost && 'opacity-50',
            )}
          >
            <div className="flex items-center justify-center">
              {!ghost && <Checkbox checked={row.enabled} onCheckedChange={(v) => update(row.id, { enabled: !!v })} />}
            </div>
            <div className="border-l">
              {fixedKeys ? (
                <Tooltip content={row.description}>
                  <div className="flex h-8 items-center px-2.5 font-mono text-xs">{row.key}</div>
                </Tooltip>
              ) : (
                <TemplateInput
                  borderless
                  value={row.key}
                  fieldLabel={`${label} key`}
                  placeholder={ghost ? `Add ${keyPlaceholder.toLowerCase()}` : ''}
                  onChange={(key) => update(row.id, { key })}
                />
              )}
            </div>
            <div className="flex min-w-0 items-center border-l">
              {files && (
                <select
                  aria-label={`${label} type`}
                  className="h-8 shrink-0 border-r bg-transparent px-1 text-[11px] text-muted-foreground outline-none"
                  value={row.type === 'file' ? 'file' : 'text'}
                  onChange={(e) => update(row.id, { type: e.target.value === 'file' ? 'file' : 'text' })}
                >
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
              )}
              {files && row.type === 'file' ? (
                <FilePathField borderless value={row.src ?? ''} label={`${label}: ${row.key || 'file'}`} onChange={(src) => update(row.id, { src })} />
              ) : (
                <TemplateInput
                  className="flex-1"
                  borderless
                  value={row.value}
                  fieldLabel={`${label}: ${row.key || 'value'}`}
                  placeholder={ghost ? '' : showDescription && row.description ? row.description : valuePlaceholder}
                  onChange={(value) => update(row.id, { value })}
                />
              )}
            </div>
            <div className="flex items-center justify-center">
              {!ghost && !fixedKeys && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => remove(row.id)}
                  aria-label="Remove row"
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
