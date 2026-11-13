import type { KeyValue, OpenApiOperation, RequestDefinition } from '@postguy/shared';
import type { GeneratedRequest } from './generate.ts';

export interface SpecMerge {
  def: RequestDefinition;
  /** What the merge adds or changes, e.g. "query page", "header X-Tenant", "URL /v2/orders/:orderId". */
  added: string[];
}

const pathOf = (url: string) => url.replace(/^\{\{[^}]+\}\}|^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '').split('?')[0]!;

/**
 * Brings a request the user edited up to its operation without undoing their edits: adds required
 * query params and headers it lacks, and follows a moved path while keeping path parameter values.
 */
export function mergeOperation(
  def: RequestDefinition,
  op: OpenApiOperation,
  gen: GeneratedRequest,
  opts: { followPath: boolean },
): SpecMerge {
  const added: string[] = [];
  const next: RequestDefinition = { ...def, params: [...def.params], headers: [...def.headers] };
  const has = (list: KeyValue[], key: string) => list.some((k) => k.key.toLowerCase() === key.toLowerCase());

  for (const p of op.params.filter((x) => x.required && x.in === 'query')) {
    const kv = gen.def.params.find((k) => k.key === p.name);
    if (kv && !has(next.params, p.name)) {
      next.params.push({ ...kv, enabled: true });
      added.push(`query ${p.name}`);
    }
  }
  for (const p of op.params.filter((x) => x.required && x.in === 'header')) {
    const kv = gen.def.headers.find((k) => k.key.toLowerCase() === p.name.toLowerCase());
    if (kv && !has(next.headers, p.name)) {
      next.headers.push({ ...kv, enabled: true });
      added.push(`header ${p.name}`);
    }
  }
  if (opts.followPath && (pathOf(def.url) !== pathOf(gen.def.url) || def.method !== gen.def.method)) {
    const base = /^\{\{[^}]+\}\}|^[a-z][a-z\d+.-]*:\/\/[^/]+/i.exec(def.url)?.[0] ?? '{{baseUrl}}';
    next.url = `${base}${pathOf(gen.def.url)}`;
    next.method = gen.def.method;
    next.pathParams = gen.def.pathParams.map((p) => def.pathParams.find((u) => u.key === p.key) ?? p);
    added.push(`${def.method !== gen.def.method ? `${gen.def.method} ` : ''}URL ${pathOf(gen.def.url)}`);
  }
  return { def: next, added };
}
