export type PathSegment = string | number | '*';

const IDENT = /^[^.[\]\s"']+/;

export class PathSyntaxError extends Error {}

/** Parses `a.b[0]["c d"][*]` into segments; leading `$`/`$.` is ignored. */
export function parsePath(input: string): PathSegment[] {
  let s = input.trim();
  if (s === '$') return [];
  if (s.startsWith('$.')) s = s.slice(2);
  else if (s.startsWith('$[')) s = s.slice(1);
  const out: PathSegment[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '.') {
      i++;
      continue;
    }
    if (ch === '[') {
      const end = findBracketEnd(s, i);
      const inner = s.slice(i + 1, end).trim();
      if (inner === '*') out.push('*');
      else if (/^-?\d+$/.test(inner)) out.push(Number(inner));
      else if (/^(['"]).*\1$/.test(inner)) out.push(unquote(inner));
      else throw new PathSyntaxError(`Invalid bracket segment "[${inner}]" in "${input}"`);
      i = end + 1;
      continue;
    }
    const m = IDENT.exec(s.slice(i));
    if (!m) throw new PathSyntaxError(`Unexpected "${ch}" in "${input}"`);
    out.push(m[0] === '*' ? '*' : m[0]);
    i += m[0].length;
  }
  return out;
}

function findBracketEnd(s: string, start: number): number {
  let quote: string | null = null;
  for (let j = start + 1; j < s.length; j++) {
    const c = s[j];
    if (quote) {
      if (c === '\\') j++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ']') return j;
  }
  throw new PathSyntaxError(`Unclosed "[" in "${s}"`);
}

function unquote(s: string): string {
  return s.slice(1, -1).replace(/\\(.)/g, '$1');
}

const SAFE_KEY = /^[A-Za-z_$][\w$-]*$/;

export function formatPath(segments: PathSegment[]): string {
  let out = '';
  for (const seg of segments) {
    if (seg === '*') out += '[*]';
    else if (typeof seg === 'number') out += `[${seg}]`;
    else if (SAFE_KEY.test(seg)) out += out ? `.${seg}` : seg;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

export interface PathLookup {
  found: boolean;
  value: unknown;
}

/** Concrete lookup; a `*` segment maps over arrays/objects and returns a list. */
export function getAtPath(root: unknown, segments: PathSegment[]): PathLookup {
  let current: unknown = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg === '*') {
      const rest = segments.slice(i + 1);
      const items = Array.isArray(current)
        ? current
        : current && typeof current === 'object'
          ? Object.values(current)
          : null;
      if (!items) return { found: false, value: undefined };
      const values = items.map((it) => getAtPath(it, rest)).filter((r) => r.found).map((r) => r.value);
      return { found: true, value: values };
    }
    if (current === null || typeof current !== 'object') return { found: false, value: undefined };
    if (Array.isArray(current)) {
      const idx = typeof seg === 'number' ? seg : /^\d+$/.test(seg) ? Number(seg) : NaN;
      const real = idx < 0 ? current.length + idx : idx;
      if (!Number.isInteger(real) || real < 0 || real >= current.length) return { found: false, value: undefined };
      current = current[real];
    } else {
      const key = String(seg);
      if (!Object.prototype.hasOwnProperty.call(current, key)) return { found: false, value: undefined };
      current = (current as Record<string, unknown>)[key];
    }
  }
  return { found: true, value: current };
}
