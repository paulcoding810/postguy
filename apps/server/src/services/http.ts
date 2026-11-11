import https from 'node:https';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import axios, { AxiosError, type AxiosResponse } from 'axios';
import type { ResolvedRequest } from '@postguy/core';
import type { RequestSettings } from '@postguy/shared';

export const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface RawResponse {
  status: number | null;
  statusText: string | null;
  headers: Record<string, string>;
  setCookies: string[];
  body: Buffer;
  timing: { totalMs: number };
  error: { code: string; message: string } | null;
}

const httpAgent = new http.Agent({ keepAlive: false });
const httpsStrict = new https.Agent({ keepAlive: false, rejectUnauthorized: true });
const httpsLoose = new https.Agent({ keepAlive: false, rejectUnauthorized: false });

function flattenHeaders(raw: AxiosResponse['headers']): { headers: Record<string, string>; setCookies: string[] } {
  const headers: Record<string, string> = {};
  let setCookies: string[] = [];
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (v === undefined || v === null) continue;
    if (k.toLowerCase() === 'set-cookie') setCookies = Array.isArray(v) ? v.map(String) : [String(v)];
    headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return { headers, setCookies };
}

export async function executeHttp(
  req: ResolvedRequest,
  settings: RequestSettings = {},
  signal?: AbortSignal,
): Promise<RawResponse> {
  const start = performance.now();
  const elapsed = () => Math.round((performance.now() - start) * 10) / 10;
  if (!req.url) {
    return {
      status: null,
      statusText: null,
      headers: {},
      setCookies: [],
      body: Buffer.alloc(0),
      timing: { totalMs: 0 },
      error: { code: 'INVALID_URL', message: 'URL is empty' },
    };
  }
  try {
    const res = await axios.request<ArrayBuffer>({
      url: req.url,
      method: req.method,
      headers: req.headers,
      data: req.body.content ?? undefined,
      responseType: 'arraybuffer',
      transformResponse: (d) => d,
      transformRequest: (d) => d,
      validateStatus: () => true,
      timeout: settings.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRedirects: settings.followRedirects === false ? 0 : 5,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      decompress: true,
      proxy: false,
      httpAgent,
      httpsAgent: settings.rejectUnauthorized === false ? httpsLoose : httpsStrict,
      signal,
    });
    const { headers, setCookies } = flattenHeaders(res.headers);
    return {
      status: res.status,
      statusText: res.statusText,
      headers,
      setCookies,
      body: Buffer.from(res.data ?? new ArrayBuffer(0)),
      timing: { totalMs: elapsed() },
      error: null,
    };
  } catch (e) {
    const err = e as AxiosError;
    const code = err.code ?? 'REQUEST_FAILED';
    const message =
      code === 'ECONNABORTED' || code === 'ETIMEDOUT'
        ? `Request timed out after ${settings.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`
        : code === 'ECONNREFUSED'
          ? `Connection refused: ${req.url}`
          : code === 'ENOTFOUND'
            ? `Host not found: ${safeHost(req.url)}`
            : code === 'ERR_CANCELED'
              ? 'Request cancelled'
              : err.message || 'Request failed';
    return {
      status: null,
      statusText: null,
      headers: {},
      setCookies: [],
      body: Buffer.alloc(0),
      timing: { totalMs: elapsed() },
      error: { code, message },
    };
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const TEXT_TYPES = /^(text\/|application\/([\w.+-]*\+)?(json|xml|javascript|x-www-form-urlencoded|yaml|x-yaml|graphql)|image\/svg)/i;

export function isTextual(contentType: string | null, body: Buffer): boolean {
  if (contentType && TEXT_TYPES.test(contentType)) return true;
  if (contentType && /^(image|audio|video|font)\/|octet-stream|pdf|zip/i.test(contentType)) return false;
  const sample = body.subarray(0, 1024);
  return !sample.includes(0);
}

export function isJsonContent(contentType: string | null): boolean {
  return !!contentType && /[/+]json\b/i.test(contentType);
}
