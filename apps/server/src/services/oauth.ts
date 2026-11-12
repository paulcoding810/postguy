import { createHash, randomBytes } from 'node:crypto';
import axios from 'axios';
import { base64, resolveAuth, resolveTemplate, type ResolutionContext } from '@postguy/core';
import type { Auth, OAuthAuthorizeResult, OAuthSignInStatus, OAuthTokenResult } from '@postguy/shared';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';

type OAuth2 = Extract<Auth, { type: 'oauth2' }>;

interface CachedToken {
  token: string;
  tokenType: string;
  expiresAt: number | null;
  scope: string | null;
  refreshToken: string | null;
}

const cache = new Map<string, CachedToken>();
const EXPIRY_MARGIN_MS = 30_000;
const SIGN_IN_TTL_MS = 10 * 60_000;

function cacheKey(a: OAuth2): string {
  const parts =
    a.grantType === 'authorization_code'
      ? [a.grantType, a.authUrl ?? '', a.tokenUrl, a.clientId, a.scope ?? '']
      : [a.grantType, a.tokenUrl, a.clientId, a.clientSecret, a.scope ?? '', a.username ?? '', a.password ?? ''];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

const fresh = (t: CachedToken) => t.expiresAt === null || t.expiresAt - EXPIRY_MARGIN_MS > Date.now();

/** True when the request should obtain a token itself: OAuth 2.0 with no usable access token. */
export function needsTokenExchange(auth: Auth, ctx: ResolutionContext): auth is OAuth2 {
  if (auth.type !== 'oauth2') return false;
  if (!auth.accessToken?.trim()) return true;
  const r = resolveTemplate(auth.accessToken, ctx);
  return r.unresolved.length > 0 || !r.value.trim();
}

function resolved(raw: OAuth2, ctx: ResolutionContext): OAuth2 {
  const auth = resolveAuth(raw, (s) => resolveTemplate(s, ctx).value) as OAuth2;
  if (auth.authUrl) auth.authUrl = resolveTemplate(auth.authUrl, ctx).value;
  return auth;
}

/** Posts a token request; client credentials go in a Basic header unless configured for the body or the client is public. */
async function tokenRequest(auth: OAuth2, params: Record<string, string>, signal?: AbortSignal): Promise<CachedToken> {
  if (!auth.tokenUrl) throw new HttpError(400, 'OAuth 2.0 needs a token URL', 'oauth_config');
  const form = new URLSearchParams(params);
  if (auth.scope && !form.has('scope')) form.set('scope', auth.scope);
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (!auth.clientSecret) form.set('client_id', auth.clientId);
  else if ((auth.clientAuth ?? 'header') === 'header')
    headers.Authorization = `Basic ${base64(`${encodeURIComponent(auth.clientId)}:${encodeURIComponent(auth.clientSecret)}`)}`;
  else {
    form.set('client_id', auth.clientId);
    form.set('client_secret', auth.clientSecret);
  }
  let data: Record<string, unknown>;
  try {
    const res = await axios.post(auth.tokenUrl, form.toString(), { headers, timeout: 15_000, signal, validateStatus: () => true, proxy: false });
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
  return {
    token: data.access_token as string,
    tokenType: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
    scope: typeof data.scope === 'string' ? data.scope : null,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
  };
}

/**
 * Returns a usable access token: a fresh cached one, a refreshed one, or a new one for the
 * client-credentials and password grants. The authorization-code grant needs a prior sign-in.
 */
export async function exchangeToken(raw: OAuth2, ctx: ResolutionContext, opts: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<CachedToken & { cached: boolean }> {
  const auth = resolved(raw, ctx);
  const key = cacheKey(auth);
  const hit = cache.get(key);
  if (hit && !opts.refresh && fresh(hit)) return { ...hit, cached: true };
  if (hit?.refreshToken) {
    try {
      const next = await tokenRequest(auth, { grant_type: 'refresh_token', refresh_token: hit.refreshToken }, opts.signal);
      const merged = { ...next, refreshToken: next.refreshToken ?? hit.refreshToken };
      cache.set(key, merged);
      return { ...merged, cached: false };
    } catch (e) {
      cache.delete(key);
      if (auth.grantType === 'authorization_code') throw e;
    }
  }
  if (auth.grantType === 'authorization_code')
    throw new HttpError(401, 'Sign in first: open the Auth tab and choose Sign in with OAuth 2.0', 'oauth_sign_in_required');
  const params: Record<string, string> = { grant_type: auth.grantType };
  if (auth.grantType === 'password') {
    params.username = auth.username ?? '';
    params.password = auth.password ?? '';
  }
  const token = await tokenRequest(auth, params, opts.signal);
  cache.set(key, token);
  return { ...token, cached: false };
}

interface SignIn {
  auth: OAuth2;
  verifier: string | null;
  redirectUri: string;
  createdAt: number;
  status: OAuthSignInStatus['status'];
  error: string | null;
  token: CachedToken | null;
}

const signIns = new Map<string, SignIn>();

function sweep() {
  for (const [k, v] of signIns) if (Date.now() - v.createdAt > SIGN_IN_TTL_MS) signIns.delete(k);
}

/** Starts an authorization-code sign-in with PKCE; the browser returns to this server's /oauth/callback. */
export function startSignIn(raw: OAuth2, ctx: ResolutionContext, serverOrigin: string): OAuthAuthorizeResult {
  sweep();
  const auth = resolved(raw, ctx);
  if (auth.grantType !== 'authorization_code') throw badRequest('Sign-in is only needed for the authorization code grant');
  if (!auth.authUrl) throw badRequest('Add the authorization URL first');
  let url: URL;
  try {
    url = new URL(auth.authUrl);
  } catch {
    throw badRequest('The authorization URL is not valid');
  }
  if (!/^https?:$/.test(url.protocol)) throw badRequest('The authorization URL must use http or https');
  const state = randomBytes(16).toString('base64url');
  const verifier = auth.usePkce === false ? null : randomBytes(32).toString('base64url');
  const redirectUri = `${serverOrigin}/oauth/callback`;
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', auth.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  if (auth.scope) url.searchParams.set('scope', auth.scope);
  if (verifier) {
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  signIns.set(state, { auth, verifier, redirectUri, createdAt: Date.now(), status: 'pending', error: null, token: null });
  return { state, authorizationUrl: url.toString(), redirectUri };
}

/** Handles the provider's redirect; returns a short HTML page for the browser tab. */
export async function completeSignIn(query: Record<string, string | undefined>): Promise<{ ok: boolean; message: string }> {
  const s = query.state ? signIns.get(query.state) : undefined;
  if (!s || s.status !== 'pending') return { ok: false, message: 'This sign-in link has expired or was already used. Start again from Postguy.' };
  if (query.error) {
    s.status = 'error';
    s.error = [query.error, query.error_description].filter(Boolean).join(': ');
    return { ok: false, message: `Sign-in was not completed: ${s.error}` };
  }
  try {
    const params: Record<string, string> = { grant_type: 'authorization_code', code: query.code ?? '', redirect_uri: s.redirectUri };
    if (s.verifier) params.code_verifier = s.verifier;
    const token = await tokenRequest(s.auth, params);
    cache.set(cacheKey(s.auth), token);
    s.status = 'done';
    s.token = token;
    return { ok: true, message: 'Signed in. You can close this tab and return to Postguy.' };
  } catch (e) {
    s.status = 'error';
    s.error = (e as Error).message;
    return { ok: false, message: s.error };
  }
}

export function signInStatus(state: string): OAuthSignInStatus {
  const s = signIns.get(state);
  if (!s) throw notFound('Sign-in');
  return { status: s.status, error: s.error, token: s.token ? tokenSummary({ ...s.token, cached: false }) : null };
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
  signIns.clear();
}

export function callbackPage(ok: boolean, message: string): string {
  const esc = message.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Postguy sign-in</title><style>body{font:15px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#fafafa;color:#18181b}div{max-width:420px;text-align:center}b{color:${ok ? '#16a34a' : '#dc2626'}}@media(prefers-color-scheme:dark){body{background:#18181b;color:#f4f4f5}}</style></head><body><div><b>${ok ? 'Signed in' : 'Sign-in failed'}</b><p>${esc}</p></div></body></html>`;
}
