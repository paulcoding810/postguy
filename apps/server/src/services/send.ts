import {
  cookieHeader,
  parseSetCookies,
  redactHeaders,
  redactText,
  resolveRequest,
  resolveTemplate,
  resolveValue,
  runScript,
  suggestTokenRef,
  type EmptyAuth,
  type ResolutionContext,
  type ResolvedRequest,
  type ResponseRecord,
  type ScriptHost,
} from '@postguy/core';
import {
  HTTP_METHODS,
  newId,
  SendInput,
  type KeyValue,
  type RequestDefinition,
  type ScriptRequest,
  type ScriptResponse,
  type ScriptRun,
  type Scripts,
  type EmptyAuthWarning,
  type SendResult,
} from '@postguy/shared';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { requestHistory } from '../db/schema.ts';
import { ancestry, effectiveAuth, rootOf } from './collections.ts';
import { loadBodyFiles } from './bodyFiles.ts';
import { buildContext } from './context.ts';
import { globalEnvironment } from './environments.ts';
import { cookieHeaderFor, cookiesFor, storeSetCookies } from './cookies.ts';
import { executeHttp, isTextual, type CookieHooks } from './http.ts';
import { recordSnapshot, referenceSources, snapshotLookup, validateResponse } from './memory.ts';
import { afterSend } from './maintenance.ts';
import { exchangeToken, needsTokenExchange } from './oauth.ts';
import { getRequest } from './requests.ts';
import { loadScripts } from './scripts.ts';
import { listVariables, replaceVariables, setVariable } from './variables.ts';
import { withSource } from './changelog.ts';
import { effectiveSettings, trustHostOf } from './settings.ts';

export const HISTORY_BODY_LIMIT = 5 * 1024 * 1024;
export const SCRIPT_TIMEOUT_MS = 2000;

export interface SendOptions {
  signal?: AbortSignal;
  /** Response lookup for references; flows pass only their current run's responses. */
  responses?: (name: string) => ResponseRecord | undefined;
  flowId?: string | null;
  /** Do not send when a reference cannot be resolved. */
  failOnUnresolved?: boolean;
  /** Values set with `flow.set`; the highest-precedence variables. A flow shares one map across its steps. */
  runtime?: Map<string, unknown>;
  /** Scripts that run after the request's own, e.g. a flow step's. */
  extraScripts?: Scripts;
  /** The name `flow.response(name)` uses for the current response in post scripts; defaults to the request name. */
  selfName?: string;
  /** Recorded in history; 'mcp' when Claude sent it. */
  source?: 'mcp';
  /** Last check before sending; returning an error stops the request (e.g. a secret going to an unknown host). */
  guard?: (request: ResolvedRequest, usedSecrets: string[]) => { code: string; message: string } | null;
}

function queryString(params: KeyValue[]): string {
  return params
    .filter((p) => p.enabled && p.key)
    .map((p) => (p.value === '' ? p.key : `${p.key}=${p.value}`))
    .join('&');
}

function toScriptRequest(def: RequestDefinition): ScriptRequest {
  const qs = queryString(def.params);
  const headers: Record<string, string> = {};
  for (const h of def.headers) if (h.enabled && h.key) headers[h.key] = h.value;
  return {
    method: def.method,
    url: qs ? `${def.url}${def.url.includes('?') ? '&' : '?'}${qs}` : def.url,
    headers,
    body:
      def.body.mode === 'json' || def.body.mode === 'text'
        ? (def.body.raw ?? '')
        : def.body.mode === 'urlencoded'
          ? (def.body.form ?? []).filter((f) => f.enabled && f.key).map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`).join('&')
          : null,
    ...(def.body.mode === 'urlencoded' && { bodyMode: 'urlencoded' as const }),
    ...(def.body.mode === 'form' && {
      bodyMode: 'formdata' as const,
      formdata: (def.body.form ?? [])
        .filter((f) => f.enabled && f.key)
        .map((f) => (f.type === 'file' ? { key: f.key, value: '', type: 'file' as const, src: f.src ?? '' } : { key: f.key, value: f.value })),
    }),
    ...(def.body.mode === 'binary' && def.body.src && { bodyMode: 'file' as const, file: { src: def.body.src } }),
  };
}

/** Folds a pre-request script's edits back into the request definition. */
function applyScriptRequest(def: RequestDefinition, before: ScriptRequest, after: ScriptRequest): RequestDefinition {
  const next = { ...def };
  const method = String(after.method ?? def.method).toUpperCase();
  if (method !== def.method && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) next.method = method as RequestDefinition['method'];
  if (after.url !== before.url) {
    next.url = String(after.url ?? '');
    next.params = [];
  }
  if (JSON.stringify(after.headers) !== JSON.stringify(before.headers)) {
    next.headers = Object.entries(after.headers ?? {}).map(([key, value]) => ({
      id: newId(8),
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      enabled: true,
    }));
  }
  if (after.body !== before.body || (after.bodyMode ?? 'raw') !== (before.bodyMode ?? 'raw')) {
    if (after.body === null || after.body === undefined) next.body = { mode: 'none' };
    else if (after.bodyMode === 'urlencoded') {
      const decode = (s: string) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, ' '));
        } catch {
          return s;
        }
      };
      const form = String(after.body)
        .split('&')
        .filter(Boolean)
        .map((pair) => {
          const i = pair.indexOf('=');
          return { id: newId(8), key: decode(i < 0 ? pair : pair.slice(0, i)), value: i < 0 ? '' : decode(pair.slice(i + 1)), enabled: true };
        });
      next.body = { mode: 'urlencoded', form };
    } else {
      const raw = typeof after.body === 'string' ? after.body : JSON.stringify(after.body);
      const mode = def.body.mode === 'json' || def.body.mode === 'text' ? def.body.mode : /^\s*[[{]/.test(raw) ? 'json' : 'text';
      next.body = { ...def.body, mode, raw };
    }
  }
  return next;
}

/** Adds the jar's cookies to the request unless it sets its own Cookie header; returns the values sent, to mask in history. */
function cookieJarFor(db: Db, environmentId: string | null, def: RequestDefinition, request: ResolvedRequest): { hooks?: CookieHooks; sent: string[] } {
  if (def.settings.cookies === false) return { sent: [] };
  const store = (url: string, list: string[]) => storeSetCookies(db, environmentId, url, list);
  if (headerValue(request.headers, 'cookie') !== null) return { hooks: { store }, sent: [] };
  const sent = cookiesFor(db, environmentId, request.url);
  const header = cookieHeader(sent);
  if (header) request.headers = { ...request.headers, Cookie: header };
  return { hooks: { store, header: (url) => cookieHeaderFor(db, environmentId, url) }, sent: sent.map((c) => c.value).filter((v) => v.length >= 4) };
}

function runtimeVarMap(runtime: Map<string, unknown>) {
  const out: Record<string, { value: string }> = {};
  for (const [k, v] of runtime) out[k] = { value: typeof v === 'string' ? v : JSON.stringify(v) };
  return out;
}

function secretValues(ctx: ResolutionContext): string[] {
  const out: string[] = [];
  for (const v of ctx.variables.values()) if (v.secret && v.value) out.push(v.value);
  return out;
}

function parseBody(text: string, contentType: string | null): unknown {
  if (/json/i.test(contentType ?? '') || /^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      /* not JSON */
    }
  }
  return text;
}

export async function send(db: Db, input: z.output<typeof SendInput>, opts: SendOptions = {}): Promise<SendResult> {
  const saved = input.requestId ? getRequest(db, input.requestId) : null;
  const collectionId = input.collectionId ?? saved?.collectionId ?? null;
  const runtime = opts.runtime ?? new Map<string, unknown>();
  const context = () =>
    buildContext(db, {
      collectionId,
      requestId: saved?.id ?? null,
      environmentId: input.environmentId,
      flowId: opts.flowId,
      responses: opts.responses,
      runtime: runtimeVarMap(runtime),
    });
  const envTarget = () => {
    const env = context().environmentId;
    return env ? { scope: 'environment' as const, ownerId: env } : { scope: 'global' as const, ownerId: globalEnvironment(db).id };
  };
  let current: ScriptResponse | undefined;
  let answeredUrl: string | null = null;
  const selfName = (opts.selfName ?? input.request.name).toLowerCase();
  const host = (ctx: ResolutionContext): ScriptHost => ({
    response: (name) => {
      if (current && name.toLowerCase() === selfName) return current;
      const r = ctx.response(name);
      return r ? { status: r.status, headers: r.headers, body: r.body } : undefined;
    },
    get: (key) => {
      if (runtime.has(key)) return runtime.get(key);
      const v = ctx.variables.get(key);
      return v ? resolveValue(`{{${key}}}`, ctx).value : undefined;
    },
    set: (key, value) => {
      if (value === null) runtime.delete(key);
      else runtime.set(key, value);
    },
    cookies: () => {
      if (def.settings.cookies === false) return [];
      return cookiesFor(db, context().environmentId, answeredUrl ?? resolveTemplate(def.url, ctx).value);
    },
    envGet: (key) => (ctx.variables.has(key) ? resolveValue(`{{${key}}}`, ctx).value : undefined),
    envSet: (key, value, scope) => {
      const root = scope === 'collection' ? rootOf(db, collectionId) : null;
      const t = root
        ? { scope: 'collection' as const, ownerId: root.id }
        : scope === 'globals'
          ? { scope: 'global' as const, ownerId: globalEnvironment(db).id }
          : envTarget();
      if (value === null) {
        const rest = listVariables(db, t.scope, t.ownerId, true).filter((v) => v.key !== key);
        withSource('script', () => replaceVariables(db, t.scope, t.ownerId, rest.map(({ key: k, value: val, isSecret, enabled }) => ({ key: k, value: val, isSecret, enabled }))));
      } else withSource('script', () => setVariable(db, t.scope, t.ownerId, key, typeof value === 'string' ? value : JSON.stringify(value)));
    },
    sendRequest: (req) => scriptSend(req),
  });

  /** pm.sendRequest: sent like any request (variables, cookie jar, default settings, Claude's host lock), labelled "script" in history. */
  const scriptSend = async (req: ScriptRequest): Promise<ScriptResponse> => {
    const method = req.method.toUpperCase();
    if (!(HTTP_METHODS as readonly string[]).includes(method)) throw new Error(`Unsupported method ${req.method}`);
    if (!/^https?:\/\//i.test(req.url) && !/\{\{/.test(req.url)) throw new Error(`pm.sendRequest needs a full http(s) URL, not "${req.url}"`);
    const contentType = Object.entries(req.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
    const sdef: RequestDefinition = {
      name: 'pm.sendRequest',
      method: method as RequestDefinition['method'],
      url: req.url,
      params: [],
      pathParams: [],
      headers: Object.entries(req.headers).map(([key, value]) => ({ id: newId(8), key, value, enabled: true })),
      auth: { type: 'none' },
      body: req.body === null ? { mode: 'none' } : { mode: 'text', raw: req.body, contentType: contentType ?? 'text/plain' },
      settings: {},
      scripts: { pre: '', post: '' },
    };
    const { ctx, environmentId } = context();
    const resolution = resolveRequest(sdef, ctx, sdef.auth);
    const refused = opts.guard?.(resolution.request, resolution.secrets);
    if (refused) throw new Error(refused.message);
    const jar = cookieJarFor(db, environmentId, sdef, resolution.request);
    const secrets = [...resolution.secrets, ...secretValues(ctx), ...jar.sent];
    const raw = await executeHttp(resolution.request, effectiveSettings(db, {}), opts.signal, jar.hooks);
    const type = headerValue(raw.headers, 'content-type');
    const textual = isTextual(type, raw.body);
    const text = textual ? raw.body.toString('utf8') : raw.body.toString('base64');
    db.insert(requestHistory)
      .values({
        id: newId(),
        requestId: null,
        environmentId,
        method,
        url: redactText(resolution.request.url, secrets),
        request: { headers: redactHeaders(resolution.request.headers, secrets), body: resolution.request.body.content === null ? null : redactText(truncate(resolution.request.body.content), secrets) },
        status: raw.status,
        statusText: raw.statusText,
        responseHeaders: redactHeaders(raw.headers, secrets, ['set-cookie']),
        responseBody: textual ? truncate(text) : null,
        truncated: textual && text.length > HISTORY_BODY_LIMIT,
        bodySize: raw.body.length,
        contentType: type,
        timing: raw.timing,
        error: raw.error ? `${raw.error.code}: ${raw.error.message}` : null,
        source: 'script',
        createdAt: Date.now(),
      })
      .run();
    if (raw.error) throw new Error(`${raw.error.code}: ${raw.error.message}`);
    return { status: raw.status ?? 0, statusText: raw.statusText ?? '', headers: raw.headers as Record<string, string>, body: textual ? parseBody(text, type) : text, timeMs: Math.round(raw.timing.totalMs) };
  };

  let def: RequestDefinition = structuredClone(input.request);
  const scripts: ScriptRun[] = [];
  const outer = ancestry(db, collectionId)
    .reverse()
    .map((c) => [`${c.kind === 'folder' ? 'folder' : 'collection'} "${c.name}"`, loadScripts(db, 'collection', c.id)] as const);
  /** Collection and folder scripts run outermost first, then the request's, then a flow step's (Postman's order). */
  const sources = (phase: 'pre' | 'post'): [string, string][] =>
    (
      [
        ...outer.map(([label, s]) => [label, s[phase]]),
        ['request', def.scripts?.[phase] ?? ''],
        ['step', opts.extraScripts?.[phase] ?? ''],
      ] as [string, string][]
    ).filter(([, src]) => src.trim() !== '');

  for (const [label, source] of sources('pre')) {
    const { ctx } = context();
    const before = toScriptRequest(def);
    const run = await runScript({ source, phase: 'pre', host: host(ctx), request: before, timeoutMs: SCRIPT_TIMEOUT_MS });
    const secrets = secretValues(context().ctx);
    scripts.push({ ...run, source: label, request: undefined, logs: run.logs.map((l) => ({ ...l, message: redactText(l.message, secrets) })) });
    if (run.request) def = applyScriptRequest(def, before, run.request);
    if (run.error) return failure(def, { code: 'SCRIPT_ERROR', message: `Pre-request script (${label}): ${run.error}` }, [], scripts);
  }

  const { ctx, environmentId } = context();
  let auth = effectiveAuth(db, collectionId, def.auth);
  if (needsTokenExchange(auth, ctx)) {
    try {
      const t = await exchangeToken(auth, ctx, { signal: opts.signal });
      auth = { ...auth, accessToken: t.token };
    } catch (e) {
      const code = (e as { code?: string }).code === 'oauth_sign_in_required' ? 'OAUTH_SIGN_IN_REQUIRED' : 'OAUTH_ERROR';
      return failure(def, { code, message: (e as Error).message }, [], scripts);
    }
  }
  const resolution = resolveRequest(def, ctx, auth);
  const jar = cookieJarFor(db, environmentId, def, resolution.request);
  const secrets = [...resolution.secrets, ...secretValues(ctx), ...jar.sent];
  const redactedRequest = {
    method: resolution.request.method,
    url: redactText(resolution.request.url, secrets),
    headers: redactHeaders(resolution.request.headers, secrets),
  };
  if (opts.failOnUnresolved && resolution.unresolved.length) {
    return failure(
      def,
      { code: 'UNRESOLVED', message: `Unresolved: ${resolution.unresolved.map((u) => `{{${u}}}`).join(', ')}` },
      resolution.unresolved,
      scripts,
      redactedRequest,
    );
  }
  const refused = opts.guard?.(resolution.request, resolution.secrets);
  if (refused) return failure(def, refused, resolution.unresolved, scripts, redactedRequest);
  const loaded = loadBodyFiles(resolution.request.body);
  if ('error' in loaded) return failure(def, loaded.error, [], scripts, redactedRequest);
  resolution.request.body = loaded.body;
  const raw = await executeHttp(resolution.request, effectiveSettings(db, def.settings), opts.signal, jar.hooks);

  const contentType = headerValue(raw.headers, 'content-type');
  const textual = isTextual(contentType, raw.body);
  const bodyText = textual ? raw.body.toString('utf8') : raw.body.toString('base64');
  const historyId = newId();

  db.insert(requestHistory)
    .values({
      id: historyId,
      requestId: saved?.id ?? null,
      environmentId,
      method: redactedRequest.method,
      url: redactedRequest.url,
      request: {
        headers: redactedRequest.headers,
        body: resolution.request.body.content === null ? null : redactText(truncate(resolution.request.body.content), secrets),
      },
      status: raw.status,
      statusText: raw.statusText,
      responseHeaders: redactHeaders(raw.headers, secrets, ['set-cookie']),
      responseBody: textual ? truncate(bodyText) : null,
      truncated: textual && bodyText.length > HISTORY_BODY_LIMIT,
      bodySize: raw.body.length,
      contentType,
      timing: raw.timing,
      error: raw.error ? `${raw.error.code}: ${raw.error.message}` : null,
      source: opts.source ?? null,
      createdAt: Date.now(),
    })
    .run();

  afterSend(db);
  if (opts.source !== 'mcp' && raw.status !== null) trustHostOf(db, resolution.request.url);
  let snapshotId: string | null = null;
  let validation: SendResult['validation'] = null;
  if (saved && raw.status !== null && textual) {
    snapshotId = recordSnapshot(db, { requestId: saved.id, historyId, status: raw.status, contentType, body: bodyText });
    validation = validateResponse(db, saved.id, raw.status, contentType, bodyText);
  }

  answeredUrl = raw.finalUrl;
  /** The request as sent, for `pm.request` in post-response scripts; edits there are ignored. */
  const sentRequest: ScriptRequest = {
    method: resolution.request.method,
    url: resolution.request.url,
    headers: { ...resolution.request.headers },
    body: resolution.request.body.content,
  };
  if (raw.status !== null) {
    const response: ScriptResponse = {
      status: raw.status,
      statusText: raw.statusText ?? undefined,
      headers: raw.headers,
      body: textual ? parseBody(bodyText, contentType) : null,
      timeMs: raw.timing.totalMs,
    };
    current = response;
    for (const [label, source] of sources('post')) {
      const run = await runScript({ source, phase: 'post', host: host(context().ctx), request: sentRequest, response, timeoutMs: SCRIPT_TIMEOUT_MS });
      const logSecrets = [...secrets, ...secretValues(context().ctx)];
      scripts.push({ ...run, source: label, logs: run.logs.map((l) => ({ ...l, message: redactText(l.message, logSecrets) })) });
    }
  }

  return {
    historyId,
    snapshotId,
    request: redactedRequest,
    status: raw.status,
    statusText: raw.statusText,
    headers: raw.headers,
    cookies: parseSetCookies(raw.setCookies),
    body: bodyText,
    bodyEncoding: textual ? 'utf8' : 'base64',
    truncated: false,
    contentType,
    size: raw.body.length,
    timing: raw.timing,
    error: raw.error,
    unresolved: resolution.unresolved,
    validation,
    scripts,
    ...(resolution.emptyAuth && {
      emptyAuth: describeEmptyAuth(db, resolution.emptyAuth, ctx, collectionId, saved?.id ?? null),
    }),
  };
}

function describeEmptyAuth(
  db: Db,
  e: EmptyAuth,
  ctx: ResolutionContext,
  collectionId: string | null,
  requestId: string | null,
): EmptyAuthWarning {
  const entry = e.variable ? ctx.variables.get(e.variable) : undefined;
  const scope = entry && entry.source !== 'runtime' ? entry.source : null;
  const lookup = snapshotLookup(db, collectionId);
  const sources = referenceSources(db, collectionId)
    .filter((s) => !s.shadowed && s.requestId !== requestId)
    .map((s) => ({ name: s.name, body: lookup(s.name)?.body }))
    .filter((s) => s.body !== undefined);
  return {
    field: e.field,
    template: e.template,
    variable: e.variable ? { name: e.variable, scope, ownerId: entry?.ownerId ?? null } : null,
    suggestion: e.field === 'Bearer token' ? suggestTokenRef(sources) : null,
  };
}

function failure(
  def: RequestDefinition,
  error: { code: string; message: string },
  unresolved: string[],
  scripts: ScriptRun[],
  request?: SendResult['request'],
): SendResult {
  return {
    historyId: null,
    snapshotId: null,
    request: request ?? { method: def.method, url: def.url, headers: {} },
    status: null,
    statusText: null,
    headers: {},
    cookies: [],
    body: '',
    bodyEncoding: 'utf8',
    truncated: false,
    contentType: null,
    size: 0,
    timing: { totalMs: 0 },
    error,
    unresolved,
    validation: null,
    scripts,
  };
}

function truncate(s: string): string {
  return s.length > HISTORY_BODY_LIMIT ? s.slice(0, HISTORY_BODY_LIMIT) : s;
}

export function headerValue(headers: Record<string, string>, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === lower) return v;
  return null;
}
