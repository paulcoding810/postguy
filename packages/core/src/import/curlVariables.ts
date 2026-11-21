import type { Auth, KeyValue, RequestDefinition } from '@postguy/shared';
import { SCOPE_PRECEDENCE, type VarSource } from '../template/context.ts';

export interface VariableValue {
  key: string;
  /** The resolved value. */
  value: string;
  source: VarSource;
}

const MIN_LENGTH = 4;
const TOO_COMMON = new Set(['true', 'false', 'null', 'none', 'undefined', 'json', 'text', 'application/json']);

/** Values worth swapping, each owned by the single variable from the narrowest scope; ties are left alone. */
function candidates(vars: VariableValue[]): Map<string, string> {
  const byValue = new Map<string, VariableValue[]>();
  for (const v of vars) {
    if (v.value.trim().length < MIN_LENGTH || v.value !== v.value.trim() || v.value.includes('{{') || TOO_COMMON.has(v.value.toLowerCase())) continue;
    byValue.set(v.value, [...(byValue.get(v.value) ?? []), v]);
  }
  const owners = new Map<string, string>();
  for (const [value, list] of byValue) {
    const rank = (v: VariableValue) => SCOPE_PRECEDENCE.indexOf(v.source);
    const best = Math.min(...list.map(rank));
    const winners = list.filter((v) => rank(v) === best);
    if (winners.length === 1) owners.set(value, winners[0]!.key);
  }
  return owners;
}

/**
 * Swaps values in an imported request for the variables that hold them: the start of the URL,
 * and whole header, query, form, auth and JSON string values.
 */
export function swapInVariables(request: RequestDefinition, vars: VariableValue[]): { request: RequestDefinition; used: string[] } {
  const owners = candidates(vars);
  const used = new Set<string>();
  const whole = (s: string): string => {
    const key = owners.get(s);
    if (!key) return s;
    used.add(key);
    return `{{${key}}}`;
  };
  const header = (s: string): string => {
    const m = /^(\w+ )(.+)$/.exec(s);
    const swapped = whole(s);
    if (swapped !== s || !m) return swapped;
    const rest = whole(m[2]!);
    return rest === m[2] ? s : m[1] + rest;
  };
  const pairs = (list: KeyValue[], fn = whole) => list.map((p) => ({ ...p, value: fn(p.value) }));

  let url = request.url;
  const prefix = [...owners.keys()].sort((a, b) => b.length - a.length).find((v) => url.startsWith(v) && (v.endsWith('/') || /^($|[/?#])/.test(url.slice(v.length))));
  if (prefix && /^[a-z][\w+.-]*:\/\/[^/]/i.test(prefix)) url = whole(prefix) + url.slice(prefix.length);

  const body = { ...request.body };
  if (body.form) body.form = pairs(body.form);
  if (body.mode === 'json' && body.raw) body.raw = swapJson(body.raw, whole);

  return {
    request: { ...request, url, params: pairs(request.params), headers: pairs(request.headers, header), auth: swapAuth(request.auth, whole), body },
    used: [...used].sort(),
  };
}

function swapAuth(auth: Auth, whole: (s: string) => string): Auth {
  switch (auth.type) {
    case 'bearer':
      return { ...auth, token: whole(auth.token) };
    case 'basic':
      return { ...auth, username: whole(auth.username), password: whole(auth.password) };
    case 'apikey':
      return { ...auth, value: whole(auth.value) };
    default:
      return auth;
  }
}

function swapJson(raw: string, whole: (s: string) => string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw;
  }
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const s = whole(v);
      if (s !== v) changed = true;
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(data);
  return changed ? JSON.stringify(out, null, 2) : raw;
}
