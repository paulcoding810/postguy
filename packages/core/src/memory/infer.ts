import type { JsonSchema, JsonType } from '@postguy/shared';

type S = Record<string, any>;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URI = /^[a-z][a-z\d+.-]*:\/\/\S+$/i;

const MAX_DEPTH = 32;
const MAX_ARRAY_SAMPLES = 20;

export function jsonTypeOf(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  return 'object';
}

function stringFormat(s: string): string | undefined {
  if (ISO_DATE_TIME.test(s)) return 'date-time';
  if (ISO_DATE.test(s)) return 'date';
  if (UUID.test(s)) return 'uuid';
  if (EMAIL.test(s)) return 'email';
  if (URI.test(s)) return 'uri';
  return undefined;
}

/** Infers a JSON Schema describing the shape of a value; values themselves are never stored. */
export function inferSchema(value: unknown, depth = 0): JsonSchema {
  if (depth > MAX_DEPTH) return {};
  const type = jsonTypeOf(value);
  switch (type) {
    case 'string': {
      const format = stringFormat(value as string);
      return format ? { type, format } : { type };
    }
    case 'array': {
      const arr = value as unknown[];
      if (!arr.length) return { type, items: {} };
      let items = inferSchema(arr[0], depth + 1);
      for (const el of arr.slice(1, MAX_ARRAY_SAMPLES)) items = mergeSchemas(items, inferSchema(el, depth + 1));
      return { type, items };
    }
    case 'object': {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const properties: Record<string, JsonSchema> = {};
      for (const k of keys) properties[k] = inferSchema(obj[k], depth + 1);
      return { type, properties, required: keys };
    }
    default:
      return { type };
  }
}

function typesOf(s: S): string[] {
  if (Array.isArray(s.type)) return s.type;
  return s.type ? [s.type] : [];
}

function withTypes(s: S, types: string[]): S {
  const uniq = [...new Set(types)];
  if (uniq.includes('number') && uniq.includes('integer')) uniq.splice(uniq.indexOf('integer'), 1);
  const ordered = uniq.filter((t) => t !== 'null').sort().concat(uniq.includes('null') ? ['null'] : []);
  return { ...s, type: ordered.length === 1 ? ordered[0] : ordered };
}

/**
 * Merges two inferred schemas: properties are unioned, `required` is intersected,
 * differing scalar types become a type union, and incompatible structures become `anyOf`.
 */
export function mergeSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
  const x = a as S;
  const y = b as S;
  if (!x.type && !x.anyOf) return b;
  if (!y.type && !y.anyOf) return a;
  if (canonicalJson(x) === canonicalJson(y)) return a;
  if (x.anyOf || y.anyOf) {
    const branches = [...(x.anyOf ?? [x]), ...(y.anyOf ?? [y])];
    const unique = new Map(branches.map((br: S) => [canonicalJson(br), br]));
    return { anyOf: [...unique.values()] };
  }
  const tx = typesOf(x);
  const ty = typesOf(y);
  const structural = (t: string[]) => t.filter((v) => v === 'object' || v === 'array');
  const sx = structural(tx);
  const sy = structural(ty);
  if (sx.length && sy.length && sx[0] !== sy[0]) return { anyOf: [x, y] };

  const out: S = withTypes({}, [...tx, ...ty]);
  const kind = sx[0] ?? sy[0];
  if (kind === 'object') {
    const px = (x.properties ?? {}) as Record<string, JsonSchema>;
    const py = (y.properties ?? {}) as Record<string, JsonSchema>;
    const keys = [...new Set([...Object.keys(px), ...Object.keys(py)])].sort();
    const properties: Record<string, JsonSchema> = {};
    for (const k of keys) properties[k] = px[k] && py[k] ? mergeSchemas(px[k]!, py[k]!) : (px[k] ?? py[k])!;
    out.properties = properties;
    const rx: string[] = sx.length ? (x.required ?? []) : (y.required ?? []);
    const ry: string[] = sy.length ? (y.required ?? []) : (x.required ?? []);
    out.required = rx.filter((k) => ry.includes(k));
  } else if (kind === 'array') {
    const ix = x.items as JsonSchema | undefined;
    const iy = y.items as JsonSchema | undefined;
    out.items = ix && iy ? mergeSchemas(ix, iy) : (ix ?? iy ?? {});
  }
  if (x.format && x.format === y.format) out.format = x.format;
  else if (x.format && !ty.includes('string')) out.format = x.format;
  else if (y.format && !tx.includes('string')) out.format = y.format;
  return out;
}

/** JSON with object keys sorted recursively; identical schemas produce identical text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}
