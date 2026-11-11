import type { JsonSchema } from '@postguy/shared';

const DROP = new Set(['discriminator', 'xml', 'externalDocs', 'example', 'deprecated']);

/**
 * Converts an OpenAPI/Swagger schema into plain, acyclic JSON Schema (2020-12 compatible).
 * OAS 3.0 `nullable` becomes a `null` type; `example` becomes `examples`.
 * Circular branches are cut with an empty schema.
 */
export function toJsonSchema(schema: unknown, seen: Set<unknown> = new Set(), depth = 0): JsonSchema | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  if (seen.has(schema) || depth > 40) return {};
  seen.add(schema);
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (DROP.has(key) || key.startsWith('x-') || key === 'nullable') continue;
    if (key === 'properties' || key === 'patternProperties' || key === '$defs' || key === 'definitions') {
      const props: Record<string, unknown> = {};
      for (const [p, s] of Object.entries((value as Record<string, unknown>) ?? {})) props[p] = toJsonSchema(s, seen, depth + 1) ?? {};
      out[key] = props;
    } else if (key === 'items' || key === 'additionalProperties' || key === 'not' || key === 'contains' || key === 'propertyNames') {
      out[key] = typeof value === 'boolean' ? value : Array.isArray(value) ? value.map((v) => toJsonSchema(v, seen, depth + 1) ?? {}) : (toJsonSchema(value, seen, depth + 1) ?? {});
    } else if (key === 'allOf' || key === 'anyOf' || key === 'oneOf' || key === 'prefixItems') {
      out[key] = (value as unknown[]).map((v) => toJsonSchema(v, seen, depth + 1) ?? {});
    } else if (key === '$ref') {
      continue;
    } else {
      out[key] = value;
    }
  }
  if ('example' in src && !('examples' in src)) out.examples = [src.example];
  for (const [bound, limit] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']] as const) {
    if (out[bound] === true) {
      out[bound] = out[limit];
      delete out[limit];
    } else if (out[bound] === false) delete out[bound];
  }
  if (src.nullable === true) {
    if (typeof out.type === 'string') out.type = [out.type, 'null'];
    else if (Array.isArray(out.type) && !out.type.includes('null')) out.type = [...out.type, 'null'];
    else if (!out.type && (out.oneOf || out.anyOf || out.allOf)) out.anyOf = [{ ...out }, { type: 'null' }];
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  seen.delete(schema);
  return out;
}
