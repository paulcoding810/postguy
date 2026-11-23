import type { FastifyInstance } from 'fastify';
import { CurlParseError, parseCurl, swapInVariables, toFetch, type ResolvedRequest, resolveRequest, resolveTemplate, redactText, toCurl, MASK, type RefResolution } from '@postguy/core';
import { CurlExportInput, CurlImportInput, GraphqlSchemaInput, OAuthTokenInput, ResolvePreviewInput, SendInput, type ContextVariable, type ResolvedPreview } from '@postguy/shared';
import { HttpError } from '../lib/errors.ts';
import { needsTokenExchange } from '../services/oauth.ts';
import { badRequest } from '../lib/errors.ts';
import { callbackPage, completeSignIn, exchangeToken, signInStatus, startSignIn, tokenSummary } from '../services/oauth.ts';
import { effectiveAuth } from '../services/collections.ts';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { parse } from '../lib/errors.ts';
import { buildContext } from '../services/context.ts';
import { effectiveSettings } from '../services/settings.ts';
import { previewLookup, stepCollectionId } from '../services/flows.ts';
import { getRequest } from '../services/requests.ts';
import { send } from '../services/send.ts';
import { fetchGraphqlSchema, getGraphqlSchema } from '../services/graphql.ts';

const PREVIEW_MAX = 200;

export function sendRoutes(app: FastifyInstance, db: Db) {
  app.post('/send', async (req, reply) => {
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    return send(db, parse(SendInput, req.body), { signal: controller.signal });
  });

  app.post('/oauth/token', async (req) => {
    const input = parse(OAuthTokenInput, req.body);
    const saved = input.requestId ? getRequest(db, input.requestId) : null;
    const collectionId = input.collectionId ?? saved?.collectionId ?? null;
    const auth = effectiveAuth(db, collectionId, input.auth);
    if (auth.type !== 'oauth2') throw badRequest('This request does not use OAuth 2.0');
    const { ctx } = buildContext(db, { collectionId, requestId: saved?.id ?? null });
    return tokenSummary(await exchangeToken(auth, ctx, { refresh: input.refresh }));
  });

  app.post('/import/curl', async (req) => {
    try {
      const input = parse(CurlImportInput, req.body);
      const parsed = parseCurl(input.command);
      if (!input.useVariables) return { ...parsed, variables: [] };
      const saved = input.requestId ? getRequest(db, input.requestId) : null;
      const { ctx } = buildContext(db, { collectionId: input.collectionId ?? saved?.collectionId ?? null, requestId: saved?.id ?? null });
      const values = [...ctx.variables.entries()].filter(([, v]) => v.source !== 'runtime').map(([key, v]) => ({ key, value: resolveTemplate(v.value, ctx).value, source: v.source }));
      const { request, used } = swapInVariables(parsed.request, values);
      return used.length ? { request, warnings: parsed.warnings, variables: used, raw: parsed.request } : { ...parsed, variables: [] };
    } catch (e) {
      if (e instanceof CurlParseError) throw new HttpError(422, e.message, 'invalid_curl');
      throw e;
    }
  });

  /** The request with variables and auth resolved, as a cURL command or a fetch call, so it runs outside Postguy. */
  const exportAs = async (body: unknown, format: (r: ResolvedRequest, opts: { insecure?: boolean }) => string) => {
    const input = parse(CurlExportInput, body);
    const saved = input.requestId ? getRequest(db, input.requestId) : null;
    const collectionId = input.collectionId ?? saved?.collectionId ?? null;
    const { ctx } = buildContext(db, { collectionId, requestId: saved?.id ?? null });
    let auth = effectiveAuth(db, collectionId, input.request.auth);
    if (needsTokenExchange(auth, ctx)) {
      try {
        auth = { ...auth, accessToken: (await exchangeToken(auth, ctx)).token };
      } catch {
        /* leave the Authorization header out */
      }
    }
    const r = resolveRequest(input.request, ctx, auth);
    return { command: format(r.request, { insecure: effectiveSettings(db, input.request.settings).rejectUnauthorized === false }), containsSecrets: r.secrets.length > 0, unresolved: r.unresolved };
  };
  app.post('/export/curl', async (req) => exportAs(req.body, toCurl));
  app.post('/graphql/schema', async (req) => fetchGraphqlSchema(db, parse(GraphqlSchemaInput, req.body)));
  app.get('/requests/:id/graphql-schema', async (req) => getGraphqlSchema(db, parse(z.object({ id: z.string() }), req.params).id));
  app.post('/export/fetch', async (req) => exportAs(req.body, toFetch));

  app.post('/oauth/authorize', async (req) => {
    const input = parse(OAuthTokenInput, req.body);
    const saved = input.requestId ? getRequest(db, input.requestId) : null;
    const collectionId = input.collectionId ?? saved?.collectionId ?? null;
    const auth = effectiveAuth(db, collectionId, input.auth);
    if (auth.type !== 'oauth2') throw badRequest('This request does not use OAuth 2.0');
    const { ctx } = buildContext(db, { collectionId, requestId: saved?.id ?? null });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : Number((req.headers.host ?? '').split(':')[1] || 80);
    return startSignIn(auth, ctx, `http://127.0.0.1:${port}`);
  });

  app.get('/oauth/authorize/:state', async (req) => signInStatus(parse(z.object({ state: z.string() }), req.params).state));

  app.get('/oauth/callback', async (req, reply) => {
    const result = await completeSignIn(req.query as Record<string, string | undefined>);
    return reply.code(result.ok ? 200 : 400).type('text/html; charset=utf-8').send(callbackPage(result.ok, result.message));
  });

  app.get('/context-variables', async (req): Promise<ContextVariable[]> => {
    const q = parse(ContextQuery, req.query);
    const saved = q.requestId ? getRequest(db, q.requestId) : null;
    const { ctx } = buildContext(db, { collectionId: q.collectionId ?? saved?.collectionId ?? null, requestId: saved?.id ?? null, flowId: q.flowId });
    return [...ctx.variables.entries()]
      .map(([key, v]) => {
        const r = resolveTemplate(v.value, ctx);
        return {
          key,
          source: v.source,
          secret: v.secret,
          preview: v.secret ? MASK : truncatePreview(redactText(r.value, r.secrets)),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  });

  app.post('/resolve-preview', async (req): Promise<ResolvedPreview[]> => {
    const input = parse(ResolvePreviewInput, req.body);
    const saved = input.requestId ? getRequest(db, input.requestId) : null;
    const inFlow = input.flowId && input.stepId;
    const { ctx } = buildContext(db, {
      collectionId: inFlow ? stepCollectionId(db, input.flowId!, input.stepId!) : (input.collectionId ?? saved?.collectionId ?? null),
      requestId: saved?.id ?? null,
      environmentId: input.environmentId,
      flowId: input.flowId,
      responses: inFlow ? previewLookup(db, input.flowId!, input.stepId!) : undefined,
    });
    return input.templates.map((template) => {
      const r = resolveTemplate(template, ctx);
      const secretValues = r.secrets;
      return {
        template,
        value: redactText(r.value, secretValues),
        unresolved: r.unresolved,
        refs: r.refs.map((x) => toPreviewRef(x)),
      };
    });
  });
}

const ContextQuery = z.object({ collectionId: z.string().optional(), requestId: z.string().optional(), flowId: z.string().optional() });

function truncatePreview(s: string): string {
  return s.length > PREVIEW_MAX ? `${s.slice(0, PREVIEW_MAX)}…` : s;
}

function toPreviewRef(r: RefResolution): ResolvedPreview['refs'][number] {
  let preview: string | null = null;
  if (r.found) {
    const s = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
    preview = r.secret ? MASK : truncatePreview(s);
  }
  return {
    ref: r.ref,
    resolved: r.found,
    source: r.source === 'response' ? `response:${r.responseName}` : r.source,
    secret: r.secret,
    preview: preview ?? r.error ?? null,
    ...(r.ownerId && { ownerId: r.ownerId }),
    ...(r.shadowed?.length && { shadowed: r.shadowed.map((s) => ({ source: s.source, preview: s.secret ? MASK : truncatePreview(s.value), ownerId: s.ownerId })) }),
  };
}
