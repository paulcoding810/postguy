import {
  parseSetCookies,
  redactHeaders,
  redactText,
  resolveRequest,
  resolveValue,
  runScript,
  suggestTokenRef,
  type EmptyAuth,
  type ResolutionContext,
  type ResponseRecord,
  type ScriptHost,
} from '@postguy/core';
import {
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
import { effectiveAuth, rootOf } from './collections.ts';
import { buildContext } from './context.ts';
import { globalEnvironment } from './environments.ts';
import { executeHttp, isTextual } from './http.ts';
import { recordSnapshot, referenceSources, snapshotLookup, validateResponse } from './memory.ts';
import { afterSend } from './maintenance.ts';
import { exchangeToken, needsTokenExchange } from './oauth.ts';
import { getRequest } from './requests.ts';
import { listVariables, replaceVariables, setVariable } from './variables.ts';

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
      formdata: (def.body.form ?? []).filter((f) => f.enabled && f.key).map((f) => ({ key: f.key, value: f.value })),
    }),
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
        replaceVariables(db, t.scope, t.ownerId, rest.map(({ key: k, value: val, isSecret, enabled }) => ({ key: k, value: val, isSecret, enabled })));
      } else setVariable(db, t.scope, t.ownerId, key, typeof value === 'string' ? value : JSON.stringify(value));
    },
  });

  let def: RequestDefinition = structuredClone(input.request);
  const scripts: ScriptRun[] = [];
  const sources = (phase: 'pre' | 'post'): [string, string][] =>
    (
      [
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
  const secrets = [...resolution.secrets, ...secretValues(ctx)];
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
  const raw = await executeHttp(resolution.request, def.settings, opts.signal);

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
      createdAt: Date.now(),
    })
    .run();

  afterSend(db);
  let snapshotId: string | null = null;
  let validation: SendResult['validation'] = null;
  if (saved && raw.status !== null && textual) {
    snapshotId = recordSnapshot(db, { requestId: saved.id, historyId, status: raw.status, contentType, body: bodyText });
    validation = validateResponse(db, saved.id, raw.status, contentType, bodyText);
  }

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
      const run = await runScript({ source, phase: 'post', host: host(context().ctx), response, timeoutMs: SCRIPT_TIMEOUT_MS });
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
