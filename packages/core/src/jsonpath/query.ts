import { JSONPath } from 'jsonpath-plus';

/** True for paths needing a real JSONPath engine (recursive descent, filters, slices, unions). */
export function isJsonPathQuery(path: string): boolean {
  return /\.\.|\[\s*\?|\[[^\]]*[:,][^\]]*\]/.test(path);
}

export function queryJsonPath(json: unknown, path: string): unknown[] {
  const expr = path.startsWith('$') ? path : path.startsWith('[') ? `$${path}` : `$.${path}`;
  try {
    return JSONPath({ path: expr, json: json as object, wrap: true, eval: 'safe' }) as unknown[];
  } catch {
    return [];
  }
}
