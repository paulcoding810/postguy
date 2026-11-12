import { z } from 'zod';
import {
  Auth,
  Body,
  HttpMethod,
  KeyValue,
  RequestDefinition,
  RequestSettings,
  VariableScope,
  type ApiModel,
  type Collection,
  type CollectionTreeNode,
  type Environment,
  type HistoryEntry,
  type HistorySummary,
  type JsonSchema,
  type OpenApiOperation,
  type OpenApiSpec,
  type OpenApiSpecDetail,
  type PathEntry,
  type ResponseSnapshot,
  type SavedRequest,
  type SendResult,
  type SnapshotSummary,
  type Variable,
} from './models.ts';
import type {
  Flow,
  FlowDetail,
  FlowExecution,
  FlowExecutionDetail,
  FlowSource,
  MappingSuggestion,
} from './flows.ts';
import type { z as zt } from 'zod';
import type { CreateFlowInput, UpdateFlowInput, FlowGraphInput } from './flows.ts';

export const CreateCollectionInput = z.object({
  name: z.string().min(1),
  parentId: z.string().nullable().default(null),
  kind: z.enum(['collection', 'folder']).optional(),
  description: z.string().nullable().optional(),
  auth: Auth.optional(),
});
export type CreateCollectionInput = z.input<typeof CreateCollectionInput>;

export const UpdateCollectionInput = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  auth: Auth.optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateCollectionInput = z.input<typeof UpdateCollectionInput>;

export const CreateRequestInput = RequestDefinition.extend({
  collectionId: z.string(),
  description: z.string().nullable().optional(),
});
export type CreateRequestInput = z.input<typeof CreateRequestInput>;

/** Every field optional and without defaults, so a partial update never resets other fields. */
export const UpdateRequestInput = z.object({
  name: z.string().min(1).optional(),
  method: HttpMethod.optional(),
  url: z.string().optional(),
  params: z.array(KeyValue).optional(),
  pathParams: z.array(KeyValue).optional(),
  headers: z.array(KeyValue).optional(),
  auth: Auth.optional(),
  body: Body.optional(),
  settings: RequestSettings.optional(),
  scripts: z.object({ pre: z.string().max(100_000).optional(), post: z.string().max(100_000).optional() }).optional(),
  collectionId: z.string().optional(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateRequestInput = z.input<typeof UpdateRequestInput>;

export const CreateEnvironmentInput = z.object({ name: z.string().min(1) });
export const UpdateEnvironmentInput = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
});

export const VariableInput = z.object({
  key: z.string().min(1),
  value: z.string(),
  isSecret: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type VariableInput = z.input<typeof VariableInput>;

export const ReplaceVariablesInput = z.object({ variables: z.array(VariableInput) });
export const VariableOwnerParams = z.object({ scope: VariableScope, ownerId: z.string() });

export const SendInput = z.object({
  requestId: z.string().nullable().optional(),
  collectionId: z.string().nullable().optional(),
  environmentId: z.string().nullable().optional(),
  request: RequestDefinition,
});
export type SendInput = z.input<typeof SendInput>;

export const ResolvePreviewInput = z.object({
  collectionId: z.string().nullable().optional(),
  flowId: z.string().nullable().optional(),
  stepId: z.string().nullable().optional(),
  requestId: z.string().nullable().optional(),
  environmentId: z.string().nullable().optional(),
  templates: z.array(z.string()).max(200),
});
export type ResolvePreviewInput = z.input<typeof ResolvePreviewInput>;

export interface ResolvedPreview {
  template: string;
  value: string;
  unresolved: string[];
  refs: { ref: string; resolved: boolean; source: string | null; secret: boolean; preview: string | null }[];
}

export const HistoryQuery = z.object({
  requestId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const ImportCollectionInput = z.object({ data: z.unknown() });

export const OpenApiImportInput = z.object({
  sourceType: z.enum(['file', 'paste', 'url']),
  content: z.string().optional(),
  url: z.string().url().optional(),
  name: z.string().optional(),
});
export type OpenApiImportInput = z.input<typeof OpenApiImportInput>;

export interface OpenApiImportResult {
  spec: OpenApiSpec;
  collectionId: string;
  requestCount: number;
  warnings: string[];
}

export interface ContextVariable {
  key: string;
  source: string;
  secret: boolean;
  preview: string;
}

export interface ReferenceSource {
  requestId: string;
  name: string;
  method: string;
  collectionId: string;
  snapshot: SnapshotSummary | null;
  pinned: boolean;
  /** Another request with the same name takes precedence for `{{name.…}}` references. */
  shadowed: boolean;
  paths: PathEntry[];
}

export interface EffectiveSchema {
  requestId: string;
  inferred: JsonSchema | null;
  snapshotCount: number;
  expected: { status: string; schema: JsonSchema }[];
}

export interface CollectionExport {
  format: 'postguy-collection';
  version: 1;
  collection: ExportedCollection;
}

export interface ExportedCollection {
  name: string;
  description: string | null;
  auth: Auth;
  variables: { key: string; value: string; isSecret: boolean }[];
  folders: ExportedCollection[];
  requests: (RequestDefinition & { description: string | null })[];
}

type Empty = Record<string, never>;

export interface ApiRoutes {
  'GET /health': { response: { ok: true; version: string } };

  'GET /collections/tree': { response: CollectionTreeNode[] };
  'POST /collections': { body: CreateCollectionInput; response: Collection };
  'PATCH /collections/:id': { body: UpdateCollectionInput; response: Collection };
  'DELETE /collections/:id': { response: { ok: true } };
  'GET /collections/:id': { response: Collection };
  'GET /collections/:id/export': { response: CollectionExport };
  'GET /collections/:id/export/openapi': { query: { format?: 'json' | 'yaml' }; response: string };
  'POST /collections/import': { body: { data: unknown }; response: Collection };

  'GET /requests/:id': { response: SavedRequest };
  'POST /requests': { body: CreateRequestInput; response: SavedRequest };
  'PATCH /requests/:id': { body: UpdateRequestInput; response: SavedRequest };
  'DELETE /requests/:id': { response: { ok: true } };
  'POST /requests/:id/duplicate': { body: Empty; response: SavedRequest };

  'GET /environments': { response: Environment[] };
  'POST /environments': { body: { name: string }; response: Environment };
  'PATCH /environments/:id': { body: { name?: string; sortOrder?: number }; response: Environment };
  'DELETE /environments/:id': { response: { ok: true } };
  'POST /environments/:id/activate': { body: Empty; response: Environment };
  'POST /environments/deactivate': { body: Empty; response: { ok: true } };

  'GET /variables/:scope/:ownerId': { query: { reveal?: '1' }; response: Variable[] };
  'PUT /variables/:scope/:ownerId': { body: { variables: VariableInput[] }; response: Variable[] };

  'POST /send': { body: SendInput; response: SendResult };
  'POST /resolve-preview': { body: ResolvePreviewInput; response: ResolvedPreview[] };
  'GET /context-variables': { query: { collectionId?: string; requestId?: string; flowId?: string }; response: ContextVariable[] };

  'GET /history': { query: { requestId?: string; limit?: number }; response: HistorySummary[] };
  'GET /history/:id': { response: HistoryEntry };
  'DELETE /history': { response: { ok: true } };

  'GET /openapi': { response: OpenApiSpec[] };
  'POST /openapi/import': { body: OpenApiImportInput; response: OpenApiImportResult };
  'GET /openapi/:id': { response: OpenApiSpecDetail };
  'DELETE /openapi/:id': { response: { ok: true } };
  'GET /requests/:id/operation': { response: { model: Pick<ApiModel, 'title' | 'version'>; operation: OpenApiOperation } | null };

  'GET /reference-sources': { query: { collectionId?: string }; response: ReferenceSource[] };
  'GET /requests/:id/snapshots': { response: SnapshotSummary[] };
  'GET /snapshots/:id': { response: ResponseSnapshot };
  'POST /requests/:id/pin-snapshot': { body: { snapshotId: string | null }; response: SavedRequest };
  'GET /requests/:id/schema': { response: EffectiveSchema };

  'GET /flows': { response: Flow[] };
  'POST /flows': { body: zt.input<typeof CreateFlowInput>; response: FlowDetail };
  'GET /flows/:id': { response: FlowDetail };
  'PATCH /flows/:id': { body: zt.input<typeof UpdateFlowInput>; response: FlowDetail };
  'DELETE /flows/:id': { response: { ok: true } };
  'PUT /flows/:id/graph': { body: zt.input<typeof FlowGraphInput>; response: FlowDetail };
  'POST /flows/:id/run': { body: { environmentId?: string | null }; response: FlowExecution };
  'GET /flows/:id/executions': { response: FlowExecution[] };
  'GET /flows/:id/sources': { query: { stepId: string }; response: FlowSource[] };
  'POST /flows/:id/suggest-mappings': { body: { stepId: string }; response: MappingSuggestion[] };
  'GET /executions/:id': { response: FlowExecutionDetail };
  'POST /executions/:id/stop': { body: Record<string, never>; response: { ok: true } };
  'POST /executions/:id/steps/:stepId/rerun': { body: Record<string, never>; response: FlowExecution };
}

export type RouteKey = keyof ApiRoutes;
export type RouteBody<K extends RouteKey> = ApiRoutes[K] extends { body: infer B } ? B : never;
export type RouteQuery<K extends RouteKey> = ApiRoutes[K] extends { query: infer Q } ? Q : never;
export type RouteResponse<K extends RouteKey> = ApiRoutes[K]['response'];
