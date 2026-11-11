import { Ajv2020 } from 'ajv/dist/2020.js';
import type { JsonSchema, ValidationIssue } from '@postguy/shared';
import { canonicalJson } from './infer.ts';

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false, validateSchema: false });
const cache = new Map<string, ReturnType<typeof ajv.compile> | null>();

/** Validates data against a JSON Schema; returns null when the schema cannot be compiled. */
export function validateJson(schema: JsonSchema, data: unknown): ValidationIssue[] | null {
  const key = canonicalJson(schema);
  let fn = cache.get(key);
  if (fn === undefined) {
    try {
      fn = ajv.compile(schema);
    } catch {
      fn = null;
    }
    if (cache.size > 200) cache.clear();
    cache.set(key, fn);
  }
  if (!fn) return null;
  if (fn(data)) return [];
  return (fn.errors ?? []).slice(0, 50).map((e) => ({
    path: e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : '(root)',
    message:
      e.keyword === 'additionalProperties'
        ? `unexpected property "${(e.params as { additionalProperty: string }).additionalProperty}"`
        : e.keyword === 'required'
          ? `missing required property "${(e.params as { missingProperty: string }).missingProperty}"`
          : (e.message ?? e.keyword),
  }));
}
