import { describe, expect, it } from 'vitest';
import { cookieFromSetCookie, cookieHeader, cookiesForUrl, domainMatches, pathMatches } from './cookieJar.ts';

const now = Date.UTC(2026, 10, 13);

describe('cookie jar rules', () => {
  it('stores host-only cookies with the default path and expiry from Max-Age', () => {
    const c = cookieFromSetCookie('sid=abc; Max-Age=60; HttpOnly', 'https://api.example.com/v1/login', now)!;
    expect(c).toMatchObject({ name: 'sid', value: 'abc', domain: 'api.example.com', path: '/v1', hostOnly: true, httpOnly: true, expiresAt: now + 60_000 });
  });

  it('accepts a Domain attribute only when the host is inside it', () => {
    expect(cookieFromSetCookie('a=1; Domain=.example.com', 'https://api.example.com/', now)).toMatchObject({ domain: 'example.com', hostOnly: false });
    expect(cookieFromSetCookie('a=1; Domain=other.com', 'https://api.example.com/', now)).toBeNull();
  });

  it('matches domains, paths and the Secure flag', () => {
    expect(domainMatches('api.example.com', 'example.com', false)).toBe(true);
    expect(domainMatches('api.example.com', 'example.com', true)).toBe(false);
    expect(pathMatches('/v1/users', '/v1')).toBe(true);
    expect(pathMatches('/v10', '/v1')).toBe(false);
    const jar = [
      cookieFromSetCookie('root=1; Path=/', 'https://example.com/', now)!,
      cookieFromSetCookie('deep=2; Path=/v1', 'https://example.com/', now + 1)!,
      cookieFromSetCookie('sec=3; Secure; Path=/', 'https://example.com/', now + 2)!,
      cookieFromSetCookie('old=4; Max-Age=0; Path=/', 'https://example.com/', now)!,
    ];
    expect(cookieHeader(cookiesForUrl(jar, 'https://example.com/v1/x', now))).toBe('deep=2; root=1; sec=3');
    expect(cookieHeader(cookiesForUrl(jar, 'http://example.com/', now))).toBe('root=1');
    expect(cookieHeader(cookiesForUrl(jar, 'https://sub.example.com/', now))).toBeNull();
  });
});
