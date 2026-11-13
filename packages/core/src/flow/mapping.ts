import type { Auth, MappingSuggestion, RequestDefinition } from '@postguy/shared';
import { extractPaths } from '../memory/paths.ts';
import { formatPath, parsePath } from '../path.ts';
import { extractPathParams } from '../http/request.ts';

export interface UpstreamSource {
  name: string;
  body: unknown;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const singular = (s: string) => norm(s).replace(/(ies)$/, 'y').replace(/(ses|xes)$/, (m) => m.slice(0, -2)).replace(/s$/, '');
const TOKEN_KEYS = ['accesstoken', 'token', 'idtoken', 'jwt', 'authtoken', 'bearertoken'];

/** Reference text for a path inside a step's response, e.g. `Login.data.user.id`. */
export function refFor(name: string, path: string): string {
  if (/[.[\]{}]/.test(name)) return `$res[${JSON.stringify(name)}].body${path ? (path.startsWith('[') ? path : `.${path}`) : ''}`;
  if (!path) return name;
  return path.startsWith('[') ? `${name}${path}` : `${name}.${path}`;
}

interface Candidate {
  source: string;
  path: string;
  segs: (string | number)[];
  leaf: string;
  parent: string;
  rank: number;
}

function candidates(sources: UpstreamSource[]): Candidate[] {
  const out: Candidate[] = [];
  sources.forEach((s, rank) => {
    for (const p of extractPaths(s.body, { maxEntries: 1500 })) {
      if (p.wildcard || !['string', 'integer', 'number'].includes(p.type)) continue;
      const segs = parsePath(p.path).filter((x) => x !== '*') as (string | number)[];
      const named = segs.filter((x): x is string => typeof x === 'string');
      const leaf = named.at(-1) ?? '';
      out.push({ source: s.name, path: formatPath(segs), segs, leaf: norm(leaf), parent: norm(named.at(-2) ?? ''), rank });
    }
  });
  return out;
}

function best(key: string, list: Candidate[], hint: string | null): Candidate | null {
  const k = key.toLowerCase().startsWith('x-') ? norm(key.slice(2)) : norm(key);
  let top: { c: Candidate; score: number } | null = null;
  for (const c of list) {
    let score = 0;
    if (c.parent + c.leaf === k) score = 8;
    else if (c.leaf === k) score = 5;
    else if (c.leaf.length >= 2 && k.endsWith(c.leaf)) {
      const prefix = k.slice(0, -c.leaf.length);
      if (prefix && (singular(c.parent) === prefix || norm(c.source).includes(prefix))) score = 6;
      else continue;
    } else continue;
    if (hint && (c.parent === hint || singular(c.parent) === hint)) score += 6;
    if (c.segs.some((s) => typeof s === 'number')) score -= 1;
    score -= c.segs.length * 0.1 + c.rank * 0.5;
    if (!top || score > top.score) top = { c, score };
  }
  return top && top.score >= 4 ? top.c : null;
}

function isLiteral(v: string) {
  return !/\{\{[^}]+\}\}/.test(v);
}

/**
 * Suggests references from upstream responses for a step's inputs: path variables
 * holding literals, empty query params and headers, and an empty or unresolved bearer token.
 * `sources` is ordered nearest upstream step first.
 */
export function suggestMappings(
  def: RequestDefinition,
  effectiveAuth: Auth,
  sources: UpstreamSource[],
  isUnresolved: (template: string) => boolean = () => false,
): MappingSuggestion[] {
  const list = candidates(sources);
  if (!list.length) return [];
  const out: MappingSuggestion[] = [];
  const pathNames = extractPathParams(def.url);
  for (const p of def.pathParams) {
    if (!isLiteral(p.value) && !isUnresolved(p.value)) continue;
    const segs = def.url.split(/[?#]/)[0]!.split('/');
    const at = segs.indexOf(`:${p.key}`);
    const hint = at > 0 ? singular(segs[at - 1]!) : null;
    const c = best(p.key, list, pathNames.includes(p.key) ? hint : null);
    if (c) out.push({ field: 'pathParam', key: p.key, ref: refFor(c.source, c.path), reason: `matches ${c.source} → ${c.path}` });
  }
  for (const p of def.params) {
    if (!p.key || (p.value && !isUnresolved(p.value))) continue;
    const c = best(p.key, list, null);
    if (c) out.push({ field: 'param', key: p.key, ref: refFor(c.source, c.path), reason: `matches ${c.source} → ${c.path}` });
  }
  for (const h of def.headers) {
    if (!h.key || (h.value && !isUnresolved(h.value))) continue;
    const c = best(h.key, list, null);
    if (c) out.push({ field: 'header', key: h.key, ref: refFor(c.source, c.path), reason: `matches ${c.source} → ${c.path}` });
  }
  if (effectiveAuth.type === 'bearer' && (!effectiveAuth.token.trim() || isUnresolved(effectiveAuth.token))) {
    const pick = tokenCandidate(list);
    if (pick) out.push({ field: 'auth', key: 'token', ref: refFor(pick.source, pick.path), reason: `bearer token from ${pick.source} → ${pick.path}` });
  }
  return out;
}

function tokenCandidate(list: Candidate[]): Candidate | null {
  for (const key of TOKEN_KEYS) {
    const pick = list.filter((c) => c.leaf === key).sort((a, b) => a.rank - b.rank || a.segs.length - b.segs.length)[0];
    if (pick) return pick;
  }
  return null;
}

/** The most likely access token among remembered responses, e.g. `Login.data.access_token`. */
export function suggestTokenRef(sources: UpstreamSource[]): { ref: string; source: string; path: string } | null {
  const pick = tokenCandidate(candidates(sources));
  return pick ? { ref: refFor(pick.source, pick.path), source: pick.source, path: pick.path } : null;
}
