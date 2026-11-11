import type { ResolutionContext } from '../template/context.ts';
import { resolveRef } from '../template/resolve.ts';

/**
 * A small, side-effect-free condition language for flow branches:
 *   {{$res.Login.status}} == 200 && {{Login.data.user.role}} != "admin"
 * Operators: || && ! == != < <= > >= contains, parentheses, exists({{ref}}).
 * Literals: numbers, 'single' or "double" quoted strings, true, false, null.
 */
export class ExpressionError extends Error {}

type Tok =
  | { t: 'ref'; v: string }
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'lit'; v: boolean | null }
  | { t: 'op'; v: string }
  | { t: 'id'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (src.startsWith('{{', i)) {
      const end = src.indexOf('}}', i + 2);
      if (end === -1) throw new ExpressionError('Unclosed {{ reference');
      out.push({ t: 'ref', v: src.slice(i + 2, end).trim() });
      i = end + 2;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('<>!()'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) j++;
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new ExpressionError('Unclosed string');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_]\w*/.exec(src.slice(i));
    if (word) {
      const w = word[0];
      if (w === 'true' || w === 'false') out.push({ t: 'lit', v: w === 'true' });
      else if (w === 'null') out.push({ t: 'lit', v: null });
      else if (w === 'contains') out.push({ t: 'op', v: 'contains' });
      else out.push({ t: 'id', v: w });
      i += w.length;
      continue;
    }
    throw new ExpressionError(`Unexpected "${c}"`);
  }
  return out;
}

type Node =
  | { k: 'val'; v: unknown }
  | { k: 'ref'; ref: string }
  | { k: 'exists'; ref: string }
  | { k: 'not'; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node };

function parse(tokens: Tok[]): Node {
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const or = (): Node => {
    let l = and();
    while (isOp('||')) {
      p++;
      l = { k: 'bin', op: '||', l, r: and() };
    }
    return l;
  };
  const and = (): Node => {
    let l = not();
    while (isOp('&&')) {
      p++;
      l = { k: 'bin', op: '&&', l, r: not() };
    }
    return l;
  };
  const not = (): Node => {
    if (isOp('!')) {
      p++;
      return { k: 'not', e: not() };
    }
    return cmp();
  };
  const cmp = (): Node => {
    const l = primary();
    const t = peek();
    if (t?.t === 'op' && ['==', '!=', '<', '<=', '>', '>=', 'contains'].includes(t.v)) {
      p++;
      return { k: 'bin', op: t.v, l, r: primary() };
    }
    return l;
  };
  const primary = (): Node => {
    const t = tokens[p++];
    if (!t) throw new ExpressionError('Unexpected end of expression');
    if (t.t === 'num' || t.t === 'str' || t.t === 'lit') return { k: 'val', v: t.v };
    if (t.t === 'ref') return { k: 'ref', ref: t.v };
    if (t.t === 'op' && t.v === '(') {
      const e = or();
      if (!isOp(')')) throw new ExpressionError('Missing )');
      p++;
      return e;
    }
    if (t.t === 'id' && t.v === 'exists') {
      if (!isOp('(')) throw new ExpressionError('exists needs ( )');
      p++;
      const r = tokens[p++];
      if (r?.t !== 'ref') throw new ExpressionError('exists expects a {{reference}}');
      if (!isOp(')')) throw new ExpressionError('Missing )');
      p++;
      return { k: 'exists', ref: r.v };
    }
    throw new ExpressionError(`Unexpected "${String(t.v)}"`);
  };
  if (!tokens.length) throw new ExpressionError('Expression is empty');
  const node = or();
  if (p < tokens.length) throw new ExpressionError(`Unexpected "${String(tokens[p]!.v)}"`);
  return node;
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && !isNaN(Number(b))) return a === Number(b);
  if (typeof b === 'number' && typeof a === 'string' && a.trim() !== '' && !isNaN(Number(a))) return b === Number(a);
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function compare(a: unknown, b: unknown): number | null {
  const na = typeof a === 'string' && a.trim() !== '' ? Number(a) : a;
  const nb = typeof b === 'string' && b.trim() !== '' ? Number(b) : b;
  if (typeof na === 'number' && typeof nb === 'number' && !isNaN(na) && !isNaN(nb)) return na - nb;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return null;
}

export interface ExpressionResult {
  value: boolean;
  unresolved: string[];
}

export function evaluateExpression(src: string, ctx: ResolutionContext): ExpressionResult {
  const unresolved: string[] = [];
  const evalNode = (n: Node): unknown => {
    switch (n.k) {
      case 'val':
        return n.v;
      case 'ref': {
        const r = resolveRef(n.ref, ctx);
        if (!r.found) unresolved.push(n.ref);
        return r.found ? r.value : undefined;
      }
      case 'exists': {
        const r = resolveRef(n.ref, ctx);
        return r.found && r.value !== null && r.value !== undefined;
      }
      case 'not':
        return !evalNode(n.e);
      case 'bin': {
        if (n.op === '&&') return !!evalNode(n.l) && !!evalNode(n.r);
        if (n.op === '||') return !!evalNode(n.l) || !!evalNode(n.r);
        const l = evalNode(n.l);
        const r = evalNode(n.r);
        switch (n.op) {
          case '==':
            return looseEqual(l, r);
          case '!=':
            return !looseEqual(l, r);
          case 'contains':
            if (Array.isArray(l)) return l.some((x) => looseEqual(x, r));
            return typeof l === 'string' && typeof r !== 'object' && l.includes(String(r));
          default: {
            const c = compare(l, r);
            if (c === null) return false;
            return n.op === '<' ? c < 0 : n.op === '<=' ? c <= 0 : n.op === '>' ? c > 0 : c >= 0;
          }
        }
      }
    }
  };
  const value = !!evalNode(parse(tokenize(src)));
  return { value, unresolved };
}

/** Throws ExpressionError when the expression cannot be parsed. */
export function checkExpression(src: string): void {
  parse(tokenize(src));
}
