import { HTTP_METHODS, newId, type Auth, type Body, type CollectionExport, type ExportedCollection, type HttpMethod, type KeyValue } from '@postguy/shared';

type Obj = Record<string, any>;

/** A recorded response to remember for an imported request, keyed by the request's `ref`. */
export interface HarResponse {
  ref: string;
  status: number;
  contentType: string | null;
  body: string;
}

export interface HarImport {
  collection: CollectionExport;
  responses: HarResponse[];
  warnings: string[];
}

export function isHar(data: unknown): boolean {
  const log = (data as Obj | null)?.log;
  return !!log && typeof log === 'object' && Array.isArray(log.entries);
}

const API_MIME = /json|xml|text\/plain|graphql|x-www-form-urlencoded|grpc|protobuf|event-stream/i;
const API_TYPES = new Set(['xhr', 'fetch']);
/** Headers a browser adds or that only make sense for the recorded connection. */
const DROP_HEADERS = new Set([
  'host', 'content-length', 'connection', 'keep-alive', 'cookie', 'accept-encoding', 'priority', 'te', 'upgrade-insecure-requests',
  'user-agent', 'referer', 'pragma', 'cache-control', 'dnt',
]);

const kv = (key: string, value: string): KeyValue => ({ id: newId(8), key, value, enabled: true });

function isApiCall(e: Obj): boolean {
  const type = typeof e._resourceType === 'string' ? e._resourceType.toLowerCase() : null;
  const mime = String(e.response?.content?.mimeType ?? '');
  if (type) return API_TYPES.has(type) || (type === 'other' && API_MIME.test(mime));
  return API_MIME.test(mime) || String(e.request?.method ?? 'GET').toUpperCase() !== 'GET';
}

function header(list: Obj[], name: string): string | undefined {
  return list.find((h) => String(h.name).toLowerCase() === name)?.value;
}

function body(post: Obj | undefined, notes: { files: string[] }, name: string): Body {
  if (!post) return { mode: 'none' };
  const mime = String(post.mimeType ?? '').toLowerCase();
  const text: string = typeof post.text === 'string' ? post.text : '';
  const params: Obj[] = Array.isArray(post.params) ? post.params : [];
  if (/multipart\/form-data/.test(mime)) {
    const fields = params.filter((p) => {
      if (p.fileName) notes.files.push(`${name} (${p.name})`);
      return !p.fileName;
    });
    return { mode: 'form', form: fields.map((p) => kv(String(p.name), String(p.value ?? ''))) };
  }
  if (/x-www-form-urlencoded/.test(mime)) {
    const pairs = params.length
      ? params.map((p) => [String(p.name), String(p.value ?? '')] as const)
      : [...new URLSearchParams(text).entries()];
    return { mode: 'urlencoded', form: pairs.map(([k, v]) => kv(k, v)) };
  }
  if (!text) return { mode: 'none' };
  if (/json/.test(mime)) {
    try {
      return { mode: 'json', raw: JSON.stringify(JSON.parse(text), null, 2) };
    } catch {
      return { mode: 'json', raw: text };
    }
  }
  return { mode: 'text', raw: text, ...(mime && { contentType: post.mimeType }) };
}

function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}

/**
 * Turns a HAR recording (browser DevTools → Save all as HAR) into a collection of its API calls.
 * Pages and assets are skipped, repeated calls collapse, the origin becomes `{{baseUrl}}` (a folder
 * per host when there are several), and a bearer token moves into a secret `{{token}}` variable.
 */
export function harToCollection(data: unknown, opts: { name?: string } = {}): HarImport {
  const log = (data as Obj).log as Obj;
  const entries: Obj[] = log.entries;
  const notes = { files: [] as string[] };
  let skipped = 0;
  let duplicates = 0;
  let cookies = 0;
  let otherAuth = 0;
  let token: string | null = null;
  const tokens = new Set<string>();
  const seen = new Set<string>();
  const byOrigin = new Map<string, ExportedCollection['requests']>();
  const responses: HarResponse[] = [];

  entries.forEach((e, i) => {
    const req = e.request ?? {};
    let url: URL;
    try {
      url = new URL(String(req.url));
    } catch {
      skipped++;
      return;
    }
    const method = String(req.method ?? 'GET').toUpperCase();
    if (!/^https?:$/.test(url.protocol) || !(HTTP_METHODS as readonly string[]).includes(method) || !isApiCall(e)) {
      skipped++;
      return;
    }
    const key = `${method} ${url.href} ${req.postData?.text ?? ''}`;
    if (seen.has(key)) {
      duplicates++;
      return;
    }
    seen.add(key);

    const name = `${method} ${decodeURIComponent(url.pathname)}`.slice(0, 120);
    const rawHeaders: Obj[] = Array.isArray(req.headers) ? req.headers : [];
    if (rawHeaders.some((h) => String(h.name).toLowerCase() === 'cookie')) cookies++;
    const authorization = header(rawHeaders, 'authorization');
    const bearer = authorization && /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
    if (bearer) {
      token ??= bearer;
      tokens.add(bearer);
    } else if (authorization) {
      otherAuth++;
    }
    const multipart = /multipart\/form-data/i.test(String(req.postData?.mimeType ?? ''));
    const headers = rawHeaders
      .filter((h) => {
        const n = String(h.name).toLowerCase();
        if (n.startsWith(':') || n.startsWith('sec-') || DROP_HEADERS.has(n)) return false;
        if (n === 'authorization' && bearer) return false;
        if (n === 'content-type' && multipart) return false;
        return true;
      })
      .map((h) => kv(String(h.name), String(h.value ?? '')));

    const ref = `har-${i}`;
    const list = byOrigin.get(url.origin) ?? [];
    list.push({
      ref,
      name,
      description: null,
      method: method as HttpMethod,
      url: `{{baseUrl}}${url.pathname}`,
      params: [...url.searchParams.entries()].map(([k, v]) => kv(k, v)),
      pathParams: [],
      headers,
      auth: { type: 'inherit' },
      body: body(req.postData, notes, name),
      settings: {},
      scripts: { pre: '', post: '' },
    });
    byOrigin.set(url.origin, list);

    const content = e.response?.content;
    const status = Number(e.response?.status);
    if (content && typeof content.text === 'string' && content.encoding !== 'base64' && status > 0)
      responses.push({ ref, status, contentType: content.mimeType ?? null, body: content.text });
  });

  if (!byOrigin.size)
    throw new Error(`No API calls found in this HAR: ${plural(entries.length, 'entry')}, all pages, scripts, styles, images or other assets.`);

  const origins = [...byOrigin.keys()];
  const title = opts.name?.trim() || String(log.pages?.[0]?.title ?? '').trim() || `Recorded ${new URL(origins[0]!).host}`;
  const root: ExportedCollection = {
    name: title.slice(0, 120),
    description: `Imported from a HAR recording${log.creator?.name ? ` made with ${log.creator.name}` : ''}.`,
    auth: token ? { type: 'bearer', token: '{{token}}' } : { type: 'none' },
    variables: [
      ...(origins.length === 1 ? [{ key: 'baseUrl', value: origins[0]!, isSecret: false }] : []),
      ...(token ? [{ key: 'token', value: token, isSecret: true }] : []),
    ],
    folders:
      origins.length === 1
        ? []
        : origins.map((o) => ({
            name: new URL(o).host,
            description: null,
            auth: { type: 'inherit' } as Auth,
            variables: [{ key: 'baseUrl', value: o, isSecret: false }],
            folders: [],
            requests: byOrigin.get(o)!,
          })),
    requests: origins.length === 1 ? byOrigin.get(origins[0]!)! : [],
  };

  const kept = origins.reduce((n, o) => n + byOrigin.get(o)!.length, 0);
  const warnings = [
    `Imported ${plural(kept, 'API call')}${origins.length > 1 ? ` from ${origins.length} hosts, one folder each` : ''}.`,
    ...(skipped ? [`Skipped ${plural(skipped, 'entry')} that ${skipped === 1 ? "isn't an API call" : "aren't API calls"} (pages, scripts, styles, images, fonts).`] : []),
    ...(duplicates ? [`Collapsed ${plural(duplicates, 'repeated call')}.`] : []),
    ...(token
      ? [`The recorded bearer token is in the secret collection variable {{token}}${tokens.size > 1 ? ' (the first of several)' : ''}; it has probably expired, so replace it.`]
      : []),
    ...(otherAuth ? [`${plural(otherAuth, 'request')} kept a non-bearer Authorization header as recorded.`] : []),
    ...(cookies ? [`Cookie headers were not imported (${plural(cookies, 'request')}); the cookie jar collects cookies as you send.`] : []),
    ...(notes.files.length ? [`File fields aren't in HAR recordings, so they were left out: ${notes.files.slice(0, 3).join(', ')}${notes.files.length > 3 ? '…' : ''}.`] : []),
  ];
  return { collection: { format: 'postguy-collection', version: 1, collection: root }, responses, warnings };
}
