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
  FlowConnection,
  FlowDetail,
  FlowExecution,
  FlowExecutionDetail,
  FlowSettings,
  FlowSource,
  FlowStep,
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
export const SetVariableInput = z.object({ value: z.string(), isSecret: z.boolean().optional() });

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
  refs: {
    ref: string;
    resolved: boolean;
    source: string | null;
    secret: boolean;
    preview: string | null;
    /** The collection, environment, flow or request that defines the variable. */
    ownerId?: string;
    /** Values of the same name in lower-precedence scopes, which this one hides. */
    shadowed?: { source: string; preview: string; ownerId?: string }[];
  }[];
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
  /** What the file turned out to be; collections are imported without a spec. */
  kind: 'openapi' | 'postman' | 'postguy';
  name: string;
  spec: OpenApiSpec | null;
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

export interface OperationSummary {
  id: string;
  method: string;
  path: string;
  summary?: string;
}

export interface SpecDiffSummary {
  added: OperationSummary[];
  removed: OperationSummary[];
  changed: (OperationSummary & { changes: string[] })[];
  unchanged: number;
  servers: { before: string[]; after: string[] } | null;
  info: { before: string; after: string } | null;
}

export type SyncAction = 'create' | 'update' | 'keep-edited' | 'orphaned' | 'unchanged';

export interface SyncPlan {
  upToDate: boolean;
  fromVersion: string;
  toVersion: string;
  diff: SpecDiffSummary;
  requests: { requestId: string | null; name: string; operation: string; label: string; action: SyncAction; changes?: string[] }[];
  warnings: string[];
}

export interface SyncResult extends SyncPlan {
  versionId: string | null;
}

export const SyncInput = z.object({
  sourceType: z.enum(['file', 'paste', 'url']).optional(),
  content: z.string().optional(),
  url: z.string().url().optional(),
});
export type SyncInput = z.input<typeof SyncInput>;

export const OAuthTokenInput = z.object({
  auth: Auth,
  collectionId: z.string().nullable().optional(),
  requestId: z.string().nullable().optional(),
  refresh: z.boolean().optional(),
});
export type OAuthTokenInput = z.input<typeof OAuthTokenInput>;

export interface OAuthTokenResult {
  tokenPreview: string;
  tokenType: string;
  expiresAt: number | null;
  scope: string | null;
  cached: boolean;
}

export interface OAuthAuthorizeResult {
  state: string;
  authorizationUrl: string;
  redirectUri: string;
}

export interface OAuthSignInStatus {
  status: 'pending' | 'done' | 'error';
  error: string | null;
  token: OAuthTokenResult | null;
}

export const CurlImportInput = z.object({ command: z.string().min(1).max(1_000_000) });
export interface CurlImportResult {
  request: z.output<typeof RequestDefinition>;
  warnings: string[];
}
export const CurlExportInput = z.object({
  request: RequestDefinition,
  collectionId: z.string().nullable().optional(),
  requestId: z.string().nullable().optional(),
});
export type CurlExportInput = z.input<typeof CurlExportInput>;
export interface CurlExportResult {
  command: string;
  containsSecrets: boolean;
  unresolved: string[];
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
  /** `ref` is the request's id in the exporting workspace, used by flow steps. */
  requests: (RequestDefinition & { description: string | null; ref?: string })[];
  /** Flows built from this collection's requests; root only. */
  flows?: ExportedFlow[];
}

export interface PostmanEnvironmentExport {
  id: string;
  name: string;
  values: { key: string; value: string; type: 'default' | 'secret'; enabled: boolean }[];
  _postman_variable_scope: 'environment' | 'globals';
  _postman_exported_at: string;
  _postman_exported_using: string;
}

export interface ExportedFlow {
  name: string;
  description: string | null;
  settings: FlowSettings;
  variables: { key: string; value: string; isSecret: boolean }[];
  /** Request steps point at an exported request's `ref`. */
  steps: (Omit<FlowStep, 'requestId'> & { requestRef: string | null })[];
  connections: FlowConnection[];
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
  'POST /collections/import': { body: { data: unknown }; response: Collection & { warnings: string[] } };

  'GET /requests/:id': { response: SavedRequest };
  'POST /requests': { body: CreateRequestInput; response: SavedRequest };
  'PATCH /requests/:id': { body: UpdateRequestInput; response: SavedRequest };
  'DELETE /requests/:id': { response: { ok: true } };
  'POST /requests/:id/duplicate': { body: Empty; response: SavedRequest };

  'GET /environments': { response: Environment[] };
  'POST /environments': { body: { name: string }; response: Environment };
  'PATCH /environments/:id': { body: { name?: string; sortOrder?: number }; response: Environment };
  'DELETE /environments/:id': { response: { ok: true } };
  'POST /environments/import': { body: { data: unknown }; response: { environment: Environment; warnings: string[] } };
  'GET /environments/:id/export': { response: PostmanEnvironmentExport };
  'POST /environments/:id/activate': { body: Empty; response: Environment };
  'POST /environments/deactivate': { body: Empty; response: { ok: true } };

  'GET /variables/:scope/:ownerId': { query: { reveal?: '1' }; response: Variable[] };
  'PUT /variables/:scope/:ownerId': { body: { variables: VariableInput[] }; response: Variable[] };
  'PUT /variables/:scope/:ownerId/:key': { body: z.input<typeof SetVariableInput>; response: Variable };

  'POST /send': { body: SendInput; response: SendResult };
  'POST /oauth/token': { body: OAuthTokenInput; response: OAuthTokenResult };
  'POST /oauth/authorize': { body: OAuthTokenInput; response: OAuthAuthorizeResult };
  'GET /oauth/authorize/:state': { response: OAuthSignInStatus };
  'POST /import/curl': { body: { command: string }; response: CurlImportResult };
  'POST /export/curl': { body: CurlExportInput; response: CurlExportResult };
  'POST /resolve-preview': { body: ResolvePreviewInput; response: ResolvedPreview[] };
  'GET /context-variables': { query: { collectionId?: string; requestId?: string; flowId?: string }; response: ContextVariable[] };

  'GET /history': { query: { requestId?: string; limit?: number }; response: HistorySummary[] };
  'GET /history/:id': { response: HistoryEntry };
  'DELETE /history': { response: { ok: true } };

  'GET /openapi': { response: OpenApiSpec[] };
  'POST /openapi/import': { body: OpenApiImportInput; response: OpenApiImportResult };
  'GET /openapi/:id': { response: OpenApiSpecDetail };
  'DELETE /openapi/:id': { response: { ok: true } };
  'POST /openapi/:id/sync/preview': { body: SyncInput; response: SyncPlan };
  'POST /openapi/:id/sync': { body: SyncInput; response: SyncResult };
  'GET /openapi/:id/compare': { query: { from: string; to: string }; response: SpecDiffSummary };
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
  'POST /flows/:id/run': { body: { environmentId?: string | null; debug?: boolean }; response: FlowExecution };
  'POST /executions/:id/continue': { body: { mode: 'continue' | 'step' }; response: { ok: true } };
  'GET /flows/:id/executions': { response: FlowExecution[] };
  'GET /flows/:id/sources': { query: { stepId: string }; response: FlowSource[] };
  'POST /flows/:id/suggest-mappings': { body: { stepId: string }; response: MappingSuggestion[] };
  'GET /executions/:id': { response: FlowExecutionDetail };
  'GET /executions/:id/report': { query: { format?: 'json' | 'md' | 'html' }; response: unknown };
  'POST /executions/:id/stop': { body: Record<string, never>; response: { ok: true } };
  'POST /executions/:id/steps/:stepId/rerun': { body: Record<string, never>; response: FlowExecution };
}

export type RouteKey = keyof ApiRoutes;
export type RouteBody<K extends RouteKey> = ApiRoutes[K] extends { body: infer B } ? B : never;
export type RouteQuery<K extends RouteKey> = ApiRoutes[K] extends { query: infer Q } ? Q : never;
export type RouteResponse<K extends RouteKey> = ApiRoutes[K]['response'];
