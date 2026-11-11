import {
  HTTP_METHODS,
  type ApiModel,
  type HttpMethod,
  type JsonSchema,
  type OpenApiOperation,
  type OpenApiParam,
  type OpenApiSecurityScheme,
} from '@postguy/shared';
import { toJsonSchema } from './schema.ts';

type Obj = Record<string, any>;

const lower = HTTP_METHODS.map((m) => m.toLowerCase());

function pickContent(content: Obj | undefined): { contentType: string; media: Obj } | null {
  if (!content || typeof content !== 'object') return null;
  const types = Object.keys(content);
  const preferred =
    types.find((t) => /^application\/json/i.test(t)) ??
    types.find((t) => /\+json/i.test(t)) ??
    types.find((t) => /x-www-form-urlencoded|multipart\/form-data/i.test(t)) ??
    types[0];
  return preferred ? { contentType: preferred, media: content[preferred] ?? {} } : null;
}

function firstExample(media: Obj): unknown {
  if (media.example !== undefined) return media.example;
  const examples = media.examples;
  if (examples && typeof examples === 'object') {
    const first = Object.values(examples)[0] as Obj | undefined;
    if (first && 'value' in first) return first.value;
  }
  return undefined;
}

function operationId(method: string, path: string, op: Obj): string {
  if (typeof op.operationId === 'string' && op.operationId) return op.operationId;
  return `${method}_${path}`.replace(/[{}]/g, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+$/, '');
}

function securityNames(sec: unknown): string[] {
  if (!Array.isArray(sec)) return [];
  return sec.flatMap((req: Obj) => Object.keys(req ?? {}));
}

function serversFor(doc: Obj, isSwagger: boolean): ApiModel['servers'] {
  if (isSwagger) {
    const host = doc.host as string | undefined;
    if (!host) return doc.basePath ? [{ url: doc.basePath as string }] : [];
    const schemes = (doc.schemes as string[] | undefined) ?? ['https'];
    return schemes.map((s) => ({ url: `${s}://${host}${doc.basePath ?? ''}`.replace(/\/$/, '') }));
  }
  const servers = (doc.servers as Obj[] | undefined) ?? [];
  return servers.map((s) => {
    let url = String(s.url ?? '');
    for (const [name, v] of Object.entries((s.variables as Obj) ?? {})) url = url.replaceAll(`{${name}}`, String((v as Obj).default ?? ''));
    return { url: url.replace(/\/$/, ''), description: s.description };
  });
}

function schemesFor(doc: Obj, isSwagger: boolean): OpenApiSecurityScheme[] {
  const defs: Obj = isSwagger ? (doc.securityDefinitions ?? {}) : (doc.components?.securitySchemes ?? {});
  return Object.entries(defs).map(([name, d]: [string, Obj]) => {
    if (isSwagger) {
      if (d.type === 'basic') return { name, type: 'http', scheme: 'basic', description: d.description };
      if (d.type === 'apiKey') return { name, type: 'apiKey', in: d.in, paramName: d.name, description: d.description };
      return { name, type: 'oauth2', tokenUrl: d.tokenUrl, description: d.description };
    }
    const flows = (d.flows ?? {}) as Obj;
    const flow = (flows.clientCredentials ?? flows.password ?? flows.authorizationCode ?? {}) as Obj;
    return {
      name,
      type: d.type,
      scheme: typeof d.scheme === 'string' ? d.scheme.toLowerCase() : undefined,
      in: d.in,
      paramName: d.name,
      tokenUrl: flow.tokenUrl,
      description: d.description,
    } as OpenApiSecurityScheme;
  });
}

function normalizeParam(p: Obj, isSwagger: boolean): OpenApiParam | null {
  if (!p || !['path', 'query', 'header', 'cookie'].includes(p.in)) return null;
  const schema = isSwagger
    ? toJsonSchema({ type: p.type, format: p.format, enum: p.enum, items: p.items, default: p.default, minimum: p.minimum, maximum: p.maximum })
    : toJsonSchema(p.schema);
  const example = p.example ?? (p.examples ? (Object.values(p.examples)[0] as Obj | undefined)?.value : undefined) ?? (p.schema as Obj | undefined)?.example;
  return {
    name: String(p.name),
    in: p.in,
    required: p.in === 'path' ? true : !!p.required,
    description: p.description,
    schema,
    example,
  };
}

export function normalizeSpec(doc: Obj, specVersion: string): ApiModel {
  const isSwagger = specVersion.startsWith('2');
  const info = (doc.info ?? {}) as Obj;
  const operations: OpenApiOperation[] = [];
  const usedIds = new Set<string>();
  const globalSecurity = securityNames(doc.security);

  for (const [path, item] of Object.entries((doc.paths ?? {}) as Obj)) {
    if (!item || typeof item !== 'object') continue;
    const shared = (item.parameters as Obj[] | undefined) ?? [];
    for (const method of lower) {
      const op = item[method] as Obj | undefined;
      if (!op) continue;
      const paramMap = new Map<string, Obj>();
      for (const p of [...shared, ...((op.parameters as Obj[] | undefined) ?? [])]) if (p?.name) paramMap.set(`${p.in}:${p.name}`, p);
      const rawParams = [...paramMap.values()];
      const params = rawParams.map((p) => normalizeParam(p, isSwagger)).filter((p): p is OpenApiParam => p !== null);

      let requestBody: OpenApiOperation['requestBody'];
      if (isSwagger) {
        const bodyParam = rawParams.find((p) => p.in === 'body');
        const formParams = rawParams.filter((p) => p.in === 'formData');
        const consumes = (op.consumes ?? doc.consumes ?? ['application/json']) as string[];
        if (bodyParam) {
          requestBody = { contentType: consumes.find((c) => /json/.test(c)) ?? consumes[0] ?? 'application/json', required: !!bodyParam.required, schema: toJsonSchema(bodyParam.schema) };
        } else if (formParams.length) {
          const properties: Record<string, JsonSchema> = {};
          for (const f of formParams) properties[f.name] = toJsonSchema({ type: f.type === 'file' ? 'string' : f.type, format: f.type === 'file' ? 'binary' : f.format }) ?? {};
          requestBody = {
            contentType: consumes.find((c) => /form/.test(c)) ?? 'application/x-www-form-urlencoded',
            required: formParams.some((f) => f.required),
            schema: { type: 'object', properties, required: formParams.filter((f) => f.required).map((f) => f.name) },
          };
        }
      } else if (op.requestBody) {
        const picked = pickContent(op.requestBody.content);
        if (picked) {
          requestBody = {
            contentType: picked.contentType,
            required: !!op.requestBody.required,
            schema: toJsonSchema(picked.media.schema),
            example: firstExample(picked.media),
          };
        }
      }

      const responses: OpenApiOperation['responses'] = Object.entries((op.responses ?? {}) as Obj).map(([status, r]: [string, Obj]) => {
        if (isSwagger) {
          return { status, description: r?.description, contentType: r?.schema ? 'application/json' : undefined, schema: toJsonSchema(r?.schema) };
        }
        const picked = pickContent(r?.content);
        return { status, description: r?.description, contentType: picked?.contentType, schema: toJsonSchema(picked?.media.schema) };
      });

      let id = operationId(method, path, op);
      for (let n = 2; usedIds.has(id); n++) id = `${operationId(method, path, op)}_${n}`;
      usedIds.add(id);

      operations.push({
        id,
        method: method.toUpperCase() as HttpMethod,
        path,
        tags: Array.isArray(op.tags) && op.tags.length ? op.tags.map(String) : [],
        summary: op.summary,
        description: op.description,
        deprecated: !!op.deprecated,
        params,
        requestBody,
        responses,
        security: op.security !== undefined ? securityNames(op.security) : globalSecurity,
      });
    }
  }

  return {
    title: String(info.title ?? 'Untitled API'),
    version: String(info.version ?? ''),
    specVersion,
    description: info.description,
    servers: serversFor(doc, isSwagger),
    securitySchemes: schemesFor(doc, isSwagger),
    tags: ((doc.tags as Obj[] | undefined) ?? []).map((t) => ({ name: String(t.name), description: t.description })),
    operations,
    globalSecurity,
  };
}
