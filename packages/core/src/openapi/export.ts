import type { Auth, ExportedCollection, RequestDefinition } from '@postguy/shared';
import { inferSchema } from '../memory/infer.ts';

type Obj = Record<string, unknown>;

function toOasPath(url: string): { path: string; server: string | null } {
  let rest = url.trim().replace(/^\{\{\s*[^}]+\s*\}\}/, '');
  let server: string | null = null;
  const m = /^(https?:\/\/[^/?#]+)(.*)$/i.exec(rest);
  if (m) {
    server = m[1]!;
    rest = m[2]!;
  }
  const path = (rest.split(/[?#]/)[0] || '/').replace(/\/:([A-Za-z_][\w-]*)/g, '/{$1}').replace(/\{\{\s*([^}]+?)\s*\}\}/g, '{$1}');
  return { path: path.startsWith('/') ? path : `/${path}`, server };
}

function securityScheme(auth: Auth): Obj | null {
  switch (auth.type) {
    case 'bearer':
      return { type: 'http', scheme: 'bearer' };
    case 'basic':
      return { type: 'http', scheme: 'basic' };
    case 'apikey':
      return { type: 'apiKey', in: auth.in, name: auth.key };
    case 'oauth2':
      return { type: 'oauth2', flows: { clientCredentials: { tokenUrl: auth.tokenUrl || 'https://example.com/token', scopes: {} } } };
    default:
      return null;
  }
}

function safeExample(value: string): string | undefined {
  return /\{\{[^}]+\}\}/.test(value) ? undefined : value;
}

function bodyContent(def: RequestDefinition): Obj | undefined {
  const b = def.body;
  if (b.mode === 'json' && b.raw?.trim()) {
    try {
      const example = JSON.parse(b.raw);
      return { 'application/json': { schema: inferSchema(example), example } };
    } catch {
      return { 'application/json': { schema: {} } };
    }
  }
  if (b.mode === 'text') return { [b.contentType ?? 'text/plain']: { schema: { type: 'string' } } };
  if (b.mode === 'binary') return { [b.contentType ?? 'application/octet-stream']: { schema: { type: 'string', format: 'binary' } } };
  if (b.mode === 'urlencoded' || b.mode === 'form') {
    const properties: Obj = {};
    for (const f of b.form ?? []) if (f.enabled && f.key) properties[f.key] = f.type === 'file' ? { type: 'string', format: 'binary' } : { type: 'string' };
    return { [b.mode === 'form' ? 'multipart/form-data' : 'application/x-www-form-urlencoded']: { schema: { type: 'object', properties } } };
  }
  return undefined;
}

/**
 * Builds an OpenAPI 3.0 document from an exported (already secret-stripped) collection.
 * Variable values are never written; only structure, parameter names and literal examples.
 */
export function collectionToOpenApi(col: ExportedCollection): Obj {
  const paths: Record<string, Obj> = {};
  const tags: { name: string; description?: string }[] = [];
  const schemes: Record<string, Obj> = {};
  const servers = new Set<string>();
  const baseUrl = col.variables.find((v) => v.key === 'baseUrl' && !v.isSecret)?.value;
  if (baseUrl && /^https?:\/\//.test(baseUrl)) servers.add(baseUrl);

  const rootScheme = securityScheme(col.auth);
  if (rootScheme) schemes[`${col.auth.type}Auth`] = rootScheme;
  const usedIds = new Set<string>();

  const visit = (node: ExportedCollection, tag: string | null, inherited: Auth) => {
    const auth = node.auth.type === 'inherit' ? inherited : node.auth;
    for (const r of node.requests) {
      const { path, server } = toOasPath(r.url);
      if (server) servers.add(server);
      const effective = r.auth.type === 'inherit' ? auth : r.auth;
      const scheme = securityScheme(effective);
      if (scheme) schemes[`${effective.type}Auth`] ??= scheme;
      const parameters = [
        ...r.pathParams.map((p) => ({ name: p.key, in: 'path', required: true, schema: { type: 'string' }, ...(p.description && { description: p.description }), ...(safeExample(p.value) && { example: p.value }) })),
        ...r.params.filter((p) => p.key).map((p) => ({ name: p.key, in: 'query', required: p.enabled, schema: { type: 'string' }, ...(safeExample(p.value) && { example: p.value }) })),
        ...r.headers
          .filter((h) => h.key && !/^(authorization|cookie|content-type|accept)$/i.test(h.key))
          .map((h) => ({ name: h.key, in: 'header', required: h.enabled, schema: { type: 'string' } })),
      ];
      for (const name of path.matchAll(/\{([^}]+)\}/g)) {
        if (!parameters.some((p) => p.in === 'path' && p.name === name[1])) parameters.push({ name: name[1]!, in: 'path', required: true, schema: { type: 'string' } });
      }
      let operationId = r.name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toLowerCase()) || 'operation';
      for (let n = 2; usedIds.has(operationId); n++) operationId = `${operationId.replace(/\d+$/, '')}${n}`;
      usedIds.add(operationId);
      const content = bodyContent(r);
      const op: Obj = {
        operationId,
        summary: r.name,
        ...(r.description && { description: r.description }),
        ...(tag && { tags: [tag] }),
        ...(parameters.length && { parameters }),
        ...(content && { requestBody: { content } }),
        responses: { '200': { description: 'Successful response' } },
        security: scheme ? [{ [`${effective.type}Auth`]: [] }] : [],
      };
      paths[path] ??= {};
      paths[path]![r.method.toLowerCase()] = op;
    }
    for (const f of node.folders) {
      if (!tags.some((t) => t.name === f.name)) tags.push({ name: f.name, ...(f.description && { description: f.description }) });
      visit(f, f.name, auth);
    }
  };
  visit(col, null, col.auth);

  return {
    openapi: '3.0.3',
    info: { title: col.name, version: '1.0.0', ...(col.description && { description: col.description }) },
    ...(servers.size && { servers: [...servers].map((url) => ({ url })) }),
    ...(tags.length && { tags }),
    paths,
    ...(Object.keys(schemes).length && { components: { securitySchemes: schemes } }),
  };
}
