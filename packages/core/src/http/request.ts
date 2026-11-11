import type { Auth, KeyValue, RequestDefinition } from '@postguy/shared';
import type { ResolutionContext } from '../template/context.ts';
import { resolveJsonTree, resolveTemplate, type RefResolution } from '../template/resolve.ts';

export interface ResolvedBody {
  content: string | null;
  contentType: string | null;
}

export interface ResolvedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: ResolvedBody;
}

export interface RequestResolution {
  request: ResolvedRequest;
  unresolved: string[];
  secrets: string[];
  refs: RefResolution[];
}

const PATH_PARAM = /\/:([A-Za-z_][\w-]*)/g;

/** Names of `:param` placeholders in the path part of a URL (ignores scheme and port). */
export function extractPathParams(url: string): string[] {
  const path = urlPath(url);
  const names: string[] = [];
  for (const m of path.matchAll(PATH_PARAM)) if (!names.includes(m[1]!)) names.push(m[1]!);
  return names;
}

function urlPath(url: string): string {
  const noQuery = url.split(/[?#]/)[0] ?? '';
  const schemeIdx = noQuery.indexOf('://');
  if (schemeIdx === -1) return noQuery.replace(/^\{\{[^}]+\}\}/, '');
  const afterScheme = noQuery.slice(schemeIdx + 3);
  const slash = afterScheme.indexOf('/');
  return slash === -1 ? '' : afterScheme.slice(slash);
}

export function enabledPairs(list: KeyValue[] | undefined): KeyValue[] {
  return (list ?? []).filter((kv) => kv.enabled && kv.key.trim() !== '');
}

export function authSecretValues(auth: Auth): string[] {
  switch (auth.type) {
    case 'bearer':
      return [auth.token];
    case 'basic':
      return [auth.password, base64(`${auth.username}:${auth.password}`)];
    case 'apikey':
      return [auth.value];
    case 'oauth2':
      return [auth.clientSecret, auth.accessToken ?? ''];
    default:
      return [];
  }
}

export function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function resolveAuth(auth: Auth, resolve: (s: string) => string): Auth {
  switch (auth.type) {
    case 'bearer':
      return { ...auth, token: resolve(auth.token) };
    case 'basic':
      return { ...auth, username: resolve(auth.username), password: resolve(auth.password) };
    case 'apikey':
      return { ...auth, key: resolve(auth.key), value: resolve(auth.value) };
    case 'oauth2':
      return {
        ...auth,
        tokenUrl: resolve(auth.tokenUrl),
        clientId: resolve(auth.clientId),
        clientSecret: resolve(auth.clientSecret),
        accessToken: auth.accessToken ? resolve(auth.accessToken) : auth.accessToken,
      };
    default:
      return auth;
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

/** Applies auth to headers/query. Explicit request headers win over auth-derived ones. */
export function applyAuth(
  auth: Auth,
  headers: Record<string, string>,
  query: [string, string][],
): void {
  switch (auth.type) {
    case 'bearer':
      if (auth.token && !hasHeader(headers, 'authorization')) headers['Authorization'] = `Bearer ${auth.token}`;
      break;
    case 'basic':
      if (!hasHeader(headers, 'authorization'))
        headers['Authorization'] = `Basic ${base64(`${auth.username}:${auth.password}`)}`;
      break;
    case 'apikey':
      if (!auth.key) break;
      if (auth.in === 'query') query.push([auth.key, auth.value]);
      else if (!hasHeader(headers, auth.key)) headers[auth.key] = auth.value;
      break;
    case 'oauth2':
      if (auth.accessToken && !hasHeader(headers, 'authorization'))
        headers['Authorization'] = `Bearer ${auth.accessToken}`;
      break;
  }
}

/**
 * Resolves every templated field of a request definition. `effectiveAuth` is the auth after
 * `inherit` was walked up the collection tree.
 */
export function resolveRequest(
  def: RequestDefinition,
  ctx: ResolutionContext,
  effectiveAuth: Auth = def.auth,
): RequestResolution {
  const unresolved = new Set<string>();
  const secrets = new Set<string>();
  const refs: RefResolution[] = [];
  const track = (r: { unresolved: string[]; secrets: string[]; refs: RefResolution[] }) => {
    r.unresolved.forEach((u) => unresolved.add(u));
    r.secrets.forEach((s) => secrets.add(s));
    refs.push(...r.refs);
  };
  const str = (s: string) => {
    const r = resolveTemplate(s, ctx);
    track(r);
    return r.value;
  };

  let url = str(def.url.trim());
  const pathValues = new Map(enabledPairs(def.pathParams).map((p) => [p.key, str(p.value)]));
  url = url.replace(PATH_PARAM, (whole, name: string) =>
    pathValues.has(name) ? `/${encodeURIComponent(pathValues.get(name)!)}` : whole,
  );
  if (url && !/^[a-z][a-z\d+.-]*:\/\//i.test(url)) url = `http://${url}`;

  const headers: Record<string, string> = {};
  for (const h of enabledPairs(def.headers)) headers[str(h.key)] = str(h.value);

  const query: [string, string][] = enabledPairs(def.params).map((p) => [str(p.key), str(p.value)]);

  const auth = resolveAuth(effectiveAuth, str);
  authSecretValues(auth).forEach((s) => s && secrets.add(s));
  applyAuth(auth, headers, query);

  if (query.length) {
    const qs = query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    url += (url.includes('?') ? (url.endsWith('?') || url.endsWith('&') ? '' : '&') : '?') + qs;
  }

  const body = resolveBody(def, ctx, str, track);
  if (body.contentType && !hasHeader(headers, 'content-type')) headers['Content-Type'] = body.contentType;

  return {
    request: { method: def.method, url, headers, body },
    unresolved: [...unresolved],
    secrets: [...secrets].filter((s) => s.length >= 3),
    refs,
  };
}

function resolveBody(
  def: RequestDefinition,
  ctx: ResolutionContext,
  str: (s: string) => string,
  track: (r: { unresolved: string[]; secrets: string[]; refs: RefResolution[] }) => void,
): ResolvedBody {
  const b = def.body;
  if (def.method === 'GET' || def.method === 'HEAD') {
    if (b.mode === 'none' || !b.raw) return { content: null, contentType: null };
  }
  switch (b.mode) {
    case 'none':
      return { content: null, contentType: null };
    case 'json': {
      const raw = b.raw ?? '';
      if (!raw.trim()) return { content: null, contentType: b.contentType ?? 'application/json' };
      let parsed: unknown;
      let ok = false;
      try {
        parsed = JSON.parse(raw);
        ok = true;
      } catch {
        ok = false;
      }
      if (ok) {
        const r = resolveJsonTree(parsed, ctx);
        track(r);
        return { content: JSON.stringify(r.value), contentType: b.contentType ?? 'application/json' };
      }
      return { content: str(raw), contentType: b.contentType ?? 'application/json' };
    }
    case 'text':
      return { content: str(b.raw ?? ''), contentType: b.contentType ?? 'text/plain' };
    case 'urlencoded': {
      const pairs = enabledPairs(b.form).map(
        (kv) => `${encodeURIComponent(str(kv.key))}=${encodeURIComponent(str(kv.value))}`,
      );
      return { content: pairs.join('&'), contentType: 'application/x-www-form-urlencoded' };
    }
    case 'form': {
      const boundary = `----postguy${Math.random().toString(16).slice(2)}`;
      const parts = enabledPairs(b.form).map(
        (kv) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${str(kv.key).replace(/"/g, '%22')}"\r\n\r\n${str(kv.value)}\r\n`,
      );
      return { content: parts.join('') + `--${boundary}--\r\n`, contentType: `multipart/form-data; boundary=${boundary}` };
    }
  }
}

