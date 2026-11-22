import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseCurl, resolveTemplate } from '@postguy/core';
import { HTTP_METHODS, newId, RequestDefinition, type CollectionTreeNode, type KeyValue } from '@postguy/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.ts';
import { changeLog, collections, requests } from '../../db/schema.ts';
import { HttpError } from '../../lib/errors.ts';
import { VERSION } from '../../lib/version.ts';
import { ancestry, createCollection, deleteCollection, effectiveAuth, getCollection, getTree, subtreeIds, updateCollection } from '../collections.ts';
import { buildContext } from '../context.ts';
import { activateEnvironment, listEnvironments } from '../environments.ts';
import { getExecution, getFlow, listFlows, runFlow, waitForExecution } from '../flows.ts';
import { getHistoryEntry, listHistory } from '../history.ts';
import { importOpenApi } from '../openapi.ts';
import { buildReport } from '../report.ts';
import { createRequest, deleteRequest, getRequest, updateRequest } from '../requests.ts';
import { getChange, rootIdOf, withSource } from '../changelog.ts';
import { restoreChange } from '../changeRestore.ts';
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
Use list_requests to find requests, then send_request by id. Everything you send is labelled "MCP" in the user's history.
Deleting is a separate permission. Every deletion can be undone with restore_change and the changeId it returns;
tell the user what you deleted.`;

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };

const MAX_DELETE_REQUESTS = 50;
const MAX_MOVE = 50;

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
      { description, inputSchema, annotations: { readOnlyHint: need === 'read', destructiveHint: need === 'delete', openWorldHint: need === 'send' } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any) => {
        try {
          requirePermission(db, need);
          // A restore only brings back what the user had, so its hosts stay trusted.
          const hostsBefore = need === 'edit' && name !== 'restore_change' ? allKnownHosts(db) : null;
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

  // ---------- folders ----------
  tool('list_folders', 'read', 'Lists collections and folders as a tree, with ids and request counts, including empty folders.', {}, () => {
    const walk = (nodes: CollectionTreeNode[]): unknown[] =>
      nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind, requests: n.requests.length, ...(n.children.length && { folders: walk(n.children) }) }));
    return walk(getTree(db));
  });

  tool(
    'create_folder',
    'edit',
    'Creates a folder inside a collection or folder, or a new top-level collection when parentId is left out.',
    { name: z.string().min(1), parentId: z.string().optional().describe('Collection or folder id; omit for a new collection') },
    ({ name, parentId }) => {
      const c = createCollection(db, { name, parentId: parentId ?? null });
      return { id: c.id, name: c.name, kind: c.kind, parentId: c.parentId };
    },
  );

  tool('rename_folder', 'edit', 'Renames a collection or folder.', { id: z.string(), name: z.string().min(1) }, ({ id, name }) => {
    const c = updateCollection(db, id, { name });
    return { id: c.id, name: c.name };
  });

  tool(
    'move',
    'edit',
    `Moves requests and folders into a collection or folder, or folders to the top level as their own collections. Give one id or up to ${MAX_MOVE} ids; every one is checked first and nothing moves unless all can. Reports when a request will use different auth, a different host, or a variable that isn't defined in its new place.`,
    {
      id: z.string().optional().describe('One request, folder or collection id'),
      ids: z.array(z.string()).max(MAX_MOVE).optional().describe('Several ids, moved together'),
      to: z.string().nullable().optional().describe('Destination collection or folder id; null or omitted moves folders to the top level'),
    },
    ({ id, ids, to }) => {
      const list = [...new Set([...(id ? [id] : []), ...(ids ?? [])])];
      if (!list.length) throw new HttpError(400, 'Give an id or ids to move', 'bad_request');
      const target = to ?? null;
      if (target) getCollection(db, target);

      const problems: string[] = [];
      const items = list.map((itemId) => {
        if (db.select({ id: requests.id }).from(requests).where(eq(requests.id, itemId)).get()) {
          if (!target) problems.push(`${itemId}: a request has to go into a collection or folder`);
          return { id: itemId, kind: 'request' as const };
        }
        if (!db.select({ id: collections.id }).from(collections).where(eq(collections.id, itemId)).get()) {
          problems.push(`${itemId}: no such request or folder`);
          return null;
        }
        if (target && subtreeIds(db, itemId).includes(target)) problems.push(`${itemId}: cannot move a folder into itself or one of its own folders`);
        return { id: itemId, kind: 'folder' as const };
      });
      if (problems.length) throw new HttpError(400, `Nothing was moved. ${problems.join('; ')}.`, 'mcp_move_invalid');

      const where = target ? folderPath(target) : '(top level)';
      const before = new Map(items.filter((i) => i?.kind === 'request').map((i) => [i!.id, requestView(i!.id)]));
      const moved = db.transaction(() =>
        items.map((item) => {
          if (item!.kind === 'request') {
            const r = updateRequest(db, item!.id, { collectionId: target! });
            return { id: r.id, name: r.name, kind: 'request', changeId: lastChange(r.id) };
          }
          const oldRoot = rootIdOf(db, item!.id);
          const c = updateCollection(db, item!.id, { parentId: target });
          const note = oldRoot !== rootIdOf(db, c.id) && c.parentId ? `inherits auth, variables and scripts from "${getCollection(db, rootIdOf(db, c.id)).name}" now` : null;
          return { id: c.id, name: c.name, kind: c.kind, changeId: lastChange(c.id), ...(note && { note }) };
        }),
      );

      // Group what changed for requests, so a batch gets one readable summary.
      const groups = new Map<string, string[]>();
      for (const [reqId, was] of before) for (const n of moveNotes(was, requestView(reqId))) groups.set(n, [...(groups.get(n) ?? []), getRequest(db, reqId).name]);
      const notes = [
        ...[...groups].map(([n, names]) => (list.length === 1 ? n : `${n} (${names.length === 1 ? names[0] : `${names.length} requests: ${names.slice(0, 10).join(', ')}${names.length > 10 ? '…' : ''}`})`)),
        ...moved.filter((m) => 'note' in m && m.note).map((m) => `"${m.name}" ${(m as { note: string }).note}.`),
      ];
      if (list.length === 1) {
        const m = moved[0]!;
        return { moved: m.name, kind: m.kind, to: where, changeId: m.changeId, notes };
      }
      return { moved: moved.map(({ note: _n, ...m }: { note?: string } & typeof moved[number]) => m), to: where, notes, undo: 'restore_change with these changeIds puts them all back.' };
    },
  );

  const lastChange = (entityId: string) =>
    db.select({ id: changeLog.id }).from(changeLog).where(eq(changeLog.entityId, entityId)).orderBy(desc(changeLog.updatedAt)).get()?.id ?? null;

  /** What a request will actually use: its auth type and the URL with variables resolved. */
  const requestView = (id: string) => {
    const r = getRequest(db, id);
    const { ctx } = buildContext(db, { collectionId: r.collectionId, requestId: id });
    const url = resolveTemplate(r.url, ctx);
    return { auth: effectiveAuth(db, r.collectionId, r.auth).type, origin: originOf(url.unresolved.length ? '' : url.value), unresolved: url.unresolved };
  };
  const originOf = (url: string) => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  };
  const moveNotes = (a: ReturnType<typeof requestView>, b: ReturnType<typeof requestView>) => [
    ...(a.auth !== b.auth ? [`Auth changes from ${a.auth} to ${b.auth}.`] : []),
    ...(a.origin !== b.origin && b.origin ? [`It now goes to ${b.origin} instead of ${a.origin ?? 'an unresolved URL'}.`] : []),
    ...b.unresolved.filter((u) => !a.unresolved.includes(u)).map((u) => `{{${u}}} is not defined here.`),
  ];
  const folderPath = (id: string) =>
    ancestry(db, id)
      .reverse()
      .map((c) => c.name)
      .join(' / ');

  // ---------- delete ----------
  /** The change that recorded a deletion, so Claude can hand back a way to undo it. */
  const deletionOf = (entityId: string) =>
    db
      .select({ id: changeLog.id })
      .from(changeLog)
      .where(and(eq(changeLog.entityId, entityId), eq(changeLog.action, 'delete')))
      .orderBy(desc(changeLog.updatedAt))
      .get()?.id ?? null;

  tool('delete_request', 'delete', 'Deletes one saved request. It can be brought back with restore_change and the returned changeId.', { id: z.string() }, ({ id }) => {
    const r = getRequest(db, id);
    deleteRequest(db, id);
    return { deleted: r.name, changeId: deletionOf(id), undo: `The user can bring it back from Change history (“Bring back”), or call restore_change.` };
  });

  tool(
    'delete_folder',
    'delete',
    `Deletes one folder or collection with everything in it, up to ${MAX_DELETE_REQUESTS} requests. It can be brought back with restore_change and the returned changeId.`,
    { id: z.string() },
    ({ id }) => {
      const c = getCollection(db, id);
      const ids = subtreeIds(db, id);
      const count = db.select({ id: requests.id }).from(requests).where(inArray(requests.collectionId, ids)).all().length;
      if (count > MAX_DELETE_REQUESTS)
        throw new HttpError(409, `"${c.name}" holds ${count} requests; Claude may delete at most ${MAX_DELETE_REQUESTS} at once. Delete its subfolders one by one, or ask the user to delete it.`, 'mcp_delete_too_large');
      deleteCollection(db, id);
      return {
        deleted: c.name,
        kind: c.parentId ? 'folder' : 'collection',
        requests: count,
        changeId: deletionOf(id),
        undo: c.parentId ? 'The user can bring it back from the collection’s Change history, or call restore_change.' : 'The user can bring it back from Recently deleted, or call restore_change.',
      };
    },
  );

  tool(
    'restore_change',
    'edit',
    'Undoes changes from the change history: brings back deleted requests, folders or collections, or restores the version before an edit or move. Give one changeId or several; the newest are undone first.',
    { changeId: z.string().optional(), changeIds: z.array(z.string()).max(200).optional() },
    ({ changeId, changeIds }) => {
      const list = [...new Set([...(changeId ? [changeId] : []), ...(changeIds ?? [])])];
      if (!list.length) throw new HttpError(400, 'Give a changeId or changeIds', 'bad_request');
      const found = list.map((cid) => ({ cid, change: getChange(db, cid) }));
      if (list.length === 1) {
        if (!found[0]!.change) throw new HttpError(404, 'No such change', 'not_found');
        return restoreChange(db, list[0]!);
      }
      const order = found.filter((f) => f.change).sort((a, b) => b.change!.updatedAt - a.change!.updatedAt);
      const results = order.map(({ cid }) => {
        try {
          return { changeId: cid, message: restoreChange(db, cid).message };
        } catch (e) {
          return { changeId: cid, error: (e as Error).message };
        }
      });
      return [...results, ...found.filter((f) => !f.change).map((f) => ({ changeId: f.cid, error: 'No such change' }))];
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
