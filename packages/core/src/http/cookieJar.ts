import type { StoredCookie } from '@postguy/shared';
import { parseSetCookie } from './cookies.ts';

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** RFC 6265 default-path: the request path up to, but not including, its last "/". */
function defaultPath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/';
  const i = pathname.lastIndexOf('/');
  return i <= 0 ? '/' : pathname.slice(0, i);
}

export function domainMatches(host: string, domain: string, hostOnly: boolean): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  if (h === d) return true;
  return !hostOnly && h.endsWith(`.${d}`) && !/^\d+\.\d+\.\d+\.\d+$/.test(h);
}

export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

/** Turns one Set-Cookie header received from `url` into a stored cookie, or null when it must be ignored. */
export function cookieFromSetCookie(header: string, url: string, now = Date.now()): StoredCookie | null {
  const u = parseUrl(url);
  const c = parseSetCookie(header);
  if (!u || !c || !c.name) return null;
  const host = u.hostname.toLowerCase();
  let domain = host;
  let hostOnly = true;
  if (c.domain) {
    const d = c.domain.replace(/^\./, '').toLowerCase();
    if (!domainMatches(host, d, false)) return null;
    domain = d;
    hostOnly = false;
  }
  let expiresAt: number | null = null;
  if (c.maxAge !== undefined) expiresAt = now + c.maxAge * 1000;
  else if (c.expires) {
    const t = Date.parse(c.expires);
    if (!Number.isNaN(t)) expiresAt = t;
  }
  return {
    name: c.name,
    value: c.value,
    domain,
    path: c.path?.startsWith('/') ? c.path : defaultPath(u.pathname),
    hostOnly,
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: c.sameSite ?? null,
    expiresAt,
    createdAt: now,
  };
}

export function isExpired(c: Pick<StoredCookie, 'expiresAt'>, now = Date.now()): boolean {
  return c.expiresAt !== null && c.expiresAt <= now;
}

/** Cookies a request to `url` should carry, longest path first. */
export function cookiesForUrl<T extends StoredCookie>(cookies: T[], url: string, now = Date.now()): T[] {
  const u = parseUrl(url);
  if (!u || !/^https?:$/.test(u.protocol)) return [];
  const secureOk = u.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return cookies
    .filter((c) => !isExpired(c, now) && domainMatches(u.hostname, c.domain, c.hostOnly) && pathMatches(u.pathname || '/', c.path) && (!c.secure || secureOk))
    .sort((a, b) => b.path.length - a.path.length || a.createdAt - b.createdAt);
}

export function cookieHeader(cookies: Pick<StoredCookie, 'name' | 'value'>[]): string | null {
  return cookies.length ? cookies.map((c) => `${c.name}=${c.value}`).join('; ') : null;
}

export function sameCookie(a: Pick<StoredCookie, 'name' | 'domain' | 'path'>, b: Pick<StoredCookie, 'name' | 'domain' | 'path'>): boolean {
  return a.name === b.name && a.domain === b.domain && a.path === b.path;
}
