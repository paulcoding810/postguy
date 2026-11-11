import type { FlowStep, KeyValue, MappingSuggestion, SavedRequest, StepOverrides } from '@postguy/shared';
import { syncPathParams } from '@/lib/url';

function setValue(list: KeyValue[], key: string, value: string): KeyValue[] {
  return list.map((p) => (p.key === key ? { ...p, value, enabled: true } : p));
}

/** Writes mapping suggestions into a step's overrides as `{{references}}`. */
export function applySuggestions(step: FlowStep, req: SavedRequest, suggestions: MappingSuggestion[]): StepOverrides {
  const o: StepOverrides = { ...step.overrides };
  const url = o.url ?? req.url;
  for (const s of suggestions) {
    const ref = `{{${s.ref}}}`;
    if (s.field === 'pathParam') o.pathParams = setValue(o.pathParams ?? syncPathParams(url, req.pathParams), s.key, ref);
    else if (s.field === 'param') o.params = setValue(o.params ?? req.params, s.key, ref);
    else if (s.field === 'header') o.headers = setValue(o.headers ?? req.headers, s.key, ref);
    else if (s.field === 'auth') o.auth = { type: 'bearer', token: ref };
  }
  return o;
}

export function describeMappings(list: MappingSuggestion[]): string {
  return list.map((s) => `${s.key} ← ${s.ref}`).join(', ');
}

export function uniqueStepName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!lower.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}
