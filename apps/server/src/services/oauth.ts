import { createHash } from 'node:crypto';
import axios from 'axios';
import { base64, resolveAuth, resolveTemplate, type ResolutionContext } from '@postguy/core';
import type { Auth, OAuthTokenResult } from '@postguy/shared';
import { HttpError } from '../lib/errors.ts';

type OAuth2 = Extract<Auth, { type: 'oauth2' }>;

interface CachedToken {
  token: string;
  tokenType: string;
  expiresAt: number | null;
  scope: string | null;
}

const cache = new Map<string, CachedToken>();
const EXPIRY_MARGIN_MS = 30_000;

function cacheKey(a: OAuth2): string {
  return createHash('sha256')
    .update(JSON.stringify([a.grantType, a.tokenUrl, a.clientId, a.clientSecret, a.scope ?? '', a.username ?? '', a.password ?? '']))
    .digest('hex');
}

/** True when the request should fetch a token itself: a supported grant and no usable access token. */
export function needsTokenExchange(auth: Auth, ctx: ResolutionContext): auth is OAuth2 {
  if (auth.type !== 'oauth2' || auth.grantType === 'authorization_code') return false;
  if (!auth.accessToken?.trim()) return true;
  const r = resolveTemplate(auth.accessToken, ctx);
  return r.unresolved.length > 0 || !r.value.trim();
}

/** Fetches (or reuses a cached) access token for the client credentials or password grant. */
export async function exchangeToken(raw: OAuth2, ctx: ResolutionContext, opts: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<CachedToken & { cached: boolean }> {
  const auth = resolveAuth(raw, (s) => resolveTemplate(s, ctx).value) as OAuth2;
  if (auth.grantType === 'authorization_code') throw new HttpError(400, 'The authorization code grant needs a browser sign-in; paste the access token instead', 'oauth_unsupported');
  if (!auth.tokenUrl) throw new HttpError(400, 'OAuth 2.0 needs a token URL', 'oauth_config');
  const key = cacheKey(auth);
  const hit = cache.get(key);
  if (hit && !opts.refresh && (hit.expiresAt === null || hit.expiresAt - EXPIRY_MARGIN_MS > Date.now())) return { ...hit, cached: true };

  const form = new URLSearchParams({ grant_type: auth.grantType });
  if (auth.scope) form.set('scope', auth.scope);
  if (auth.grantType === 'password') {
    form.set('username', auth.username ?? '');
    form.set('password', auth.password ?? '');
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if ((auth.clientAuth ?? 'header') === 'header') headers.Authorization = `Basic ${base64(`${encodeURIComponent(auth.clientId)}:${encodeURIComponent(auth.clientSecret)}`)}`;
  else {
    form.set('client_id', auth.clientId);
    form.set('client_secret', auth.clientSecret);
  }

  let data: Record<string, unknown>;
  try {
    const res = await axios.post(auth.tokenUrl, form.toString(), { headers, timeout: 15_000, signal: opts.signal, validateStatus: () => true, proxy: false });
    data = (typeof res.data === 'string' ? Object.fromEntries(new URLSearchParams(res.data)) : res.data) ?? {};
    if (res.status >= 400 || typeof data.access_token !== 'string') {
      const reason = [data.error, data.error_description].filter(Boolean).join(': ') || `HTTP ${res.status}`;
      throw new HttpError(502, `Token request failed: ${reason}`, 'oauth_failed');
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `Token request failed: ${(e as Error).message}`, 'oauth_failed');
  }
  const expiresIn = Number(data.expires_in);
  const token: CachedToken = {
    token: data.access_token as string,
    tokenType: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
    scope: typeof data.scope === 'string' ? data.scope : null,
  };
  cache.set(key, token);
  return { ...token, cached: false };
}

export function tokenSummary(t: CachedToken & { cached: boolean }): OAuthTokenResult {
  return {
    tokenPreview: t.token.length > 10 ? `${t.token.slice(0, 6)}…${t.token.slice(-4)}` : '••••••',
    tokenType: t.tokenType,
    expiresAt: t.expiresAt,
    scope: t.scope,
    cached: t.cached,
  };
}

export function clearTokenCache() {
  cache.clear();
}
