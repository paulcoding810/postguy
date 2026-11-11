import * as React from 'react';
import type { Auth, RequestDefinition } from '@postguy/shared';
import { useContextVariables, useResolvePreview } from '@/hooks/queries';
import { refsIn } from './tokens';
import { TemplateContext, type Suggestion, type TemplateCtx } from './TemplateContext';
import { useResponseSuggestions } from './responseSuggestions';

function authStrings(auth: Auth): string[] {
  switch (auth.type) {
    case 'bearer':
      return [auth.token];
    case 'basic':
      return [auth.username, auth.password];
    case 'apikey':
      return [auth.key, auth.value];
    case 'oauth2':
      return [auth.tokenUrl, auth.clientId, auth.clientSecret, auth.accessToken ?? ''];
    default:
      return [];
  }
}

export function collectRefs(def: RequestDefinition): string[] {
  const strings = [
    def.url,
    ...def.params.flatMap((p) => [p.key, p.value]),
    ...def.pathParams.map((p) => p.value),
    ...def.headers.flatMap((p) => [p.key, p.value]),
    ...authStrings(def.auth),
    def.body.raw ?? '',
    ...(def.body.form ?? []).flatMap((p) => [p.key, p.value]),
  ];
  return [...new Set(strings.flatMap(refsIn))];
}

export function TemplateProvider({
  draft,
  collectionId,
  requestId,
  extraRefs = [],
  children,
}: {
  draft: RequestDefinition;
  collectionId: string | null;
  requestId: string | null;
  extraRefs?: string[];
  children: React.ReactNode;
}) {
  const refs = React.useMemo(() => [...new Set([...collectRefs(draft), ...extraRefs])], [draft, extraRefs]);
  const templates = React.useMemo(() => refs.map((r) => `{{${r}}}`), [refs]);
  const preview = useResolvePreview(templates, collectionId, requestId);
  const vars = useContextVariables(collectionId, requestId);
  const responseSuggestions = useResponseSuggestions(collectionId);

  const value = React.useMemo<TemplateCtx>(() => {
    const map = preview.data;
    const variables = vars.data ?? [];
    return {
      variables,
      preview: (ref) => map?.get(`{{${ref}}}`)?.refs[0],
      status: (ref) => {
        const p = map?.get(`{{${ref}}}`);
        if (!p) return 'pending';
        return p.unresolved.length ? 'bad' : 'ok';
      },
      suggestions: (query) => {
        const q = query.toLowerCase();
        const fromVars: Suggestion[] = variables
          .filter((v) => v.key.toLowerCase().includes(q))
          .map((v) => ({ value: v.key, label: v.key, detail: `${v.source} · ${v.preview}`, kind: 'variable' }));
        const fromResponses = responseSuggestions(q);
        return [...fromVars, ...fromResponses];
      },
    };
  }, [preview.data, vars.data, responseSuggestions]);

  return <TemplateContext.Provider value={value}>{children}</TemplateContext.Provider>;
}
