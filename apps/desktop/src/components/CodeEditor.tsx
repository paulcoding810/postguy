import Editor, { type OnMount } from '@monaco-editor/react';
import * as React from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/misc';
import { useResolvedTheme } from '@/hooks/useTheme';
import { monaco, skipNextLinkOpen } from '@/lib/monaco';
import { modKey } from '@/lib/utils';
import { clearInsertTarget, useInsertTarget, useTemplateCtx } from '@/features/template/TemplateContext';
import { VariableRow } from '@/features/template/VariableEditor';
import { refRangeAt } from '@/features/template/tokens';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  templates?: boolean;
  fieldLabel?: string;
  wordWrap?: boolean;
  path?: string;
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
}

const REF = /\{\{\s*([^{}]+?)\s*\}\}/g;
const OPEN_MS = 400;
const CLOSE_MS = 250;

/** The variable popup: which `{{name}}` it is for, where its token sits on screen, and whether its value takes focus. */
interface VariablePopup {
  name: string;
  anchor: { left: number; top: number; height: number };
  focus: boolean;
}

export function CodeEditor({
  value,
  onChange,
  language = 'json',
  readOnly,
  templates,
  fieldLabel = 'Body',
  wordWrap,
  path,
  onMount,
}: CodeEditorProps) {
  const theme = useResolvedTheme();
  const ctx = useTemplateCtx();
  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = React.useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const idRef = React.useRef(Math.random().toString(36).slice(2));
  const setLast = useInsertTarget((s) => s.setLast);
  const [popup, setPopupState] = React.useState<VariablePopup | null>(null);
  const popupRef = React.useRef<VariablePopup | null>(null);
  const popupContent = React.useRef<HTMLDivElement>(null);
  /** The editor reports leaving after the popup reports entering, so the pointer's place is tracked here. */
  const overPopup = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const setPopup = (p: VariablePopup | null) => {
    popupRef.current = p;
    setPopupState(p);
  };
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  /** Closes the popup; after Esc or a save it hands the keyboard back to the editor. */
  const closePopup = (refocus = false) => {
    clearTimer();
    if (!popupRef.current) return;
    overPopup.current = false;
    setPopup(null);
    if (refocus) requestAnimationFrame(() => editorRef.current?.focus());
  };
  /** Closes after a moment, unless the pointer comes back or the popup holds the keyboard. */
  const scheduleClose = () => {
    clearTimer();
    if (!popupRef.current) return;
    timer.current = setTimeout(() => {
      if (!overPopup.current && !popupContent.current?.contains(document.activeElement)) closePopup();
    }, CLOSE_MS);
  };
  React.useEffect(() => clearTimer, []);

  const decorate = React.useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !templates) return;
    const text = model.getValue();
    const items: monaco.editor.IModelDeltaDecoration[] = [];
    for (const m of text.matchAll(REF)) {
      const start = model.getPositionAt(m.index);
      const end = model.getPositionAt(m.index + m[0].length);
      items.push({
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: { inlineClassName: ctx.status(m[1]!) === 'bad' ? 'monaco-tpl-bad' : 'monaco-tpl-ok' },
      });
    }
    decorations.current ??= editor.createDecorationsCollection();
    decorations.current.set(items);
  }, [ctx, templates]);

  React.useEffect(decorate, [decorate, value]);
  React.useEffect(() => () => clearInsertTarget(idRef.current), []);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    decorate();
    if (templates) {
      /** The `{{ref}}` under the pointer (its character, not the nearest caret position) and where it starts. */
      const refUnder = (e: monaco.editor.IEditorMouseEvent) => {
        const pos = e.target.position;
        const model = editor.getModel();
        if (!pos || !model || e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return null;
        return refRangeAt(model.getValue(), model.getOffsetAt({ lineNumber: pos.lineNumber, column: e.target.mouseColumn || pos.column }));
      };
      const anchorAt = (start: number) => {
        const model = editor.getModel()!;
        const v = editor.getScrolledVisiblePosition(model.getPositionAt(start));
        const r = editor.getDomNode()!.getBoundingClientRect();
        return { left: r.left + (v?.left ?? 0), top: r.top + (v?.top ?? 0), height: v?.height ?? 18 };
      };
      editor.onMouseMove((e) => {
        const hit = refUnder(e);
        if (!hit) return scheduleClose();
        if (popupRef.current?.name === hit.name) return clearTimer();
        clearTimer();
        timer.current = setTimeout(() => setPopup({ name: hit.name, anchor: anchorAt(hit.start), focus: false }), OPEN_MS);
      });
      editor.onMouseLeave(() => scheduleClose());
      editor.onMouseDown((e) => {
        if (!(e.event.metaKey || e.event.ctrlKey)) return;
        const hit = refUnder(e);
        if (!hit) return;
        e.event.preventDefault();
        skipNextLinkOpen();
        clearTimer();
        setPopup({ name: hit.name, anchor: anchorAt(hit.start), focus: true });
      });
      editor.onDidScrollChange(() => closePopup());
      editor.onKeyDown((e) => {
        if (![monaco.KeyCode.Meta, monaco.KeyCode.Ctrl, monaco.KeyCode.Shift, monaco.KeyCode.Alt].includes(e.keyCode)) closePopup();
      });
    }
    // Read-only editors (responses, history) are never insert targets.
    if (!readOnly)
      editor.onDidFocusEditorText(() =>
        setLast({
          id: idRef.current,
          label: fieldLabel,
          insert: (text) => {
            const sel = editor.getSelection();
            if (!sel) return;
            // Insert after any selected text instead of replacing it.
            const end = sel.getEndPosition();
            const model = editor.getModel();
            if (!model) return;
            const after = model.getOffsetAt(end) + text.length;
            editor.executeEdits('picker', [{ range: new monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column), text }]);
            // A caret after the reference, so the next keystroke doesn't replace it.
            editor.setPosition(model.getPositionAt(after));
            editor.focus();
          },
        }),
      );
    onMount?.(editor as unknown as monaco.editor.IStandaloneCodeEditor);
  };

  return (
    <>
      {popup && (
        <Popover open onOpenChange={(o) => !o && closePopup()}>
          <PopoverAnchor asChild>
            <span aria-hidden style={{ position: 'fixed', left: popup.anchor.left, top: popup.anchor.top, width: 1, height: popup.anchor.height, pointerEvents: 'none' }} />
          </PopoverAnchor>
          <PopoverContent
            side="bottom"
            className="flex w-[min(26rem,90vw)] flex-col gap-2.5 p-2.5"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onMouseEnter={() => {
              overPopup.current = true;
              clearTimer();
            }}
            onMouseLeave={() => {
              overPopup.current = false;
              scheduleClose();
            }}
            onPointerDownOutside={(e) => {
              // A ⌘-click on another variable in the editor opens that one instead of just closing.
              const ev = e.detail.originalEvent;
              if ((ev.metaKey || ev.ctrlKey) && editorRef.current?.getDomNode()?.contains(e.target as Node)) e.preventDefault();
            }}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              closePopup(true);
            }}
            ref={popupContent}
          >
            <VariableRow key={popup.name} name={popup.name} preview={ctx.preview(popup.name)} focus={popup.focus} onDone={() => closePopup(popup.focus)} />
            {!popup.focus && <p className="text-[10.5px] text-muted-foreground">{modKey}-click a variable in the editor to edit it straight away.</p>}
          </PopoverContent>
        </Popover>
      )}
      <Editor
        value={value}
        path={path}
        language={language}
        theme={theme === 'dark' ? 'postguy-dark' : 'postguy-light'}
        onChange={(v) => onChange?.(v ?? '')}
        onMount={handleMount}
        loading={<div className="p-3 text-xs text-muted-foreground">Loading editor…</div>}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 12.5,
          fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
          lineNumbersMinChars: 3,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: wordWrap ? 'on' : 'off',
          renderLineHighlight: readOnly ? 'none' : 'line',
          folding: true,
          stickyScroll: { enabled: false },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          padding: { top: 8 },
          domReadOnly: readOnly,
          fixedOverflowWidgets: true,
        }}
      />
    </>
  );
}
