import type { RouteBody, RouteKey, RouteQuery, RouteResponse } from '@postguy/shared';
import { getServerInfo } from './server';

/** Identifies this window to the server, so it can skip reloading changes it made itself. */
export const CLIENT_ID = Math.random().toString(36).slice(2);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiOptions<K extends RouteKey> {
  params?: Record<string, string>;
  body?: RouteBody<K>;
  query?: RouteQuery<K>;
  signal?: AbortSignal;
}

export async function api<K extends RouteKey>(key: K, opts: ApiOptions<K> = {}): Promise<RouteResponse<K>> {
  const { baseUrl, token } = await getServerInfo();
  const [method, template] = key.split(' ') as [string, string];
  const o = opts as { params?: Record<string, string>; body?: unknown; query?: Record<string, unknown>; signal?: AbortSignal };
  let path = template.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(o.params?.[name] ?? ''));
  if (o.query) {
    const qs = Object.entries(o.query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) path += `?${qs}`;
  }
  let res: Response;
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Postguy-Client': CLIENT_ID,
        ...(o.body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      signal: o.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, `Cannot reach the Postguy server at ${baseUrl}. Is it running?`, 'offline');
  }
  const text = await res.text();
  const data = text && (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : text;
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: unknown } })?.error;
    throw new ApiError(res.status, err?.message ?? res.statusText, err?.code, err?.details);
  }
  return data as RouteResponse<K>;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && Array.isArray(e.details) && e.details.length) {
    const first = e.details[0] as { path?: string; message?: string };
    return `${e.message}: ${first.path ? `${first.path} ` : ''}${first.message ?? ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}
