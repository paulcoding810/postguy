import { getAtPath, parsePath, PathSyntaxError, type PathSegment } from '../path.ts';
import { queryJsonPath, isJsonPathQuery } from '../jsonpath/query.ts';
import { dynamicVariable } from './dynamic.ts';
import { parseTemplate, soleRef } from './parse.ts';
import type { ResolutionContext, VarEntry, VarSource } from './context.ts';

const MAX_DEPTH = 6;

export interface RefResolution {
  ref: string;
  found: boolean;
  value: unknown;
  source: VarSource | 'response' | 'dynamic' | null;
  secret: boolean;
  responseName?: string;
  error?: string;
  shadowed?: VarEntry['shadowed'];
  ownerId?: string;
}

export interface ResolveResult<T> {
  value: T;
  unresolved: string[];
  secrets: string[];
  refs: RefResolution[];
}

class Collector {
  unresolved = new Set<string>();
  secrets = new Set<string>();
  refs: RefResolution[] = [];

  add(r: RefResolution) {
    this.refs.push(r);
    if (!r.found) this.unresolved.add(r.ref);
    if (r.secret && r.found) {
      const s = stringify(r.value);
      if (s) this.secrets.add(s);
    }
  }

  result<T>(value: T): ResolveResult<T> {
    return { value, unresolved: [...this.unresolved], secrets: [...this.secrets], refs: this.refs };
  }
}

export function stringify(value: unknown): string {
  if (value === undefined || value === null) return value === null ? 'null' : '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

interface ParsedRef {
  kind: 'response' | 'ambiguous';
  name: string;
  section?: string;
  path: PathSegment[];
  rawPath: string;
}

function toSegments(raw: string): PathSegment[] {
  return raw && !isJsonPathQuery(raw) ? parsePath(raw) : [];
}

function splitHead(ref: string): { head: string; rest: string } {
  if (ref.startsWith('[')) {
    const segs = parsePath(ref);
    const head = String(segs[0] ?? '');
    const closing = ref.indexOf(']');
    return { head, rest: ref.slice(closing + 1).replace(/^\./, '') };
  }
  const m = /^[^.[]+/.exec(ref);
  const head = m ? m[0] : ref;
  return { head, rest: ref.slice(head.length).replace(/^\./, '') };
}

function parseRef(ref: string): ParsedRef {
  if (ref.startsWith('$res.') || ref.startsWith('$res[')) {
    const { head, rest } = splitHead(ref.slice(4).replace(/^\./, ''));
    const sec = rest ? splitHead(rest) : { head: '', rest: '' };
    return { kind: 'response', name: head, section: sec.head, path: toSegments(sec.rest), rawPath: sec.rest };
  }
  const { head, rest } = splitHead(ref);
  return { kind: 'ambiguous', name: head, path: toSegments(rest), rawPath: rest };
}

/** Resolves a single reference (without braces) to a typed value. */
export function resolveRef(ref: string, ctx: ResolutionContext, depth = 0): RefResolution {
  const notFound = (error?: string): RefResolution => ({
    ref,
    found: false,
    value: undefined,
    source: null,
    secret: false,
    error,
  });

  const direct = ctx.variables.get(ref);
  if (direct) {
    const inner = resolveTemplateDeep(direct.value, ctx, depth + 1);
    return {
      ref,
      found: inner.unresolved.length === 0,
      value: inner.value,
      source: direct.source,
      secret: direct.secret || inner.secrets.length > 0,
      error: inner.unresolved.length ? `Nested unresolved: ${inner.unresolved.join(', ')}` : undefined,
      ...(direct.shadowed && { shadowed: direct.shadowed }),
      ...(direct.ownerId && { ownerId: direct.ownerId }),
    };
  }

  const generated = dynamicVariable(ref);
  if (generated !== undefined) return { ref, found: true, value: generated, source: 'dynamic', secret: false };

  let parsed: ParsedRef;
  try {
    parsed = parseRef(ref);
  } catch (e) {
    return notFound(e instanceof PathSyntaxError ? e.message : String(e));
  }

  const response = parsed.name ? ctx.response(parsed.name) : undefined;
  if (response) {
    const { path, rawPath } = parsed;
    if (parsed.kind === 'response') {
      const section = parsed.section;
      if (section === 'status') return finish(response.status, []);
      if (section === 'headers') {
        const headerName = rawPath ? rawPath.replace(/^\[["']?|["']?\]$/g, '').toLowerCase() : undefined;
        if (!headerName) return finish(response.headers, []);
        const entry = Object.entries(response.headers).find(([k]) => k.toLowerCase() === headerName);
        return entry ? finish(entry[1], []) : notFound(`Header "${headerName}" not in response "${parsed.name}"`);
      }
      if (section !== 'body') return notFound(`Expected status, headers or body after $res.${parsed.name}`);
    }
    const target = response.body;
    if (isJsonPathQuery(rawPath)) {
      const values = queryJsonPath(target, rawPath);
      return values.length
        ? { ref, found: true, value: values.length === 1 ? values[0] : values, source: 'response', secret: false, responseName: parsed.name }
        : notFound(`No match for "${rawPath}" in response "${parsed.name}"`);
    }
    return finish(target, path);

    function finish(root: unknown, segs: PathSegment[]): RefResolution {
      const r = getAtPath(root, segs);
      if (!r.found) return notFound(`Path "${rawPath}" not found in response "${parsed.name}"`);
      return { ref, found: true, value: r.value, source: 'response', secret: false, responseName: parsed.name };
    }
  }

  if (parsed.kind === 'ambiguous' && parsed.path.length > 0) {
    const base = ctx.variables.get(parsed.name);
    if (base) {
      const inner = resolveTemplateDeep(base.value, ctx, depth + 1);
      let json: unknown = inner.value;
      if (typeof json === 'string') {
        try {
          json = JSON.parse(json);
        } catch {
          return notFound(`Variable "${parsed.name}" is not JSON, cannot read "${parsed.rawPath}"`);
        }
      }
      const r = getAtPath(json, parsed.path);
      if (r.found) return { ref, found: true, value: r.value, source: base.source, secret: base.secret };
      return notFound(`Path "${parsed.rawPath}" not found in variable "${parsed.name}"`);
    }
  }

  return notFound(
    parsed.kind === 'response' || parsed.path.length > 0
      ? `No response named "${parsed.name}"`
      : `Variable "${ref}" is not defined`,
  );
}

/** Interpolates string, or returns the typed value when the template is a single ref. */
function resolveTemplateDeep(template: string, ctx: ResolutionContext, depth: number): ResolveResult<unknown> {
  const c = new Collector();
  if (depth > MAX_DEPTH) {
    c.add({ ref: template, found: false, value: undefined, source: null, secret: false, error: 'Max nesting reached' });
    return c.result<unknown>(template);
  }
  const sole = soleRef(template);
  if (sole !== null) {
    const r = resolveRef(sole, ctx, depth);
    c.add(r);
    return c.result<unknown>(r.found ? r.value : template);
  }
  let out = '';
  for (const t of parseTemplate(template)) {
    if (t.kind === 'text') {
      out += t.value;
      continue;
    }
    const r = resolveRef(t.ref, ctx, depth);
    c.add(r);
    out += r.found ? stringify(r.value) : t.raw;
  }
  return c.result<unknown>(out);
}

export function resolveTemplate(template: string, ctx: ResolutionContext): ResolveResult<string> {
  const c = new Collector();
  let out = '';
  for (const t of parseTemplate(template)) {
    if (t.kind === 'text') {
      out += t.value;
      continue;
    }
    const r = resolveRef(t.ref, ctx, 0);
    c.add(r);
    out += r.found ? stringify(r.value) : t.raw;
  }
  return c.result(out);
}

export function resolveValue(template: string, ctx: ResolutionContext): ResolveResult<unknown> {
  return resolveTemplateDeep(template, ctx, 0);
}

/** Resolves refs inside a parsed JSON tree; a string that is exactly one ref keeps the ref's type. */
export function resolveJsonTree(node: unknown, ctx: ResolutionContext): ResolveResult<unknown> {
  const c = new Collector();
  const merge = (r: ResolveResult<unknown>) => {
    r.refs.forEach((x) => c.add(x));
  };
  const walk = (n: unknown): unknown => {
    if (typeof n === 'string') {
      const r = resolveValue(n, ctx);
      merge(r);
      return r.value;
    }
    if (Array.isArray(n)) return n.map(walk);
    if (n && typeof n === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n)) {
        const kr = resolveTemplate(k, ctx);
        merge(kr);
        out[kr.value] = walk(v);
      }
      return out;
    }
    return n;
  };
  const value = walk(node);
  return c.result(value);
}
