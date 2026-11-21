import { formatSegs, type Seg } from '@/features/memory/refs';

export type SaveScope = 'collection' | 'environment';

const IDENT = /^[A-Za-z_$][\w$]*$/;
const GENERIC = new Set(['id', 'name', 'value', 'token', 'key', 'code', 'type', 'status', 'url']);
const TOKEN_KEY = /^(?:(?:access|refresh|id|auth|bearer|session|csrf|xsrf)[_-]?token|token|jwt|session[_-]?id|api[_-]?key)$/i;
const VOLATILE_KEY = /(?:^|[_-])(?:id|uuid|guid|token|jwt|session|secret|key|nonce|hash|signature)$|^(?:id|uuid)$|(?:at|time|date|timestamp|expires?(?:_in)?)$|token|password/i;
const VOLATILE_VALUE = [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, /^\d{4}-\d{2}-\d{2}T/, /^[\w-]+\.[\w-]+\.[\w-]+$/, /^[A-Za-z0-9+/_=-]{24,}$/];

/** JavaScript that reads a path in the response body, e.g. `response.body.data["user-id"]`. */
export function jsAccess(segs: Seg[]): string {
  return segs.reduce<string>((out, s) => (typeof s === 'number' ? `${out}[${s}]` : IDENT.test(s) ? `${out}.${s}` : `${out}[${JSON.stringify(s)}]`), 'response.body');
}

const camel = (s: string) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^[A-Z]/, (c) => c.toLowerCase());

/** A variable name for a value, from its key; generic keys borrow their parent's, so `user.id` gives `userId`. */
export function suggestName(segs: Seg[]): string {
  const keys = segs.filter((s): s is string => typeof s === 'string');
  const last = keys.at(-1);
  if (!last) return 'value';
  const parent = keys.at(-2);
  const name = GENERIC.has(last.toLowerCase()) && parent && !/^(data|result|results|response|body|items)$/i.test(parent) ? `${camel(parent)}_${last}` : last;
  return camel(name) || 'value';
}

export function saveLine(segs: Seg[], name: string, scope: SaveScope): string {
  const call = scope === 'collection' ? 'pm.collectionVariables.set' : 'env.set';
  return `${call}(${JSON.stringify(name)}, ${jsAccess(segs)});\n`;
}

function isVolatile(segs: Seg[], value: unknown): boolean {
  const key = [...segs].reverse().find((s): s is string => typeof s === 'string') ?? '';
  if (VOLATILE_KEY.test(key)) return true;
  return typeof value === 'string' && VOLATILE_VALUE.some((r) => r.test(value));
}

/** An assertion for a value: equality for stable scalars, presence for ids, tokens, dates and containers. */
export function testLine(segs: Seg[], value: unknown): string {
  const expr = jsAccess(segs);
  const path = formatSegs(segs) || 'body';
  if (value === null) return `flow.assert(${expr} === null, ${JSON.stringify(`${path} is null`)});\n`;
  if (Array.isArray(value)) return `flow.assert(Array.isArray(${expr}), ${JSON.stringify(`${path} is a list`)});\n`;
  if (typeof value === 'object' || isVolatile(segs, value) || (typeof value === 'string' && value.length > 60)) {
    return `flow.assert(${expr} != null, ${JSON.stringify(`has ${path}`)});\n`;
  }
  const literal = JSON.stringify(value);
  const shown = typeof value === 'string' ? value : literal;
  return `flow.assert(${expr} === ${literal}, ${JSON.stringify(`${path} is ${shown}`)});\n`;
}

export interface Suggestion {
  label: string;
  code: string;
}

/** Token-like string fields, shallowest first. */
function tokenFields(body: unknown, maxDepth = 3): Seg[][] {
  const found: Seg[][] = [];
  const walk = (v: unknown, segs: Seg[]) => {
    if (segs.length > maxDepth || v === null || typeof v !== 'object' || Array.isArray(v)) return;
    for (const [k, x] of Object.entries(v)) if (typeof x === 'string' && x && TOKEN_KEY.test(k)) found.push([...segs, k]);
    for (const [k, x] of Object.entries(v)) walk(x, [...segs, k]);
  };
  walk(body, []);
  return found.sort((a, b) => a.length - b.length);
}

/** The object whose fields are worth checking: the body, or the single object it wraps (`{ data: {…} }`). */
function mainObject(body: unknown): { segs: Seg[]; value: Record<string, unknown> } | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const entries = Object.entries(body);
  const wrapped = entries.filter(([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v));
  if (wrapped.length === 1 && /^(data|result|user|item|payload)$/i.test(wrapped[0]![0])) return { segs: [wrapped[0]![0]], value: wrapped[0]![1] as Record<string, unknown> };
  return { segs: [], value: body as Record<string, unknown> };
}

/** Post-response snippets written for the response this request last got. */
export function responseSnippets(response: { status?: number; contentType: string | null; body: unknown }, scope: SaveScope): Suggestion[] {
  const out: Suggestion[] = [];
  if (response.status) out.push({ label: `Status is ${response.status}`, code: `flow.assert(response.status === ${response.status}, 'status is ${response.status}');\n` });
  if (/json/i.test(response.contentType ?? '')) out.push({ label: 'Returns JSON', code: `flow.assert(/json/.test(response.headers['content-type'] ?? ''), 'returns JSON');\n` });
  for (const segs of tokenFields(response.body).slice(0, 3)) {
    const name = suggestName(segs);
    out.push({ label: `Save ${formatSegs(segs)} as {{${name}}}`, code: saveLine(segs, name, scope) });
  }
  const main = mainObject(response.body);
  const keys = main ? Object.keys(main.value).slice(0, 5) : [];
  if (main && keys.length) {
    const prefix = main.segs.length ? `${formatSegs(main.segs)}.` : '';
    out.push({
      label: `Check ${keys.map((k) => prefix + k).join(', ')} exist${keys.length === 1 ? 's' : ''}`,
      code: keys.map((k) => `flow.assert(${jsAccess([...main.segs, k])} !== undefined, ${JSON.stringify(`has ${formatSegs([...main.segs, k])}`)});\n`).join(''),
    });
  }
  return out;
}
