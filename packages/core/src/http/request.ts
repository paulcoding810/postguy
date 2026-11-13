import type { Auth, KeyValue, RequestDefinition } from '@postguy/shared';
import type { ResolutionContext } from '../template/context.ts';
import { resolveJsonTree, resolveTemplate, type RefResolution } from '../template/resolve.ts';

export type MultipartPart = { name: string; value: string } | { name: string; file: string; filename: string; contentType: string };

export interface ResolvedBody {
  /** The body as text; for bodies with files, a readable summary used for history and display. */
  content: string | null;
  contentType: string | null;
  /** Multipart bodies with file fields; encode with `encodeBody`. */
  multipart?: { boundary: string; parts: MultipartPart[] };
  /** Binary bodies: the file sent as the whole body. */
  file?: string;
  /** Encoded bytes, set by the sender once files are read; sent instead of `content`. */
  data?: Uint8Array;
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
      return [auth.clientSecret, auth.accessToken ?? '', auth.password ?? ''];
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

export function resolveAuth(auth: Auth, resolve: (s: string) => string): Auth {
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
        scope: auth.scope ? resolve(auth.scope) : auth.scope,
        username: auth.username ? resolve(auth.username) : auth.username,
        password: auth.password ? resolve(auth.password) : auth.password,
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
    case 'binary': {
      const file = str(b.src ?? '').trim();
      if (!file) return { content: null, contentType: null };
      return { content: `<file ${fileName(file)}>`, contentType: b.contentType ?? contentTypeFor(file), file };
    }
    case 'form': {
      const boundary = `----postguy${Math.random().toString(16).slice(2)}`;
      if (enabledPairs(b.form).some((kv) => kv.type === 'file')) {
        const parts: MultipartPart[] = enabledPairs(b.form).map((kv) => {
          const name = str(kv.key);
          if (kv.type !== 'file') return { name, value: str(kv.value) };
          const file = str(kv.src ?? '').trim();
          return { name, file, filename: fileName(file), contentType: contentTypeFor(file) };
        });
        const summary = parts.map((p) => ('file' in p ? `${p.name}=<file ${p.filename}>` : `${p.name}=${p.value}`)).join('\n');
        return { content: summary, contentType: `multipart/form-data; boundary=${boundary}`, multipart: { boundary, parts } };
      }
      const parts = enabledPairs(b.form).map(
        (kv) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${str(kv.key).replace(/"/g, '%22')}"\r\n\r\n${str(kv.value)}\r\n`,
      );
      return { content: parts.join('') + `--${boundary}--\r\n`, contentType: `multipart/form-data; boundary=${boundary}` };
    }
  }
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
  json: 'application/json', xml: 'application/xml', csv: 'text/csv', txt: 'text/plain', html: 'text/html', htm: 'text/html',
  js: 'application/javascript', css: 'text/css', md: 'text/markdown', yaml: 'application/yaml', yml: 'application/yaml',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Guesses a file's media type from its extension. */
export function contentTypeFor(path: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName(path))?.[1]?.toLowerCase();
  return (ext && MIME[ext]) || 'application/octet-stream';
}

const quoteName = (s: string) => s.replace(/"/g, '%22').replace(/\r|\n/g, ' ');

/** The bytes to send: `readFile` loads file fields and binary bodies; text-only bodies stay strings. */
export function encodeBody(body: ResolvedBody, readFile: (path: string) => Uint8Array): Uint8Array | string | null {
  if (body.file) return readFile(body.file);
  if (!body.multipart) return body.content;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const { boundary, parts } = body.multipart;
  for (const p of parts) {
    if ('file' in p)
      chunks.push(
        enc.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${quoteName(p.name)}"; filename="${quoteName(p.filename)}"\r\nContent-Type: ${p.contentType}\r\n\r\n`,
        ),
        readFile(p.file),
        enc.encode('\r\n'),
      );
    else chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${quoteName(p.name)}"\r\n\r\n${p.value}\r\n`));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Files a resolved body reads when it is sent. */
export function bodyFiles(body: ResolvedBody): string[] {
  if (body.file) return [body.file];
  return body.multipart?.parts.flatMap((p) => ('file' in p ? [p.file] : [])) ?? [];
}

