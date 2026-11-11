import { newId, type KeyValue } from '@postguy/shared';

export function queryString(params: KeyValue[]): string {
  return params
    .filter((p) => p.enabled && (p.key || p.value))
    .map((p) => (p.value === '' ? p.key : `${p.key}=${p.value}`))
    .join('&');
}

/** URL as shown in the URL bar: stored base plus enabled query params. */
export function displayUrl(url: string, params: KeyValue[]): string {
  const qs = queryString(params);
  return qs ? `${url}?${qs}` : url;
}

function splitQuery(qs: string): [string, string][] {
  return qs
    .split('&')
    .filter((s) => s !== '')
    .map((pair) => {
      const i = pair.indexOf('=');
      return i === -1 ? [pair, ''] : [pair.slice(0, i), pair.slice(i + 1)];
    });
}

/** Splits a typed URL into the stored base and params; disabled params are kept. */
export function applyUrlInput(input: string, params: KeyValue[]): { url: string; params: KeyValue[] } {
  const qi = input.indexOf('?');
  const base = qi === -1 ? input : input.slice(0, qi);
  const pairs = qi === -1 ? [] : splitQuery(input.slice(qi + 1));
  const enabled = params.filter((p) => p.enabled);
  const disabled = params.filter((p) => !p.enabled);
  const next: KeyValue[] = pairs.map(([key, value], i) => {
    const prev = enabled[i];
    return prev ? { ...prev, key, value } : { id: newId(8), key, value, enabled: true };
  });
  return { url: base, params: [...next, ...disabled] };
}

export function pathParamNames(url: string): string[] {
  const noQuery = url.split(/[?#]/)[0] ?? '';
  const schemeIdx = noQuery.indexOf('://');
  const path = schemeIdx === -1 ? noQuery : noQuery.slice(noQuery.indexOf('/', schemeIdx + 3) >>> 0);
  const names: string[] = [];
  for (const m of path.matchAll(/\/:([A-Za-z_][\w-]*)/g)) if (!names.includes(m[1]!)) names.push(m[1]!);
  return names;
}

export function syncPathParams(url: string, current: KeyValue[]): KeyValue[] {
  const names = pathParamNames(url);
  return names.map((name) => current.find((p) => p.key === name) ?? { id: newId(8), key: name, value: '', enabled: true });
}
