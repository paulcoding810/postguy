import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    return label === 'json' ? new JsonWorker() : new EditorWorker();
  },
};

monaco.editor.defineTheme('postguy-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#1b1b1f', 'editorGutter.background': '#1b1b1f', 'editor.lineHighlightBackground': '#ffffff08' },
});
monaco.editor.defineTheme('postguy-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#00000006' },
});

loader.config({ monaco });

export { monaco };
