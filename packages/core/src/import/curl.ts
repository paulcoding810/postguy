import { HTTP_METHODS, newId, type Auth, type Body, type HttpMethod, type KeyValue, type RequestDefinition } from '@postguy/shared';
import type { ResolvedRequest } from '../http/request.ts';

export class CurlParseError extends Error {}

export interface CurlParseResult {
  request: RequestDefinition;
  warnings: string[];
}

/** Undoes cmd.exe escaping from "Copy as cURL (cmd)": ^" ^\ ^% and ^ line continuations. */
function unescapeCmd(input: string): string {
  return input.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1');
}

/** Splits a shell command into words: '…', "…", $'…', backslash escapes and line continuations. */
export function shellSplit(input: string): string[] {
  let src = input.replace(/\\\r?\n/g, ' ').replace(/`\r?\n/g, ' ');
  if (/\^"/.test(src) || /\^\r?\n/.test(input)) src = unescapeCmd(src);
  const words: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  const push = () => {
    if (has) words.push(cur);
    cur = '';
    has = false;
  };
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      push();
      i++;
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end === -1) throw new CurlParseError('Unclosed single quote');
      cur += src.slice(i + 1, end);
      has = true;
      i = end + 1;
    } else if (c === '$' && src[i + 1] === "'") {
      i += 2;
      has = true;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\' && i + 1 < src.length) {
          const n = src[i + 1]!;
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0' };
          if (n === 'x') {
            cur += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16));
            i += 4;
          } else if (n === 'u') {
            cur += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
            i += 6;
          } else {
            cur += map[n] ?? n;
            i += 2;
          }
        } else cur += src[i++];
      }
      if (i >= src.length) throw new CurlParseError("Unclosed $'…' string");
      i++;
    } else if (c === '"') {
      i++;
      has = true;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length && '"\\$`'.includes(src[i + 1]!)) {
          cur += src[i + 1];
          i += 2;
        } else cur += src[i++];
      }
      if (i >= src.length) throw new CurlParseError('Unclosed double quote');
      i++;
    } else if (c === '\\' && i + 1 < src.length) {
      cur += src[i + 1];
      has = true;
      i += 2;
    } else {
      cur += c;
      has = true;
      i++;
    }
  }
  push();
  return words;
}

const VALUE_FLAGS: Record<string, string> = {
  '-X': 'request', '--request': 'request',
  '-H': 'header', '--header': 'header',
  '-d': 'data', '--data': 'data', '--data-ascii': 'data', '--data-binary': 'data-binary', '--data-raw': 'data-raw', '--data-urlencode': 'data-urlencode',
  '--json': 'json',
  '-F': 'form', '--form': 'form', '--form-string': 'form-string',
  '-u': 'user', '--user': 'user',
  '-b': 'cookie', '--cookie': 'cookie',
  '-A': 'user-agent', '--user-agent': 'user-agent',
  '-e': 'referer', '--referer': 'referer',
  '--url': 'url',
  '-m': 'max-time', '--max-time': 'max-time',
  '--oauth2-bearer': 'bearer',
  '-x': 'proxy', '--proxy': 'proxy',
  '-T': 'upload', '--upload-file': 'upload',
};
const IGNORED_VALUE_FLAGS = new Set([
  '-o', '--output', '-w', '--write-out', '-c', '--cookie-jar', '-D', '--dump-header', '--cacert', '--capath', '--cert', '-E', '--key', '--cert-type', '--key-type',
  '--resolve', '--connect-to', '--limit-rate', '--max-redirs', '-r', '--range', '-U', '--proxy-user', '--interface', '--local-port', '--retry', '--retry-delay',
  '--retry-max-time', '--connect-timeout', '--unix-socket', '--abstract-unix-socket', '--variable', '-K', '--config', '--trace', '--trace-ascii', '--stderr',
  '-y', '--speed-time', '-Y', '--speed-limit', '--expect100-timeout', '--happy-eyeballs-timeout-ms', '-z', '--time-cond', '--ciphers', '--tls-max', '--noproxy',
]);
const BOOL_FLAGS: Record<string, string> = {
  '-G': 'get', '--get': 'get', '-I': 'head', '--head': 'head', '-k': 'insecure', '--insecure': 'insecure', '-L': 'location', '--location': 'location',
};

function kv(key: string, value: string, enabled = true): KeyValue {
  return { id: newId(8), key, value, enabled };
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function splitPairs(qs: string): KeyValue[] {
  return qs
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      return i === -1 ? kv(decode(pair), '') : kv(decode(pair.slice(0, i)), decode(pair.slice(i + 1)));
    });
}

function header(headers: KeyValue[], name: string): KeyValue | undefined {
  return headers.find((h) => h.key.toLowerCase() === name.toLowerCase());
}

/** Converts a cURL command (bash, zsh, cmd or PowerShell continuations) into a request definition. */
export function parseCurl(command: string): CurlParseResult {
  const words = shellSplit(command.trim());
  const start = words.findIndex((w) => /(^|[\\/])curl(\.exe)?$/i.test(w));
  if (start === -1) throw new CurlParseError('This does not look like a cURL command');
  const warnings: string[] = [];
  const opts: Record<string, string[]> = {};
  const flags = new Set<string>();
  let url: string | null = null;

  const add = (k: string, v: string) => (opts[k] ??= []).push(v);
  for (let i = start + 1; i < words.length; i++) {
    const w = words[i]!;
    if (w.startsWith('-') && w !== '-') {
      const take = () => {
        if (i + 1 >= words.length) throw new CurlParseError(`Missing value for ${w}`);
        return words[++i]!;
      };
      if (VALUE_FLAGS[w]) add(VALUE_FLAGS[w]!, take());
      else if (BOOL_FLAGS[w]) flags.add(BOOL_FLAGS[w]!);
      else if (IGNORED_VALUE_FLAGS.has(w)) take();
      else if (/^-[A-Za-z]./.test(w) && !w.startsWith('--')) {
        const short = w.slice(0, 2);
        if (VALUE_FLAGS[short]) add(VALUE_FLAGS[short]!, w.slice(2));
        else if (IGNORED_VALUE_FLAGS.has(short)) continue;
        else for (const ch of w.slice(1)) if (BOOL_FLAGS[`-${ch}`]) flags.add(BOOL_FLAGS[`-${ch}`]!);
      } else if (!/^--?(s|S|v|i|N|f|-silent|-show-error|-verbose|-include|-compressed|-no-buffer|-fail|-fail-with-body|-globoff|-http1\.1|-http2|-http2-prior-knowledge|-http3|-ipv4|-ipv6|-path-as-is|-raw|-tr-encoding|-progress-bar|-no-progress-meter|-ssl|-ssl-reqd|-location-trusted|-negotiate|-ntlm|-digest|-basic|-anyauth|-tcp-nodelay|-no-keepalive|-styled-output|-no-styled-output)$/.test(w))
        warnings.push(`Ignored option ${w}`);
    } else if (url === null) url = w;
    else warnings.push(`Ignored extra argument ${w}`);
  }
  url = opts.url?.at(-1) ?? url;
  if (!url) throw new CurlParseError('The cURL command has no URL');

  const headers: KeyValue[] = [];
  for (const h of opts.header ?? []) {
    const i = h.indexOf(':');
    if (i > 0) headers.push(kv(h.slice(0, i).trim(), h.slice(i + 1).trim()));
    else if (h.endsWith(';')) headers.push(kv(h.slice(0, -1).trim(), ''));
    else warnings.push(`Ignored malformed header "${h}"`);
  }
  if (opts['user-agent']) headers.push(kv('User-Agent', opts['user-agent'].at(-1)!));
  if (opts.referer) headers.push(kv('Referer', opts.referer.at(-1)!));
  for (const c of opts.cookie ?? []) {
    if (c.includes('=')) headers.push(kv('Cookie', c));
    else warnings.push(`Cookie file ${c} was not read`);
  }
  if (opts.proxy) warnings.push('Proxy settings are not supported and were ignored');
  if (opts.upload) warnings.push(`Upload of file ${opts.upload.at(-1)} is not supported`);

  const dataParts: string[] = [];
  const raw = [...(opts.data ?? []), ...(opts['data-binary'] ?? [])];
  let binaryFile: string | null = null;
  for (const d of raw) {
    if (d.startsWith('@') && opts['data-binary']?.includes(d) && raw.length === 1) binaryFile = d.slice(1);
    else if (d.startsWith('@')) warnings.push(`Data file ${d.slice(1)} was not read`);
    else dataParts.push(d.replace(/[\r\n]+/g, opts['data-binary']?.includes(d) ? '\n' : ''));
  }
  dataParts.push(...(opts['data-raw'] ?? []));
  for (const d of opts['data-urlencode'] ?? []) {
    const eq = d.indexOf('=');
    const at = d.indexOf('@');
    if (at !== -1 && (eq === -1 || at < eq)) warnings.push(`Data file ${d.slice(at + 1)} was not read`);
    else if (eq === -1) dataParts.push(encodeURIComponent(d));
    else dataParts.push(`${d.slice(0, eq)}${eq > 0 ? '=' : ''}${encodeURIComponent(d.slice(eq + 1))}`);
  }
  const json = opts.json ?? [];
  if (json.length) {
    dataParts.push(...json);
    if (!header(headers, 'content-type')) headers.push(kv('Content-Type', 'application/json'));
    if (!header(headers, 'accept')) headers.push(kv('Accept', 'application/json'));
  }

  let method: string = (opts.request?.at(-1) ?? '').toUpperCase();
  const hasForm = (opts.form?.length ?? 0) + (opts['form-string']?.length ?? 0) > 0;
  if (!method) method = flags.has('head') ? 'HEAD' : flags.has('get') ? 'GET' : dataParts.length || hasForm || binaryFile ? 'POST' : 'GET';
  if (!(HTTP_METHODS as readonly string[]).includes(method)) {
    warnings.push(`Method ${method} is not supported; using GET`);
    method = 'GET';
  }

  const qIndex = url.indexOf('?');
  let base = qIndex === -1 ? url : url.slice(0, qIndex);
  const params = qIndex === -1 ? [] : splitPairs(url.slice(qIndex + 1).split('#')[0]!);
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(base) && !base.startsWith('{{')) base = `http://${base}`;

  let body: Body = { mode: 'none' };
  const contentType = header(headers, 'content-type')?.value ?? '';
  const data = dataParts.join('&');
  if (flags.has('get') && dataParts.length) params.push(...splitPairs(data));
  else if (binaryFile && !dataParts.length) {
    const ct = header(headers, 'content-type');
    body = { mode: 'binary', src: binaryFile, ...(ct && { contentType: ct.value }) };
    if (ct) headers.splice(headers.indexOf(ct), 1);
  } else if (hasForm) {
    const form: KeyValue[] = [];
    for (const f of [...(opts.form ?? []), ...(opts['form-string'] ?? [])]) {
      const i = f.indexOf('=');
      if (i <= 0) continue;
      const value = f.slice(i + 1);
      if (opts.form?.includes(f) && value.startsWith('@'))
        form.push({ ...kv(f.slice(0, i), ''), type: 'file', src: value.slice(1).replace(/;(type|filename|headers)=.*$/, '').replace(/^"(.*)"$/, '$1') });
      else if (opts.form?.includes(f) && value.startsWith('<')) warnings.push(`File field ${f.slice(0, i)} was not attached`);
      else form.push(kv(f.slice(0, i), value.replace(/^"(.*)"$/, '$1')));
    }
    body = { mode: 'form', form };
    const ct = header(headers, 'content-type');
    if (ct) headers.splice(headers.indexOf(ct), 1);
  } else if (dataParts.length) {
    const looksJson = /^\s*[[{]/.test(data);
    if (/json/i.test(contentType) || (!contentType && looksJson)) {
      let pretty = data;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
        pretty = JSON.stringify(parsed, null, 2);
      } catch {
        /* keep as sent */
      }
      const gql = graphqlPayload(parsed);
      body = gql ?? { mode: 'json', raw: pretty, ...(contentType && !/^application\/json\b/i.test(contentType) ? { contentType } : {}) };
      if (/^application\/json\b/i.test(contentType)) headers.splice(headers.findIndex((h) => h.key.toLowerCase() === 'content-type'), 1);
    } else if ((!contentType || /x-www-form-urlencoded/i.test(contentType)) && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(data)) {
      body = { mode: 'urlencoded', form: splitPairs(data) };
      if (contentType) headers.splice(headers.findIndex((h) => h.key.toLowerCase() === 'content-type'), 1);
    } else body = { mode: 'text', raw: data, contentType: contentType || 'application/x-www-form-urlencoded' };
  }

  let auth: Auth = { type: 'none' };
  const authHeader = header(headers, 'authorization');
  const user = opts.user?.at(-1);
  if (opts.bearer?.length) auth = { type: 'bearer', token: opts.bearer.at(-1)! };
  else if (user) {
    const i = user.indexOf(':');
    auth = { type: 'basic', username: i === -1 ? user : user.slice(0, i), password: i === -1 ? '' : user.slice(i + 1) };
  } else if (authHeader) {
    const bearer = /^Bearer\s+(.+)$/i.exec(authHeader.value);
    const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(authHeader.value);
    if (bearer) auth = { type: 'bearer', token: bearer[1]! };
    else if (basic) {
      try {
        const decoded = new TextDecoder().decode(Uint8Array.from(atob(basic[1]!), (c) => c.charCodeAt(0)));
        const i = decoded.indexOf(':');
        if (i !== -1) auth = { type: 'basic', username: decoded.slice(0, i), password: decoded.slice(i + 1) };
      } catch {
        /* keep the header */
      }
    }
    if (auth.type !== 'none') headers.splice(headers.indexOf(authHeader), 1);
  }

  const settings: RequestDefinition['settings'] = {};
  if (flags.has('insecure')) settings.rejectUnauthorized = false;
  const maxTime = Number(opts['max-time']?.at(-1));
  if (maxTime > 0) settings.timeoutMs = Math.round(maxTime * 1000);

  let name = `${method} ${base}`;
  try {
    const u = new URL(base.replace(/\{\{[^}]+\}\}/g, 'x'));
    name = `${method} ${u.pathname === '/' ? u.host : u.pathname}`;
  } catch {
    /* keep */
  }

  return {
    request: { name, method: method as HttpMethod, url: base, params, pathParams: [], headers, auth, body, settings, scripts: { pre: '', post: '' } },
    warnings,
  };
}

/** A JSON body of the form { query, variables?, operationName? } is a GraphQL request. */
function graphqlPayload(v: unknown): Body | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.query !== 'string' || !Object.keys(o).every((k) => ['query', 'variables', 'operationName', 'extensions'].includes(k))) return null;
  if (!/^\s*(?:query|mutation|subscription|fragment|\{)/.test(o.query)) return null;
  return {
    mode: 'graphql',
    raw: o.query,
    ...(o.variables && typeof o.variables === 'object' && Object.keys(o.variables as object).length > 0 ? { variables: JSON.stringify(o.variables, null, 2) } : {}),
    ...(typeof o.operationName === 'string' && o.operationName && { operationName: o.operationName }),
  };
}

const quote = (s: string) => (/^[A-Za-z0-9_\-./:=@%+,]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** Renders a resolved request as a bash cURL command, one option per line. */
export function toCurl(req: ResolvedRequest, opts: { insecure?: boolean } = {}): string {
  const groups: string[] = [];
  let first = 'curl';
  if (req.method === 'HEAD') first += ' -I';
  else if (req.method !== 'GET' || req.body.content !== null) first += ` -X ${req.method}`;
  groups.push(`${first} ${quote(req.url)}`);
  const { multipart, file } = req.body;
  for (const [k, v] of Object.entries(req.headers)) {
    if (multipart && k.toLowerCase() === 'content-type') continue;
    groups.push(`-H ${quote(`${k}: ${v}`)}`);
  }
  if (multipart)
    for (const p of multipart.parts)
      groups.push('file' in p ? `-F ${quote(`${p.name}=@${p.file}`)}` : `${/^[@<]/.test(p.value) ? '--form-string' : '-F'} ${quote(`${p.name}=${p.value}`)}`);
  else if (file) groups.push(`--data-binary ${quote(`@${file}`)}`);
  else if (req.body.content !== null && req.body.content !== '') groups.push(`--data-raw ${quote(req.body.content)}`);
  if (opts.insecure) groups.push('-k');
  return groups.join(' \\\n  ');
}

/** The request as a JavaScript fetch call, for browsers and Node 18+. */
export function toFetch(req: ResolvedRequest, opts: { insecure?: boolean } = {}): string {
  const lit = (v: string) => JSON.stringify(v);
  const { multipart, file } = req.body;
  const headers = Object.entries(req.headers).filter(([k]) => !(multipart && k.toLowerCase() === 'content-type'));
  const pre: string[] = [];
  const init: string[] = [];
  if (req.method !== 'GET') init.push(`method: ${lit(req.method)},`);
  if (headers.length) init.push('headers: {', ...headers.map(([k, v]) => `  ${lit(k)}: ${lit(v)},`), '},');
  if (multipart) {
    pre.push('const form = new FormData();');
    for (const p of multipart.parts)
      pre.push('file' in p ? `form.append(${lit(p.name)}, /* the file ${p.file}, e.g. */ new Blob([]), ${lit(p.file.split(/[\\/]/).pop() ?? p.file)});` : `form.append(${lit(p.name)}, ${lit(p.value)});`);
    init.push('body: form,');
  } else if (file) {
    init.push(`body: /* the contents of ${file} */ null,`);
  } else if (req.body.content !== null && req.body.content !== '') {
    const type = Object.entries(req.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? req.body.contentType ?? '';
    let json: unknown;
    let isJson = false;
    if (/json/i.test(type)) {
      try {
        json = JSON.parse(req.body.content);
        isJson = typeof json === 'object' && json !== null;
      } catch {
        /* send as written */
      }
    }
    if (isJson) {
      const [first, ...rest] = JSON.stringify(json, null, 2).split('\n');
      init.push(`body: JSON.stringify(${first}`, ...rest.slice(0, -1), `${rest.at(-1) ?? ''}),`);
    } else init.push(`body: ${lit(req.body.content)},`);
  }
  const call = init.length ? `fetch(${lit(req.url)}, {\n${init.map((l) => `  ${l}`).join('\n')}\n})` : `fetch(${lit(req.url)})`;
  return [
    ...(opts.insecure ? ["// Postguy doesn't check this server's TLS certificate; fetch always does."] : []),
    ...pre,
    `const response = await ${call};`,
  ].join('\n');
}
