export type TemplateToken =
  | { kind: 'text'; value: string }
  | { kind: 'ref'; ref: string; raw: string; start: number; end: number };

const REF_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function parseTemplate(input: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let last = 0;
  for (const m of input.matchAll(REF_PATTERN)) {
    const start = m.index;
    if (start > last) tokens.push({ kind: 'text', value: input.slice(last, start) });
    tokens.push({ kind: 'ref', ref: m[1]!, raw: m[0], start, end: start + m[0].length });
    last = start + m[0].length;
  }
  if (last < input.length) tokens.push({ kind: 'text', value: input.slice(last) });
  return tokens;
}

export function extractRefs(input: string): string[] {
  return parseTemplate(input).flatMap((t) => (t.kind === 'ref' ? [t.ref] : []));
}

/** Returns the ref if the whole string is exactly one `{{ref}}`. */
export function soleRef(input: string): string | null {
  const tokens = parseTemplate(input);
  return tokens.length === 1 && tokens[0]!.kind === 'ref' ? tokens[0]!.ref : null;
}

export function hasRefs(input: string): boolean {
  return /\{\{\s*[^{}]+?\s*\}\}/.test(input);
}
