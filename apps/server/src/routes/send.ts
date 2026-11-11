import type { FastifyInstance } from 'fastify';
import { resolveTemplate, MASK, type RefResolution } from '@postguy/core';
import { ResolvePreviewInput, SendInput, type ResolvedPreview } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { parse } from '../lib/errors.ts';
import { buildContext } from '../services/context.ts';
import { getRequest } from '../services/requests.ts';
import { send } from '../services/send.ts';

const PREVIEW_MAX = 200;

export function sendRoutes(app: FastifyInstance, db: Db) {
  app.post('/send', async (req, reply) => {
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    return send(db, parse(SendInput, req.body), controller.signal);
  });

  app.post('/resolve-preview', async (req): Promise<ResolvedPreview[]> => {
    const input = parse(ResolvePreviewInput, req.body);
    const saved = input.requestId ? getRequest(db, input.requestId) : null;
    const { ctx } = buildContext(db, {
      collectionId: input.collectionId ?? saved?.collectionId ?? null,
      requestId: saved?.id ?? null,
      environmentId: input.environmentId,
    });
    return input.templates.map((template) => {
      const r = resolveTemplate(template, ctx);
      const secretValues = r.secrets;
      return {
        template,
        value: secretValues.reduce((v, s) => v.split(s).join(MASK), r.value),
        unresolved: r.unresolved,
        refs: r.refs.map((x) => toPreviewRef(x)),
      };
    });
  });
}

function toPreviewRef(r: RefResolution): ResolvedPreview['refs'][number] {
  let preview: string | null = null;
  if (r.found) {
    const s = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
    preview = r.secret ? MASK : s.length > PREVIEW_MAX ? `${s.slice(0, PREVIEW_MAX)}…` : s;
  }
  return {
    ref: r.ref,
    resolved: r.found,
    source: r.source === 'response' ? `response:${r.responseName}` : r.source,
    secret: r.secret,
    preview: preview ?? r.error ?? null,
  };
}
