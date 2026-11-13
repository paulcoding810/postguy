import Editor, { type OnMount } from '@monaco-editor/react';
import * as React from 'react';
import { useResolvedTheme } from '@/hooks/useTheme';
import { monaco } from '@/lib/monaco';
import { useInsertTarget, useTemplateCtx } from '@/features/template/TemplateContext';
import { scopeLabel, shadowNotes } from '@/features/template/scopeNote';

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

  const decorate = React.useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !templates) return;
    const text = model.getValue();
    const items: monaco.editor.IModelDeltaDecoration[] = [];
    for (const m of text.matchAll(REF)) {
      const start = model.getPositionAt(m.index);
      const end = model.getPositionAt(m.index + m[0].length);
      const status = ctx.status(m[1]!);
      const p = ctx.preview(m[1]!);
      items.push({
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: {
          inlineClassName: status === 'bad' ? 'monaco-tpl-bad' : 'monaco-tpl-ok',
          hoverMessage: {
            value: [`\`${m[1]}\` → ${p ? (p.preview ?? '') : '…'}${p?.resolved && scopeLabel(p.source) ? ` (${scopeLabel(p.source)})` : ''}`, ...shadowNotes(p).map((n) => `⚠ ${n}`)].join('\n\n'),
          },
        },
      });
    }
    decorations.current ??= editor.createDecorationsCollection();
    decorations.current.set(items);
  }, [ctx, templates]);

  React.useEffect(decorate, [decorate, value]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    decorate();
    editor.onDidFocusEditorText(() =>
      setLast({
        id: idRef.current,
        label: fieldLabel,
        insert: (text) => {
          const sel = editor.getSelection();
          if (!sel) return;
          editor.executeEdits('picker', [{ range: sel, text, forceMoveMarkers: true }]);
          editor.focus();
        },
      }),
    );
    onMount?.(editor as unknown as monaco.editor.IStandaloneCodeEditor);
  };

  return (
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
  );
}
