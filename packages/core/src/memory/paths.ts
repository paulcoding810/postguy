import type { PathEntry } from '@postguy/shared';
import { formatPath, type PathSegment } from '../path.ts';
import { jsonTypeOf } from './infer.ts';

export interface ExtractOptions {
  maxDepth?: number;
  maxEntries?: number;
  arraySamples?: number;
}

const SAMPLE_MAX = 120;

function sampleOf(value: unknown): unknown {
  if (typeof value === 'string') return value.length > SAMPLE_MAX ? `${value.slice(0, SAMPLE_MAX)}…` : value;
  if (value === null || typeof value !== 'object') return value;
  return undefined;
}

/**
 * Lists every JSON path in a value. Arrays yield a concrete path for the first element
 * (`items[0].id`) and a wildcard path (`items[*].id`) unioned over the first few elements.
 */
export function extractPaths(root: unknown, opts: ExtractOptions = {}): PathEntry[] {
  const maxDepth = opts.maxDepth ?? 20;
  const maxEntries = opts.maxEntries ?? 2000;
  const arraySamples = opts.arraySamples ?? 5;
  const out: PathEntry[] = [];
  const seen = new Set<string>();

  const push = (segs: PathSegment[], value: unknown, wildcard: boolean) => {
    if (out.length >= maxEntries || !segs.length) return;
    const path = formatPath(segs);
    if (seen.has(path)) return;
    seen.add(path);
    const entry: PathEntry = { path, type: jsonTypeOf(value) };
    const sample = sampleOf(value);
    if (sample !== undefined) entry.sample = sample;
    if (wildcard) entry.wildcard = true;
    out.push(entry);
  };

  const walk = (value: unknown, segs: PathSegment[], depth: number, wildcard: boolean) => {
    if (out.length >= maxEntries) return;
    push(segs, value, wildcard);
    if (depth >= maxDepth || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      if (!value.length) return;
      if (!wildcard) walk(value[0], [...segs, 0], depth + 1, false);
      for (const el of value.slice(0, arraySamples)) walk(el, [...segs, '*'], depth + 1, true);
      return;
    }
    for (const [k, v] of Object.entries(value)) walk(v, [...segs, k], depth + 1, wildcard);
  };

  walk(root, [], 0, false);
  return out;
}
