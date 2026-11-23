import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import GraphqlWorker from 'monaco-graphql/esm/graphql.worker.js?worker';
import { initializeMode } from 'monaco-graphql/esm/initialize.js';
import { openExternal } from './openExternal';

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    if (label === 'graphql') return new GraphqlWorker();
    return new EditorWorker();
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

monaco.typescript.javascriptDefaults.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ES2020,
  lib: ['es2020'],
  allowNonTsExtensions: true,
  checkJs: true,
  noLib: false,
});
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: [1108, 2304] });
monaco.typescript.javascriptDefaults.setEagerModelSync(true);

monaco.editor.registerLinkOpener({
  open(uri) {
    if (!['http', 'https', 'mailto'].includes(uri.scheme)) return false;
    void openExternal(uri.toString(true));
    return true;
  },
});

/** GraphQL completion, hover and validation; each query editor gets its schema with `setGraphqlSchema`. */
const graphqlApi = initializeMode();
const graphqlSchemas = new Map<string, unknown>();

/** Gives the query editor at `uri` a schema (an introspection result), or takes it away. */
export function setGraphqlSchema(uri: string, introspection: unknown | null) {
  if (introspection) graphqlSchemas.set(uri, introspection);
  else graphqlSchemas.delete(uri);
  graphqlApi.setSchemaConfig(
    [...graphqlSchemas].map(([fileUri, schema]) => ({ uri: `${fileUri}#schema`, fileMatch: [fileUri], introspectionJSON: schema as never })),
  );
}

loader.config({ monaco });

export { monaco };
