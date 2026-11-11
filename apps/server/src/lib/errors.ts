import type { FastifyInstance } from 'fastify';
import { ZodError, type ZodType, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`, 'not_found');
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, 'bad_request', details);

export function parse<S extends ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw badRequest('Validation failed', formatZod(r.error));
  return r.data;
}

function formatZod(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: { code: 'bad_request', message: err.message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: err.message || 'Internal error' } });
  });
}
