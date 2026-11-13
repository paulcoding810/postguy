function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

/** Pretty JSON with sorted keys, so key order never shows up as a difference; other text is returned as is. */
export function comparableBody(text: string | null): { text: string; json: boolean } {
  if (!text) return { text: '', json: false };
  try {
    return { text: JSON.stringify(sortKeys(JSON.parse(text)), null, 2), json: true };
  } catch {
    return { text, json: false };
  }
}

export function headersText(headers: Record<string, string>): string {
  return Object.keys(headers)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k.toLowerCase()}: ${headers[k]}`)
    .join('\n');
}
