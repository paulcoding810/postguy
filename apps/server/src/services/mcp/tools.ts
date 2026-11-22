import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseCurl, resolveTemplate } from '@postguy/core';
import { HTTP_METHODS, newId, RequestDefinition, type CollectionTreeNode, type KeyValue } from '@postguy/shared';
import { z } from 'zod';
import type { Db } from '../../db/client.ts';
import { HttpError } from '../../lib/errors.ts';
import { VERSION } from '../../lib/version.ts';
import { getTree } from '../collections.ts';
import { buildContext } from '../context.ts';
import { activateEnvironment, listEnvironments } from '../environments.ts';
import { getExecution, getFlow, listFlows, runFlow, waitForExecution } from '../flows.ts';
import { getHistoryEntry, listHistory } from '../history.ts';
import { importOpenApi } from '../openapi.ts';
import { buildReport } from '../report.ts';
import { createRequest, getRequest, updateRequest } from '../requests.ts';
import { withSource } from '../changelog.ts';
import { notifyChange } from '../changes.ts';
import { send } from '../send.ts';
import { setVariable } from '../variables.ts';
import { markUntrusted } from '../settings.ts';
import { allKnownHosts, environmentFor, hiddenSecrets, mask, requirePermission, secretHostGuard, type Permission } from './policy.ts';

const BODY_LIMIT = 20_000;

const INSTRUCTIONS = `Postguy is the user's API client. Requests live in collections and folders and use {{variable}} references
(environment, collection, request and global variables) and {{RequestName.path}} references to remembered responses.
Secret values are always shown as •••••• unless the user allowed it for that environment; write {{name}} in a request and
Postguy fills it in when sending. Requests carrying a secret are only sent to hosts the user's saved requests already use.
Use list_requests to find requests, then send_request by id. Everything you send is labelled "MCP" in the user's history.`;

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };

const json = (value: unknown): Result => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

const clip = (text: string | null) => (text && text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}… (${text.length - BODY_LIMIT} more characters)` : text);

const kvs = (record: Record<string, string> | undefined): KeyValue[] | undefined =>
  record && Object.entries(record).map(([key, value]) => ({ id: newId(8), key, value, enabled: true }));

const RequestFields = {
  name: z.string().min(1).optional(),
  method: z.enum(HTTP_METHODS).optional(),
  url: z.string().optional().describe('May use {{variables}}, e.g. {{baseUrl}}/users/{{userId}}'),
  headers: z.record(z.string(), z.string()).optional().describe('Replaces all headers'),
  params: z.record(z.string(), z.string()).optional().describe('Query parameters; replaces all'),
  body: z
    .object({ mode: z.enum(['none', 'json', 'text', 'urlencoded']), raw: z.string().optional(), form: z.record(z.string(), z.string()).optional() })
    .optional(),
};
type RequestPatch = { name?: string; method?: (typeof HTTP_METHODS)[number]; url?: string; headers?: Record<string, string>; params?: Record<string, string>; body?: { mode: 'none' | 'json' | 'text' | 'urlencoded'; raw?: string; form?: Record<string, string> } };

function toPatch(p: RequestPatch) {
  return {
    ...(p.name !== undefined && { name: p.name }),
    ...(p.method !== undefined && { method: p.method }),
    ...(p.url !== undefined && { url: p.url }),
    ...(p.headers && { headers: kvs(p.headers) }),
    ...(p.params && { params: kvs(p.params) }),
    ...(p.body && { body: { mode: p.body.mode, ...(p.body.raw !== undefined && { raw: p.body.raw }), ...(p.body.form && { form: kvs(p.body.form) }) } }),
  };
}

function flatten(nodes: CollectionTreeNode[], path: string[] = []): { id: string; name: string; method: string; url: string; collectionId: string; folder: string }[] {
  return nodes.flatMap((n) => [
    ...n.requests.map((r) => ({ id: r.id, name: r.name, method: r.method, url: r.url, collectionId: n.id, folder: [...path, n.name].join(' / ') })),
    ...flatten(n.children, [...path, n.name]),
  ]);
}

/** The tools Claude sees. Each call checks the user's current permission, so changes in Postguy apply at once. */
export function createMcpServer(db: Db): McpServer {
  const server = new McpServer({ name: 'postguy', version: VERSION }, { instructions: INSTRUCTIONS });

  const tool = <S extends z.ZodRawShape>(
    name: string,
    need: Permission,
    description: string,
    inputSchema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown> | unknown,
  ) =>
    server.registerTool(
      name,
      { description, inputSchema, annotations: { readOnlyHint: need === 'read', destructiveHint: false, openWorldHint: need === 'send' } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any) => {
        try {
          requirePermission(db, need);
          const hostsBefore = need === 'edit' ? allKnownHosts(db) : null;
          const result = json(await withSource('mcp', () => handler(args)));
          if (hostsBefore) markUntrusted(db, [...allKnownHosts(db)].filter((h) => !hostsBefore.has(h)));
          if (need !== 'read') notifyChange({ origin: null, what: `mcp:${name}` });
          return result;
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: (e as Error).message }] } satisfies Result;
        }
      }) as never,
    );

  // ---------- read ----------
  tool('list_requests', 'read', 'Lists saved requests with their folder, method and URL. Optionally filters by text.', { query: z.string().optional() }, ({ query }) => {
    const q = query?.toLowerCase();
    return flatten(getTree(db)).filter((r) => !q || `${r.folder} ${r.name} ${r.method} ${r.url}`.toLowerCase().includes(q));
  });

  tool('get_request', 'read', 'Shows a saved request in full: URL, params, headers, auth, body and scripts. Secrets are masked.', { id: z.string() }, ({ id }) => {
    const r = getRequest(db, id);
    return mask(r, hiddenSecrets(db, environmentFor(db)));
  });

  tool('list_environments', 'read', 'Lists environments and which one is active. Variables are not included; use get_variables.', {}, () =>
    listEnvironments(db).map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      active: e.isActive,
      availableToClaude: !e.mcpBlocked,
      secretValuesVisible: e.mcpRevealSecrets,
    })),
  );

  tool(
    'get_variables',
    'read',
    'Shows the variables a request or collection sees, with where each comes from (request, folder, environment, globals). Secret values are masked.',
    { requestId: z.string().optional(), collectionId: z.string().optional(), environment: z.string().optional().describe('Name or id; defaults to the active one') },
    ({ requestId, collectionId, environment }) => {
      const env = environmentFor(db, environment);
      const saved = requestId ? getRequest(db, requestId) : null;
      const cid = collectionId ?? saved?.collectionId ?? null;
      const { ctx } = buildContext(db, { collectionId: cid, requestId: saved?.id ?? null, environmentId: env?.id ?? null });
      const hidden = hiddenSecrets(db, env);
      return {
        environment: env?.name ?? null,
        variables: [...ctx.variables].map(([key, v]) => ({ key, source: v.source, secret: v.secret, value: mask(v.value, hidden) })),
      };
    },
  );

  tool('list_history', 'read', 'Lists recent sends, newest first.', { requestId: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) }, ({ requestId, limit }) =>
    listHistory(db, { requestId, limit }),
  );

  tool('get_history_entry', 'read', 'Shows one past send: the request as sent and the response (body clipped). Secrets are masked.', { id: z.string() }, ({ id }) => {
    const h = getHistoryEntry(db, id);
    return mask({ ...h, responseBody: clip(h.responseBody) }, hiddenSecrets(db, null));
  });

  tool('list_flows', 'read', 'Lists flows (chains of requests).', {}, () => listFlows(db).map((f) => ({ id: f.id, name: f.name, collectionId: f.collectionId })));

  tool('get_flow', 'read', 'Shows a flow: its steps, their requests and how they connect.', { id: z.string() }, ({ id }) => {
    const f = getFlow(db, id);
    return mask(
      { id: f.id, name: f.name, settings: f.settings, steps: f.steps.map((s) => ({ id: s.id, name: s.name, kind: s.kind, requestId: s.requestId, expression: s.expression })), connections: f.connections },
      hiddenSecrets(db, environmentFor(db)),
    );
  });

  tool('get_flow_run', 'read', 'Shows the result of a flow run: each step, its status, response and test results.', { executionId: z.string() }, ({ executionId }) =>
    mask(buildReport(db, executionId), hiddenSecrets(db, null)),
  );

  tool(
    'decode_jwt',
    'read',
    "Decodes a JWT held in a variable and returns its header and claims (expiry, issuer, scopes). Never returns the token or its signature.",
    { variable: z.string(), requestId: z.string().optional(), collectionId: z.string().optional(), environment: z.string().optional() },
    ({ variable, requestId, collectionId, environment }) => {
      const env = environmentFor(db, environment);
      const saved = requestId ? getRequest(db, requestId) : null;
      const { ctx } = buildContext(db, { collectionId: collectionId ?? saved?.collectionId ?? null, requestId: saved?.id ?? null, environmentId: env?.id ?? null });
      const value = resolveTemplate(`{{${variable}}}`, ctx);
      if (value.unresolved.length) throw new HttpError(404, `No variable "${variable}" here`, 'not_found');
      const raw = value.value.replace(/^Bearer\s+/i, '').trim();
      const parts = raw.split('.');
      if (parts.length !== 3) throw new HttpError(422, `"${variable}" is not a JWT`, 'not_jwt');
      const decode = (p: string) => JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>;
      try {
        const claims = decode(parts[1]!);
        const when = (n: unknown) => (typeof n === 'number' ? new Date(n * 1000).toISOString() : undefined);
        return { header: decode(parts[0]!), claims, expiresAt: when(claims.exp), expired: typeof claims.exp === 'number' ? claims.exp * 1000 < Date.now() : undefined, issuedAt: when(claims.iat) };
      } catch {
        throw new HttpError(422, `"${variable}" is not a JWT`, 'not_jwt');
      }
    },
  );

  // ---------- send ----------
  tool(
    'send_request',
    'send',
    'Sends a saved request (optionally with changes) or a new one, and returns the response. Uses the given or active environment.',
    { requestId: z.string().optional(), ...RequestFields, environment: z.string().optional().describe('Name or id; defaults to the active one') },
    async ({ requestId, environment, ...patch }) => {
      const env = environmentFor(db, environment);
      const saved = requestId ? getRequest(db, requestId) : null;
      if (!saved && !patch.url) throw new HttpError(400, 'Give a requestId, or a url for a new request', 'bad_request');
      const base = saved ?? { name: patch.name ?? 'Claude request', method: 'GET', url: '', collectionId: null };
      const def = RequestDefinition.parse({ ...base, ...toPatch(patch) });
      const res = await send(
        db,
        { requestId: saved?.id, collectionId: saved?.collectionId ?? null, environmentId: env?.id ?? null, request: def },
        { source: 'mcp', guard: secretHostGuard(db, env?.id ?? null) },
      );
      const hidden = hiddenSecrets(db, env);
      return mask(
        {
          historyId: res.historyId,
          request: res.request,
          status: res.status,
          statusText: res.statusText,
          error: res.error,
          timeMs: Math.round(res.timing.totalMs),
          headers: res.headers,
          body: res.bodyEncoding === 'base64' ? `(binary, ${res.size} bytes, ${res.contentType ?? 'unknown type'})` : clip(res.body),
          unresolved: res.unresolved,
          tests: res.scripts.flatMap((s) => s.assertions.map((a) => ({ ok: a.ok, name: a.message, source: s.source }))),
          scriptErrors: res.scripts.filter((s) => s.error).map((s) => `${s.source}: ${s.error}`),
        },
        hidden,
      );
    },
  );

  tool(
    'run_flow',
    'send',
    'Runs a flow and waits for it to finish (up to 2 minutes), then returns the run report.',
    { flowId: z.string(), environment: z.string().optional() },
    async ({ flowId, environment }) => {
      const env = environmentFor(db, environment);
      const exec = runFlow(db, flowId, env?.id ?? null, false, { source: 'mcp', guard: secretHostGuard(db, env?.id ?? null) });
      await Promise.race([waitForExecution(exec.id), new Promise((r) => setTimeout(r, 120_000))]);
      const done = getExecution(db, exec.id);
      if (done.status === 'running' || done.status === 'paused') return { executionId: exec.id, status: done.status, note: 'Still running; check get_flow_run later.' };
      return mask(buildReport(db, exec.id), hiddenSecrets(db, env));
    },
  );

  // ---------- edit ----------
  tool(
    'create_request',
    'edit',
    'Saves a new request in a collection or folder.',
    { collectionId: z.string(), ...RequestFields, name: z.string().min(1), url: z.string() },
    ({ collectionId, ...patch }) => {
      const def = RequestDefinition.parse({ method: 'GET', ...toPatch(patch) });
      return mask(createRequest(db, { ...def, collectionId }), hiddenSecrets(db, environmentFor(db)));
    },
  );

  tool('update_request', 'edit', 'Changes a saved request. Only the given fields change; headers and params replace the existing ones.', { id: z.string(), ...RequestFields }, ({ id, ...patch }) => {
    const r = updateRequest(db, id, toPatch(patch));
    return mask(r, hiddenSecrets(db, environmentFor(db)));
  });

  tool(
    'import_curl',
    'edit',
    'Saves a cURL command as a new request in a collection or folder.',
    { collectionId: z.string(), command: z.string(), name: z.string().optional() },
    ({ collectionId, command, name }) => {
      const parsed = parseCurl(command);
      const r = createRequest(db, { ...parsed.request, ...(name && { name }), collectionId });
      return { request: mask(r, hiddenSecrets(db, environmentFor(db))), warnings: parsed.warnings };
    },
  );

  tool(
    'import_collection',
    'edit',
    'Imports an OpenAPI/Swagger spec, a Postman or Postguy collection, or a HAR recording, from text or a URL, as a new collection.',
    { content: z.string().optional(), url: z.string().url().optional(), name: z.string().optional() },
    async ({ content, url, name }) => {
      if (!content && !url) throw new HttpError(400, 'Give content or a url', 'bad_request');
      const res = await importOpenApi(db, url ? { sourceType: 'url', url, name } : { sourceType: 'paste', content, name });
      return { kind: res.kind, name: res.name, collectionId: res.collectionId, requestCount: res.requestCount, warnings: res.warnings };
    },
  );

  tool(
    'set_variable',
    'edit',
    'Sets a variable on an environment (name or id), a collection or folder (id), a request (id) or globals. Secret values can be written but are never shown back.',
    {
      scope: z.enum(['environment', 'collection', 'request', 'global']),
      owner: z.string().optional().describe('Environment name/id, collection id or request id; not needed for global'),
      key: z.string().min(1),
      value: z.string(),
      secret: z.boolean().optional(),
    },
    ({ scope, owner, key, value, secret }) => {
      let ownerId: string;
      if (scope === 'global') ownerId = listEnvironments(db).find((e) => e.kind === 'global')!.id;
      else if (scope === 'environment') {
        const env = environmentFor(db, owner ?? null);
        if (!env) throw new HttpError(400, 'No environment given and none is active', 'bad_request');
        ownerId = env.id;
      } else if (!owner) throw new HttpError(400, `Give the ${scope} id as owner`, 'bad_request');
      else ownerId = owner;
      const v = setVariable(db, scope, ownerId, key, value, secret);
      return { key: v.key, scope, secret: v.isSecret, value: v.isSecret ? '••••••' : v.value };
    },
  );

  tool('set_active_environment', 'edit', 'Makes an environment active (by name or id), or none.', { environment: z.string().nullable() }, ({ environment }) => {
    const env = environment ? environmentFor(db, environment) : null;
    activateEnvironment(db, env?.id ?? null);
    return { active: env?.name ?? null };
  });

  return server;
}
