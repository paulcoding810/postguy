import type { ResolvedPreview } from '@postguy/shared';

type PreviewRef = ResolvedPreview['refs'][number];

const SCOPE_LABEL: Record<string, string> = {
  runtime: 'flow runtime',
  request: 'request',
  flow: 'flow',
  collection: 'collection',
  environment: 'environment',
  global: 'globals',
  dynamic: 'built-in',
};

export function scopeLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  if (source.startsWith('response:')) return `response of ${source.slice(9)}`;
  return SCOPE_LABEL[source] ?? source;
}

/** Explains which lower-precedence values a variable hides, e.g. an environment's baseUrl hidden by the collection's. */
export function shadowNotes(p: PreviewRef | undefined): string[] {
  if (!p?.resolved || !p.shadowed?.length) return [];
  return p.shadowed.filter((s) => s.preview !== p.preview).map((s) => `Hides the ${scopeLabel(s.source)} value ${s.preview}`);
}
