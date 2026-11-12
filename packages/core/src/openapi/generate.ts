import {
  newId,
  type ApiModel,
  type Auth,
  type Body,
  type KeyValue,
  type OpenApiOperation,
  type OpenApiParam,
  type OpenApiSecurityScheme,
  type RequestDefinition,
} from '@postguy/shared';
import { sampleFromSchema } from './sample.ts';

export interface GeneratedRequest {
  def: RequestDefinition;
  description: string | null;
  operationId: string;
  fingerprint: string;
}

export interface GeneratedFolder {
  name: string;
  description: string | null;
  requests: GeneratedRequest[];
}

export interface GeneratedCollection {
  name: string;
  description: string | null;
  auth: Auth;
  variables: { key: string; value: string; isSecret: boolean }[];
  folders: GeneratedFolder[];
  requests: GeneratedRequest[];
}

/** Stable 53-bit string hash (cyrb53) as hex. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Fingerprint of the generated fields; ignores row ids so it is stable across imports. */
export function fingerprintRequest(def: RequestDefinition): string {
  const strip = (list: KeyValue[]) => list.map(({ key, value, enabled }) => [key, value, enabled]);
  return hashString(
    JSON.stringify({
      m: def.method,
      u: def.url,
      p: strip(def.params),
      pp: strip(def.pathParams),
      h: strip(def.headers),
      a: def.auth,
      b: { ...def.body, form: def.body.form ? strip(def.body.form) : undefined },
    }),
  );
}

const SKIP_HEADERS = new Set(['accept', 'content-type', 'authorization']);

function paramValue(p: OpenApiParam): string {
  const v = p.example ?? (p.schema as Record<string, unknown> | undefined)?.default ?? (p.schema ? sampleFromSchema(p.schema) : '');
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v === 'string' && !p.example ? '' : v;
  return Array.isArray(v) ? v.map(String).join(',') : String(v);
}

function kv(p: OpenApiParam, enabled: boolean): KeyValue {
  return { id: newId(8), key: p.name, value: paramValue(p), enabled, description: p.description };
}

function authForScheme(s: OpenApiSecurityScheme | undefined): { auth: Auth; variables: { key: string; value: string; isSecret: boolean }[] } {
  if (!s) return { auth: { type: 'none' }, variables: [] };
  if (s.type === 'http' && s.scheme === 'basic')
    return {
      auth: { type: 'basic', username: '{{username}}', password: '{{password}}' },
      variables: [
        { key: 'username', value: '', isSecret: false },
        { key: 'password', value: '', isSecret: true },
      ],
    };
  if (s.type === 'http')
    return { auth: { type: 'bearer', token: '{{accessToken}}' }, variables: [{ key: 'accessToken', value: '', isSecret: true }] };
  if (s.type === 'apiKey' && (s.in === 'header' || s.in === 'query'))
    return {
      auth: { type: 'apikey', key: s.paramName ?? 'X-API-Key', value: '{{apiKey}}', in: s.in },
      variables: [{ key: 'apiKey', value: '', isSecret: true }],
    };
  if (s.type === 'oauth2' || s.type === 'openIdConnect')
    return {
      auth: {
        type: 'oauth2',
        grantType: 'client_credentials',
        tokenUrl: s.tokenUrl ?? '',
        clientId: '{{clientId}}',
        clientSecret: '{{clientSecret}}',
        accessToken: '{{accessToken}}',
      },
      variables: [
        { key: 'clientId', value: '', isSecret: false },
        { key: 'clientSecret', value: '', isSecret: true },
        { key: 'accessToken', value: '', isSecret: true },
      ],
    };
  return { auth: { type: 'none' }, variables: [] };
}

function bodyFor(op: OpenApiOperation): Body {
  const rb = op.requestBody;
  if (!rb) return { mode: 'none' };
  const sample = rb.example ?? sampleFromSchema(rb.schema);
  if (/json/i.test(rb.contentType)) return { mode: 'json', raw: JSON.stringify(sample ?? {}, null, 2) };
  if (/x-www-form-urlencoded|multipart\/form-data/i.test(rb.contentType)) {
    const obj = sample && typeof sample === 'object' && !Array.isArray(sample) ? (sample as Record<string, unknown>) : {};
    const form = Object.entries(obj).map(([key, value]) => ({
      id: newId(8),
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      enabled: true,
    }));
    return { mode: /multipart/i.test(rb.contentType) ? 'form' : 'urlencoded', form };
  }
  return { mode: 'text', raw: typeof sample === 'string' ? sample : '', contentType: rb.contentType };
}

export function requestFromOperation(
  op: OpenApiOperation,
  model: ApiModel,
  collectionScheme: string | null,
): GeneratedRequest {
  const schemes = new Map(model.securitySchemes.map((s) => [s.name, s]));
  let auth: Auth = { type: 'inherit' };
  if (op.security.length === 0 && (model.globalSecurity.length > 0 || collectionScheme)) auth = { type: 'none' };
  else if (op.security.length && op.security[0] !== collectionScheme) auth = authForScheme(schemes.get(op.security[0]!)).auth;

  const def: RequestDefinition = {
    name: op.summary?.trim() || op.id,
    method: op.method,
    url: `{{baseUrl}}${op.path.replace(/\{([^}]+)\}/g, ':$1')}`,
    params: op.params.filter((p) => p.in === 'query').map((p) => kv(p, p.required)),
    pathParams: op.params.filter((p) => p.in === 'path').map((p) => kv(p, true)),
    headers: op.params.filter((p) => p.in === 'header' && !SKIP_HEADERS.has(p.name.toLowerCase())).map((p) => kv(p, p.required)),
    auth,
    body: bodyFor(op),
    settings: {},
    scripts: { pre: '', post: '' },
  };
  const description = [op.description, op.deprecated ? '**Deprecated**' : ''].filter(Boolean).join('\n\n') || null;
  return { def, description, operationId: op.id, fingerprint: fingerprintRequest(def) };
}

/** Builds a collection with one folder per tag from a normalized spec. */
export function generateCollection(model: ApiModel): GeneratedCollection {
  const usedSchemes = [...model.globalSecurity, ...model.operations.flatMap((o) => o.security)];
  const collectionScheme =
    model.globalSecurity[0] ?? usedSchemes[0] ?? (model.securitySchemes.length === 1 ? model.securitySchemes[0]!.name : null);
  const { auth, variables } = authForScheme(model.securitySchemes.find((s) => s.name === collectionScheme));
  const extraVars = new Map(variables.map((v) => [v.key, v]));
  for (const name of new Set(usedSchemes)) {
    if (name === collectionScheme) continue;
    for (const v of authForScheme(model.securitySchemes.find((s) => s.name === name)).variables) if (!extraVars.has(v.key)) extraVars.set(v.key, v);
  }

  const order = model.tags.map((t) => t.name);
  const folders = new Map<string, GeneratedFolder>();
  const root: GeneratedRequest[] = [];
  for (const op of model.operations) {
    const req = requestFromOperation(op, model, collectionScheme);
    const tag = op.tags[0];
    if (!tag) {
      root.push(req);
      continue;
    }
    if (!folders.has(tag)) {
      folders.set(tag, { name: tag, description: model.tags.find((t) => t.name === tag)?.description ?? null, requests: [] });
      if (!order.includes(tag)) order.push(tag);
    }
    folders.get(tag)!.requests.push(req);
  }

  return {
    name: model.title,
    description: model.description ?? null,
    auth,
    variables: [{ key: 'baseUrl', value: model.servers[0]?.url || 'http://localhost', isSecret: false }, ...extraVars.values()],
    folders: order.filter((t) => folders.has(t)).map((t) => folders.get(t)!),
    requests: root,
  };
}
