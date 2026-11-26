import { eq } from 'drizzle-orm';
import { getIntrospectionQuery } from 'graphql';
import type { GraphqlSchemaInput, GraphqlSchemaResult } from '@postguy/shared';
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { graphqlSchemas } from '../db/schema.ts';
import { HttpError } from '../lib/errors.ts';
import { send } from './send.ts';

/**
 * Asks the request's endpoint for its schema with the standard introspection query, sending it
 * like the request itself (auth, headers, variables, pre-request scripts), and keeps it with a saved request.
 */
export async function fetchGraphqlSchema(db: Db, input: z.output<typeof GraphqlSchemaInput>): Promise<GraphqlSchemaResult> {
  const def = {
    ...input.request,
    method: 'POST' as const,
    body: { mode: 'graphql' as const, raw: getIntrospectionQuery({ descriptions: true, inputValueDeprecation: true }), operationName: 'IntrospectionQuery' },
  };
  const res = await send(db, { requestId: input.requestId ?? null, collectionId: input.collectionId ?? null, request: def }, { remember: false, postScripts: false });
  if (res.error) throw new HttpError(502, `Couldn't reach the endpoint: ${res.error.message}`, 'graphql_unreachable');
  let body: { data?: { __schema?: unknown }; errors?: { message?: string }[] } = {};
  try {
    body = JSON.parse(res.body);
  } catch {
    throw new HttpError(422, `The endpoint answered ${res.status} without JSON, so it doesn't look like GraphQL.`, 'graphql_not_json');
  }
  if (!body.data?.__schema) {
    const why = body.errors?.map((e) => e.message).filter(Boolean).join('; ');
    throw new HttpError(422, why ? `The endpoint refused the schema query: ${why}` : `The endpoint answered ${res.status} without a schema; introspection may be turned off.`, 'graphql_no_schema');
  }
  const fetchedAt = Date.now();
  const url = res.request.url;
  if (input.requestId) {
    db.insert(graphqlSchemas)
      .values({ requestId: input.requestId, schema: body.data, url, fetchedAt })
      .onConflictDoUpdate({ target: graphqlSchemas.requestId, set: { schema: body.data, url, fetchedAt } })
      .run();
  }
  return { schema: body.data, url, fetchedAt };
}

export function getGraphqlSchema(db: Db, requestId: string): GraphqlSchemaResult | null {
  const row = db.select().from(graphqlSchemas).where(eq(graphqlSchemas.requestId, requestId)).get();
  return row ? { schema: row.schema, url: row.url, fetchedAt: row.fetchedAt } : null;
}
