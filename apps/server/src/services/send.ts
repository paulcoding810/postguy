import { parseSetCookies, redactHeaders, redactText, resolveRequest } from '@postguy/core';
import { newId, SendInput, type SendResult } from '@postguy/shared';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { requestHistory } from '../db/schema.ts';
import { effectiveAuth } from './collections.ts';
import { buildContext } from './context.ts';
import { executeHttp, isTextual } from './http.ts';
import { getRequest } from './requests.ts';

export const HISTORY_BODY_LIMIT = 5 * 1024 * 1024;

export async function send(db: Db, input: z.output<typeof SendInput>, signal?: AbortSignal): Promise<SendResult> {
  const saved = input.requestId ? getRequest(db, input.requestId) : null;
  const collectionId = input.collectionId ?? saved?.collectionId ?? null;
  const { ctx, environmentId } = buildContext(db, {
    collectionId,
    requestId: saved?.id ?? null,
    environmentId: input.environmentId,
  });
  const def = input.request;
  const auth = effectiveAuth(db, collectionId, def.auth);
  const resolution = resolveRequest(def, ctx, auth);
  const secrets = resolution.secrets;
  const raw = await executeHttp(resolution.request, def.settings, signal);

  const contentType = headerValue(raw.headers, 'content-type');
  const textual = isTextual(contentType, raw.body);
  const bodyText = textual ? raw.body.toString('utf8') : raw.body.toString('base64');
  const historyId = newId();

  const redactedRequest = {
    method: resolution.request.method,
    url: redactText(resolution.request.url, secrets),
    headers: redactHeaders(resolution.request.headers, secrets),
  };

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

  return {
    historyId,
    snapshotId: null,
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
    validation: null,
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
