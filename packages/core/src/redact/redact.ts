import type { Auth } from '@postguy/shared';

export const MASK = '••••••';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A secret as it can appear on the wire: raw, URL- or form-encoded, or escaped in JSON. */
function spellings(s: string): string[] {
  const url = encodeURIComponent(s);
  return [s, url, url.replace(/%20/g, '+'), new URLSearchParams({ s }).toString().slice(2), JSON.stringify(s).slice(1, -1)];
}

/** Replaces every occurrence of each secret (length ≥ 3) with a mask, longest first, including its encoded spellings. */
export function redactText(text: string, secrets: Iterable<string>): string {
  const list = [...new Set([...secrets].filter((s) => s && s.length >= 3).flatMap(spellings))].sort((a, b) => b.length - a.length);
  if (!list.length || !text) return text;
  const pattern = new RegExp(list.map(escapeRegExp).join('|'), 'g');
  return text.replace(pattern, MASK);
}

export function redactHeaders(
  headers: Record<string, string>,
  secrets: Iterable<string> = [],
  extraSensitive: Iterable<string> = [],
): Record<string, string> {
  const sensitive = new Set([...SENSITIVE_HEADERS, ...[...extraSensitive].map((h) => h.toLowerCase())]);
  const secretList = [...secrets];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = sensitive.has(k.toLowerCase()) ? maskHeaderValue(v) : redactText(v, secretList);
  }
  return out;
}

function maskHeaderValue(v: string): string {
  const m = /^(Bearer|Basic|Digest|Token)\s+/i.exec(v);
  return m ? `${m[1]} ${MASK}` : MASK;
}

/** Strips credential fields; `{{var}}` references are kept since they hold no secret. */
export function redactAuth(auth: Auth): Auth {
  const keep = (v: string) => (/^\s*\{\{[^{}]+\}\}\s*$/.test(v) ? v : '');
  switch (auth.type) {
    case 'bearer':
      return { ...auth, token: keep(auth.token) };
    case 'basic':
      return { ...auth, password: keep(auth.password) };
    case 'apikey':
      return { ...auth, value: keep(auth.value) };
    case 'oauth2':
      return { ...auth, clientSecret: keep(auth.clientSecret), password: auth.password ? keep(auth.password) : auth.password, accessToken: undefined };
    default:
      return auth;
  }
}

export function redactUrl(url: string, secrets: Iterable<string>): string {
  return redactText(url, secrets);
}

const SENSITIVE_KEY = /(token|secret|password|passwd|authorization|api[-_]?key|cookie|session|credential|private[-_]?key)/i;
/** Keys that describe a credential rather than hold one, e.g. `token_type` or `expires_in`. */
const DESCRIPTIVE_KEY = /(type|kind|expires?(_?in|_?at|_?on)?|expiry|ttl|lifetime|scopes?|url|uri|endpoint|count|length)$/i;
const isSensitiveKey = (k: string) => SENSITIVE_KEY.test(k) && !DESCRIPTIVE_KEY.test(k);

/** Masks values under credential-like keys anywhere in a JSON value. */
export function redactJson(value: unknown, secrets: Iterable<string> = [], depth = 0): unknown {
  const list = [...secrets];
  if (depth > 50) return value;
  if (typeof value === 'string') return redactText(value, list);
  if (Array.isArray(value)) return value.map((v) => redactJson(v, list, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = isSensitiveKey(k) && v !== null && typeof v !== 'object' ? MASK : redactJson(v, list, depth + 1);
    return out;
  }
  return value;
}
