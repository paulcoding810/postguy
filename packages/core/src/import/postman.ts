import { HTTP_METHODS, newId, type Auth, type Body, type CollectionExport, type ExportedCollection, type HttpMethod, type KeyValue, type RequestDefinition } from '@postguy/shared';

type Obj = Record<string, any>;

export function isPostmanCollection(data: unknown): boolean {
  const info = (data as Obj | null)?.info;
  return !!info && (typeof info.schema === 'string' ? /getpostman\.com|postman/i.test(info.schema) : '_postman_id' in info);
}

const text = (d: unknown): string | null => (typeof d === 'string' ? d : d && typeof d === 'object' && typeof (d as Obj).content === 'string' ? (d as Obj).content : null);

function kv(list: unknown): KeyValue[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x: Obj) => x && typeof x.key === 'string')
    .map((x: Obj) => ({ id: newId(8), key: x.key, value: x.value === undefined || x.value === null ? '' : String(x.value), enabled: !x.disabled, ...(text(x.description) ? { description: text(x.description)! } : {}) }));
}

function authParams(list: unknown): Record<string, string> {
  if (!Array.isArray(list)) return (list as Record<string, string>) ?? {};
  return Object.fromEntries(list.filter((x: Obj) => x?.key).map((x: Obj) => [x.key, x.value === undefined ? '' : String(x.value)]));
}

export function postmanAuth(auth: Obj | undefined | null, inherit: boolean): Auth {
  if (!auth) return inherit ? { type: 'inherit' } : { type: 'none' };
  const p = authParams(auth[auth.type]);
  switch (auth.type) {
    case 'noauth':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: p.token ?? '' };
    case 'basic':
      return { type: 'basic', username: p.username ?? '', password: p.password ?? '' };
    case 'apikey':
      return { type: 'apikey', key: p.key ?? 'X-API-Key', value: p.value ?? '', in: p.in === 'query' ? 'query' : 'header' };
    case 'oauth2':
      return {
        type: 'oauth2',
        grantType: p.grant_type === 'password_credentials' ? 'password' : p.grant_type === 'authorization_code' ? 'authorization_code' : 'client_credentials',
        tokenUrl: p.accessTokenUrl ?? '',
        clientId: p.clientId ?? '',
        clientSecret: p.clientSecret ?? '',
        scope: p.scope,
        username: p.username,
        password: p.password,
        accessToken: p.accessToken,
      };
    default:
      return inherit ? { type: 'inherit' } : { type: 'none' };
  }
}

function urlParts(url: unknown): { url: string; params: KeyValue[]; pathParams: KeyValue[] } {
  if (!url) return { url: '', params: [], pathParams: [] };
  if (typeof url === 'string') {
    const [base, qs] = url.split(/\?(.*)/s);
    const params = qs
      ? qs.split('&').filter(Boolean).map((pair) => {
          const i = pair.indexOf('=');
          return { id: newId(8), key: i === -1 ? pair : pair.slice(0, i), value: i === -1 ? '' : pair.slice(i + 1), enabled: true };
        })
      : [];
    return { url: base ?? '', params, pathParams: [] };
  }
  const u = url as Obj;
  let base: string;
  if (typeof u.raw === 'string') base = u.raw.split('?')[0]!;
  else {
    const host = Array.isArray(u.host) ? u.host.join('.') : (u.host ?? '');
    const path = Array.isArray(u.path) ? u.path.join('/') : (u.path ?? '');
    base = `${u.protocol ? `${u.protocol}://` : ''}${host}${path ? `/${path}` : ''}`;
  }
  return { url: base, params: kv(u.query), pathParams: kv(u.variable) };
}

function body(b: Obj | undefined): Body {
  if (!b || b.disabled) return { mode: 'none' };
  switch (b.mode) {
    case 'raw': {
      const lang = b.options?.raw?.language;
      const raw = typeof b.raw === 'string' ? b.raw : '';
      return lang === 'json' || (!lang && /^\s*[[{]/.test(raw)) ? { mode: 'json', raw } : { mode: 'text', raw, contentType: lang === 'xml' ? 'application/xml' : lang === 'html' ? 'text/html' : undefined };
    }
    case 'urlencoded':
      return { mode: 'urlencoded', form: kv(b.urlencoded) };
    case 'formdata': {
      const fields: Obj[] = Array.isArray(b.formdata) ? b.formdata : [];
      return {
        mode: 'form',
        form: kv(fields).map((f, i) => {
          const src = fields.filter((x) => x && typeof x.key === 'string')[i]!;
          return src.type === 'file' ? { ...f, value: '', type: 'file' as const, src: fileSrc(src.src) } : f;
        }),
      };
    }
    case 'file':
      return { mode: 'binary', src: fileSrc(b.file?.src) };
    case 'graphql':
      return { mode: 'json', raw: JSON.stringify({ query: b.graphql?.query ?? '', variables: tryJson(b.graphql?.variables) }, null, 2) };
    default:
      return { mode: 'none' };
  }
}

const fileSrc = (src: unknown): string => (Array.isArray(src) ? String(src[0] ?? '') : typeof src === 'string' ? src : '');

function tryJson(s: unknown): unknown {
  if (typeof s !== 'string' || !s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function scripts(events: unknown): { pre: string; post: string } {
  const out = { pre: '', post: '' };
  if (!Array.isArray(events)) return out;
  for (const e of events as Obj[]) {
    const exec = Array.isArray(e.script?.exec) ? e.script.exec.join('\n') : typeof e.script?.exec === 'string' ? e.script.exec : '';
    if (!exec.trim()) continue;
    const script = `// Imported from Postman.\n${exec}\n`;
    if (e.listen === 'prerequest') out.pre = script;
    else if (e.listen === 'test') out.post = script;
  }
  return out;
}

function request(item: Obj): RequestDefinition & { description: string | null } {
  const r: Obj = typeof item.request === 'string' ? { url: item.request, method: 'GET' } : (item.request ?? {});
  const method = String(r.method ?? 'GET').toUpperCase();
  const { url, params, pathParams } = urlParts(r.url);
  return {
    name: String(item.name ?? 'Request'),
    description: text(r.description) ?? text(item.description),
    method: (HTTP_METHODS as readonly string[]).includes(method) ? (method as HttpMethod) : 'GET',
    url,
    params,
    pathParams,
    headers: kv(r.header),
    auth: postmanAuth(r.auth, true),
    body: body(r.body),
    settings: {},
    scripts: scripts(item.event),
  };
}

function folder(node: Obj, isRoot: boolean): ExportedCollection {
  const items: Obj[] = Array.isArray(node.item) ? node.item : [];
  return {
    name: String((isRoot ? node.info?.name : node.name) ?? 'Imported'),
    description: text(isRoot ? node.info?.description : node.description),
    auth: postmanAuth(node.auth, !isRoot),
    variables: isRoot && Array.isArray(node.variable) ? node.variable.filter((v: Obj) => v?.key).map((v: Obj) => ({ key: String(v.key), value: v.value === undefined || v.value === null ? '' : String(v.value), isSecret: v.type === 'secret' })) : [],
    folders: items.filter((i) => Array.isArray(i.item)).map((i) => folder(i, false)),
    requests: items.filter((i) => !Array.isArray(i.item) && i.request !== undefined).map(request),
  };
}

/** Converts a Postman v2.0/v2.1 collection into Postguy's export format. */
export function postmanToCollection(data: unknown): CollectionExport {
  return { format: 'postguy-collection', version: 1, collection: folder(data as Obj, true) };
}

/** Scripts on the collection or its folders, which have no place in Postguy and are dropped. */
export function postmanDroppedScripts(data: unknown): string[] {
  const out: string[] = [];
  const walk = (node: Obj, name: string) => {
    const events = Array.isArray(node.event) ? (node.event as Obj[]) : [];
    if (events.some((e) => (Array.isArray(e.script?.exec) ? e.script.exec.join('') : String(e.script?.exec ?? '')).trim())) out.push(name);
    for (const i of Array.isArray(node.item) ? (node.item as Obj[]) : []) if (Array.isArray(i.item)) walk(i, String(i.name ?? 'Folder'));
  };
  walk(data as Obj, String((data as Obj)?.info?.name ?? 'Collection'));
  if (!out.length) return [];
  const shown = out.slice(0, 3).map((n) => `"${n}"`).join(', ') + (out.length > 3 ? ` and ${out.length - 3} more` : '');
  return [`Collection- and folder-level scripts were not imported (Postguy runs scripts per request): ${shown}.`];
}
