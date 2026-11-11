import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type {
  Auth,
  Body,
  CollectionKind,
  EnvironmentKind,
  HttpMethod,
  JsonSchema,
  KeyValue,
  OpenApiSourceType,
  PathEntry,
  RequestSettings,
  Timing,
  VariableScope,
} from '@postguy/shared';

const id = () => text('id').primaryKey();
const createdAt = () => integer('created_at').notNull().default(sql`(unixepoch() * 1000)`);
const updatedAt = () => integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`);
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const collections = sqliteTable(
  'collections',
  {
    id: id(),
    parentId: text('parent_id').references((): AnySQLiteColumn => collections.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<CollectionKind>().notNull(),
    name: text('name').notNull(),
    description: text('description'),
    auth: json<Auth>('auth_json').notNull().default({ type: 'none' }),
    sortOrder: integer('sort_order').notNull().default(0),
    openapiSpecId: text('openapi_spec_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('collections_parent_idx').on(t.parentId, t.sortOrder)],
);

export const requests = sqliteTable(
  'requests',
  {
    id: id(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    method: text('method').$type<HttpMethod>().notNull(),
    url: text('url').notNull().default(''),
    params: json<KeyValue[]>('params_json').notNull().default([]),
    pathParams: json<KeyValue[]>('path_params_json').notNull().default([]),
    headers: json<KeyValue[]>('headers_json').notNull().default([]),
    auth: json<Auth>('auth_json').notNull().default({ type: 'inherit' }),
    body: json<Body>('body_json').notNull().default({ mode: 'none' }),
    settings: json<RequestSettings>('settings_json').notNull().default({}),
    openapiOperationId: text('openapi_operation_id'),
    openapiFingerprint: text('openapi_fingerprint'),
    latestSuccessSnapshotId: text('latest_success_snapshot_id'),
    pinnedSnapshotId: text('pinned_snapshot_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('requests_collection_idx').on(t.collectionId, t.sortOrder),
    index('requests_operation_idx').on(t.openapiOperationId),
  ],
);

export const environments = sqliteTable('environments', {
  id: id(),
  kind: text('kind').$type<EnvironmentKind>().notNull(),
  name: text('name').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const variables = sqliteTable(
  'variables',
  {
    id: id(),
    scope: text('scope').$type<VariableScope>().notNull(),
    ownerId: text('owner_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull().default(''),
    isSecret: integer('is_secret', { mode: 'boolean' }).notNull().default(false),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('variables_owner_key_uq').on(t.scope, t.ownerId, t.key)],
);

export const requestHistory = sqliteTable(
  'request_history',
  {
    id: id(),
    requestId: text('request_id').references(() => requests.id, { onDelete: 'set null' }),
    environmentId: text('environment_id').references(() => environments.id, { onDelete: 'set null' }),
    method: text('method').notNull(),
    url: text('url').notNull(),
    request: json<{ headers: Record<string, string>; body: string | null }>('request_json').notNull(),
    status: integer('status'),
    statusText: text('status_text'),
    responseHeaders: json<Record<string, string>>('response_headers_json').notNull().default({}),
    responseBody: text('response_body'),
    truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
    bodySize: integer('body_size').notNull().default(0),
    contentType: text('content_type'),
    timing: json<Timing>('timing_json').notNull(),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('history_request_idx').on(t.requestId, t.createdAt),
    index('history_created_idx').on(t.createdAt),
  ],
);

export const openapiSpecs = sqliteTable('openapi_specs', {
  id: id(),
  collectionId: text('collection_id')
    .notNull()
    .unique()
    .references(() => collections.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sourceType: text('source_type').$type<OpenApiSourceType>().notNull(),
  sourceUrl: text('source_url'),
  currentVersionId: text('current_version_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const openapiVersions = sqliteTable(
  'openapi_versions',
  {
    id: id(),
    specId: text('spec_id')
      .notNull()
      .references(() => openapiSpecs.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    rawText: text('raw_text').notNull(),
    model: text('model_json', { mode: 'json' }).notNull(),
    hash: text('hash').notNull(),
    importedAt: integer('imported_at').notNull(),
  },
  (t) => [index('openapi_versions_spec_idx').on(t.specId, t.importedAt)],
);

export const responseSchemas = sqliteTable('response_schemas', {
  id: id(),
  hash: text('hash').notNull().unique(),
  schema: json<JsonSchema>('schema_json').notNull(),
  firstSeenAt: integer('first_seen_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  seenCount: integer('seen_count').notNull().default(1),
});

export const responseSnapshots = sqliteTable(
  'response_snapshots',
  {
    id: id(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    historyId: text('history_id').references(() => requestHistory.id, { onDelete: 'set null' }),
    schemaId: text('schema_id')
      .notNull()
      .references(() => responseSchemas.id),
    status: integer('status').notNull(),
    isSuccess: integer('is_success', { mode: 'boolean' }).notNull(),
    body: text('body_json').notNull(),
    contentHash: text('content_hash').notNull(),
    paths: json<PathEntry[]>('paths_json').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('snapshots_request_idx').on(t.requestId, t.isSuccess, t.createdAt)],
);
