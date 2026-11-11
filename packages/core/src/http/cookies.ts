import type { Cookie } from '@postguy/shared';

export function parseSetCookie(header: string): Cookie | null {
  const parts = header.split(';').map((p) => p.trim());
  const first = parts.shift();
  if (!first) return null;
  const eq = first.indexOf('=');
  if (eq <= 0) return null;
  const cookie: Cookie = { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
  for (const attr of parts) {
    const i = attr.indexOf('=');
    const key = (i === -1 ? attr : attr.slice(0, i)).trim().toLowerCase();
    const val = i === -1 ? '' : attr.slice(i + 1).trim();
    if (key === 'domain') cookie.domain = val;
    else if (key === 'path') cookie.path = val;
    else if (key === 'expires') cookie.expires = val;
    else if (key === 'max-age' && /^-?\d+$/.test(val)) cookie.maxAge = Number(val);
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'samesite') cookie.sameSite = val;
  }
  return cookie;
}

export function parseSetCookies(headers: string[] | string | undefined): Cookie[] {
  if (!headers) return [];
  const list = Array.isArray(headers) ? headers : [headers];
  return list.map(parseSetCookie).filter((c): c is Cookie => c !== null);
}
