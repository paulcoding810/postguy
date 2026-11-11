export type Token = { kind: 'text'; value: string } | { kind: 'ref'; ref: string; raw: string };

const REF = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function parseTokens(input: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of input.matchAll(REF)) {
    if (m.index > last) out.push({ kind: 'text', value: input.slice(last, m.index) });
    out.push({ kind: 'ref', ref: m[1]!, raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < input.length) out.push({ kind: 'text', value: input.slice(last) });
  return out;
}

export function refsIn(input: string | undefined | null): string[] {
  if (!input) return [];
  return [...input.matchAll(REF)].map((m) => m[1]!);
}
