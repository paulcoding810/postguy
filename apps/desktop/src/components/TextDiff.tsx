import { DiffEditor } from '@monaco-editor/react';
import * as React from 'react';
import { useResolvedTheme } from '@/hooks/useTheme';

/** A read-only side-by-side diff of two texts. */
export function TextDiff({ original, modified, language = 'plaintext' }: { original: string; modified: string; language?: string }) {
  const theme = useResolvedTheme();
  const models = React.useRef<{ original: { dispose(): void }; modified: { dispose(): void } } | null>(null);
  // The diff editor must drop its models before they are disposed, or Monaco throws on close.
  React.useEffect(
    () => () => {
      const m = models.current;
      if (m) setTimeout(() => (m.original.dispose(), m.modified.dispose()), 0);
    },
    [],
  );
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={language}
      theme={theme === 'dark' ? 'postguy-dark' : 'postguy-light'}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(editor) => {
        models.current = editor.getModel();
      }}
      loading={<div className="p-3 text-xs text-muted-foreground">Loading editor…</div>}
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        minimap: { enabled: false },
        fontSize: 12.5,
        fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: 'on',
      }}
    />
  );
}
