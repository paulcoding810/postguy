import type { JsonSchema } from '@postguy/shared';

type S = Record<string, any>;

const FORMAT_SAMPLES: Record<string, unknown> = {
  'date-time': '2025-01-01T00:00:00Z',
  date: '2025-01-01',
  time: '12:00:00',
  email: 'user@example.com',
  uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  uri: 'https://example.com',
  url: 'https://example.com',
  hostname: 'example.com',
  ipv4: '192.168.0.1',
  ipv6: '::1',
  password: 'password',
  byte: 'U3dhZ2dlcg==',
  binary: '',
};

function primaryType(s: S): string | undefined {
  if (Array.isArray(s.type)) return s.type.find((t: string) => t !== 'null') ?? s.type[0];
  if (s.type) return s.type;
  if (s.properties || s.additionalProperties) return 'object';
  if (s.items) return 'array';
  return undefined;
}

function mergeAllOf(parts: S[]): S {
  const out: S = { type: 'object', properties: {}, required: [] };
  for (const p of parts) {
    const resolved = p.allOf ? mergeAllOf(p.allOf) : p;
    Object.assign(out.properties, resolved.properties ?? {});
    out.required.push(...(resolved.required ?? []));
    for (const k of ['type', 'examples', 'default', 'enum', 'format', 'items'] as const)
      if (resolved[k] !== undefined && k !== 'type') out[k] ??= resolved[k];
    if (resolved.type && resolved.type !== 'object') out.type = resolved.type;
  }
  return out;
}

/** Builds a representative value from a JSON Schema. */
export function sampleFromSchema(schema: JsonSchema | undefined, depth = 0): unknown {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as S;
  if (depth > 8) return primaryType(s) === 'array' ? [] : primaryType(s) === 'object' ? {} : null;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.example !== undefined) return s.example;
  if (s.const !== undefined) return s.const;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum.find((v: unknown) => v !== null) ?? s.enum[0];
  if (Array.isArray(s.allOf) && s.allOf.length) return sampleFromSchema(mergeAllOf(s.allOf), depth + 1);
  for (const key of ['oneOf', 'anyOf'] as const) {
    if (Array.isArray(s[key]) && s[key].length) {
      const branch = s[key].find((b: S) => primaryType(b) !== 'null') ?? s[key][0];
      const base = { ...s, [key]: undefined };
      const merged = s.properties ? mergeAllOf([base, branch]) : branch;
      return sampleFromSchema(merged, depth + 1);
    }
  }
  switch (primaryType(s)) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries((s.properties ?? {}) as Record<string, S>)) {
        if (v?.readOnly) continue;
        out[k] = sampleFromSchema(v, depth + 1);
      }
      if (!s.properties && s.additionalProperties && typeof s.additionalProperties === 'object')
        out.key = sampleFromSchema(s.additionalProperties, depth + 1);
      return out;
    }
    case 'array':
      return s.items ? [sampleFromSchema(Array.isArray(s.items) ? s.items[0] : s.items, depth + 1)] : [];
    case 'string':
      return s.format && s.format in FORMAT_SAMPLES ? FORMAT_SAMPLES[s.format] : 'string';
    case 'integer':
      return s.minimum ?? 0;
    case 'number':
      return s.minimum ?? 0;
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return null;
  }
}
