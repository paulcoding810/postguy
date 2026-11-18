import * as React from 'react';
import { cn } from '@/lib/utils';
import { inputClass } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/misc';
import { useHoverPopup } from './useHoverPopup';
import { VariableRow } from './VariableEditor';
import { parseTokens } from './tokens';
import { useInsertTarget, useTemplateCtx, type Suggestion } from './TemplateContext';

export interface TemplateInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  fieldLabel: string;
  onEnter?: (e: React.KeyboardEvent) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  borderless?: boolean;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
}

function triggerAt(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const m = /\{\{([^{}]*)$/.exec(before);
  return m ? { start: caret - m[0].length, query: m[1]!.trim() } : null;
}

export function TemplateInput({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  fieldLabel,
  onEnter,
  autoFocus,
  disabled,
  borderless,
  onPaste,
}: TemplateInputProps) {
  const ctx = useTemplateCtx();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const idRef = React.useRef(Math.random().toString(36).slice(2));
  const [menu, setMenu] = React.useState<{ start: number; items: Suggestion[]; index: number } | null>(null);
  const setLast = useInsertTarget((s) => s.setLast);
  const valueRef = React.useRef(value);
  valueRef.current = value;

  const tokens = React.useMemo(() => parseTokens(value), [value]);
  const refs = tokens.filter((t) => t.kind === 'ref');

  const updateMenu = (v: string, caret: number) => {
    const trig = triggerAt(v, caret);
    if (!trig) return setMenu(null);
    const items = ctx.suggestions(trig.query).slice(0, 50);
    setMenu(items.length ? { start: trig.start, items, index: 0 } : null);
  };

  const insertText = React.useCallback(
    (text: string) => {
      const el = inputRef.current;
      const v = valueRef.current;
      // Insert after any selected text instead of replacing it.
      const at = el?.selectionEnd ?? v.length;
      onChange(v.slice(0, at) + text + v.slice(at));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(at + text.length, at + text.length);
      });
    },
    [onChange],
  );

  const register = () => setLast({ id: idRef.current, label: fieldLabel, insert: insertText });

  React.useEffect(() => {
    const cur = useInsertTarget.getState().last;
    if (cur?.id === idRef.current) setLast({ id: idRef.current, label: fieldLabel, insert: insertText });
  }, [fieldLabel, insertText, setLast]);

  const accept = (s: Suggestion) => {
    if (!menu) return;
    const el = inputRef.current!;
    const caret = el.selectionStart ?? value.length;
    let rest = value.slice(caret);
    if (rest.startsWith('}}')) rest = rest.slice(2);
    const insert = `{{${s.value}}}`;
    const next = value.slice(0, menu.start) + insert + rest;
    onChange(next);
    setMenu(null);
    const pos = menu.start + insert.length;
    requestAnimationFrame(() => el.setSelectionRange(pos, pos));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (menu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenu({ ...menu, index: (menu.index + 1) % menu.items.length });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenu({ ...menu, index: (menu.index - 1 + menu.items.length) % menu.items.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        accept(menu.items[menu.index]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }
    if (e.key === 'Enter' && onEnter) onEnter(e);
  };

  const names = [...new Set(refs.map((r) => r.ref))];
  const hover = useHoverPopup(names.length > 0);

  return (
    <div className={cn('relative min-w-0', className)}>
      <Popover open={hover.open} onOpenChange={(o) => !o && hover.close()}>
        <PopoverAnchor asChild>
          <div className="relative" {...hover.triggerProps}>
            <div
              ref={layerRef}
              aria-hidden
              className={cn(
                inputClass,
                'pointer-events-none absolute inset-0 overflow-hidden border-transparent bg-transparent whitespace-pre shadow-none dark:bg-transparent',
                borderless && 'rounded-none',
                inputClassName,
                'flex items-center',
              )}
            >
              <span className="shrink-0">
                {tokens.map((t, i) =>
                  t.kind === 'text' ? (
                    <span key={i}>{t.value}</span>
                  ) : (
                    <span key={i} className={cn('tpl-ref', `tpl-${ctx.status(t.ref)}`)}>
                      {t.raw}
                    </span>
                  ),
                )}
              </span>
            </div>
            <input
              ref={inputRef}
              value={value}
              disabled={disabled}
              autoFocus={autoFocus}
              spellCheck={false}
              autoComplete="off"
              placeholder={placeholder}
              aria-label={fieldLabel}
              onFocus={register}
              onChange={(e) => {
                onChange(e.target.value);
                updateMenu(e.target.value, e.target.selectionStart ?? e.target.value.length);
              }}
              onKeyDown={(e) => {
                hover.close();
                onKeyDown(e);
              }}
              onPaste={onPaste}
              onBlur={() => setTimeout(() => setMenu(null), 150)}
              onScroll={(e) => {
                if (layerRef.current) layerRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }}
              onSelect={(e) => {
                if (layerRef.current) layerRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }}
              className={cn(
                inputClass,
                'relative bg-transparent text-transparent caret-foreground selection:bg-primary/25 selection:text-transparent dark:bg-transparent',
                borderless && 'rounded-none border-transparent shadow-none focus-visible:ring-0',
                inputClassName,
              )}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="bottom"
          className="flex w-[min(26rem,90vw)] flex-col gap-2.5 p-2.5"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          {...hover.contentProps}
        >
          {names.map((n) => (
            <VariableRow key={n} name={n} preview={ctx.preview(n)} />
          ))}
        </PopoverContent>
      </Popover>
      {menu && (
        <div className="absolute top-full left-0 z-50 mt-1 max-h-64 w-[min(28rem,100%)] min-w-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {menu.items.map((s, i) => (
            <button
              key={`${s.kind}:${s.value}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                accept(s);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs',
                i === menu.index && 'bg-accent',
              )}
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  s.kind === 'variable' ? 'bg-info' : 'bg-success',
                )}
              />
              <span className="truncate font-mono">{s.label}</span>
              <span className="ml-auto max-w-[45%] truncate text-muted-foreground">{s.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
