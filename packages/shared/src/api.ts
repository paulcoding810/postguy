import { z } from 'zod';
import {
  Auth,
  Body,
  HttpMethod,
  KeyValue,
  RequestDefinition,
  RequestSettings,
  Scripts,
  VariableScope,
  type ApiModel,
  type Collection,
  type CollectionTreeNode,
  type Environment,
  type HistoryEntry,
  type HistorySummary,
  type JarCookie,
  type JsonSchema,
  type OpenApiOperation,
  type OpenApiSpec,
  type OpenApiSpecDetail,
  type PathEntry,
  type ResponseSnapshot,
  ExampleRequest,
  type ExampleSummary,
  type ResponseExample,
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
  scripts: Scripts.optional(),
});
export type CreateCollectionInput = z.input<typeof CreateCollectionInput>;

export const UpdateCollectionInput = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  auth: Auth.optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  scripts: z.object({ pre: z.string().max(100_000).optional(), post: z.string().max(100_000).optional() }).optional(),
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
  mcpBlocked: z.boolean().optional(),
  mcpRevealSecrets: z.boolean().optional(),
});

/** What Claude may do through MCP. Off by default; once on, it may only read until more is allowed. */
export const McpSettings = z.object({
  enabled: z.boolean().default(false),
  read: z.boolean().default(true),
  send: z.boolean().default(false),
  edit: z.boolean().default(false),
  /** Delete requests and folders; needs edit too. Deletions can be undone from Change history. */
  delete: z.boolean().default(false),
  /** Sends and environment writes must name an environment, so switching the active one never redirects Claude. */
  requireEnvironment: z.boolean().default(true),
  /** The only folder Claude may upload files from in form-data and binary bodies; null: no uploads. */
  uploadFolder: z.string().nullable().default(null),
});
export type McpSettings = z.output<typeof McpSettings>;
export const UpdateMcpSettings = z.object({
  enabled: z.boolean().optional(),
  read: z.boolean().optional(),
  send: z.boolean().optional(),
  edit: z.boolean().optional(),
  delete: z.boolean().optional(),
  requireEnvironment: z.boolean().optional(),
  uploadFolder: z.string().min(1).nullable().optional(),
});

/** How requests behave unless a request sets its own value. */
export const RequestDefaults = z.object({
  timeoutMs: z.number().int().positive().max(600_000).default(30_000),
  followRedirects: z.boolean().default(true),
  rejectUnauthorized: z.boolean().default(true),
});
export type RequestDefaults = z.output<typeof RequestDefaults>;
export const UpdateRequestDefaults = z.object({
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  followRedirects: z.boolean().optional(),
  rejectUnauthorized: z.boolean().optional(),
});

/** App-wide choices kept with the data, so they survive a webview reset. */
export const Preferences = z.object({
  autoUpdateCheck: z.boolean().default(true),
});
export type Preferences = z.output<typeof Preferences>;
export const UpdatePreferences = z.object({ autoUpdateCheck: z.boolean().optional() });

/** Where the app keeps its data, for Settings → Data. */
export interface AppInfo {
  dataDir: string | null;
  database: string | null;
  /** Copies taken before an update's migrations, newest first. */
  backups: { name: string; path: string; size: number; createdAt: number }[];
}

/**
 * One recorded change to a collection, folder, request or collection variables; or to an
 * environment's variables ('environment') or which environment is active ('active-environment'). Secrets are masked.
 */
export interface ChangeEntry {
  id: string;
  rootId: string;
  entityType: 'request' | 'collection' | 'variables' | 'environment' | 'active-environment';
  entityId: string;
  label: string;
  action: 'create' | 'update' | 'delete';
  /** app: you in Postguy; api: another program; mcp: Claude; sync: OpenAPI sync; import: an import. */
  source: 'app' | 'api' | 'mcp' | 'sync' | 'import';
  before: unknown;
  after: unknown;
  createdAt: number;
  updatedAt: number;
  restorable: boolean;
}

/** Who did something, as the activity log groups it. */
export type ActivityActor = 'you' | 'claude' | 'script' | 'api' | 'sync' | 'import';
export type ActivityKind = 'send' | 'change' | 'flow';

/** One line of the activity log: a request sent, a change made, or a flow run. */
export type ActivityItem =
  | { kind: 'send'; id: string; at: number; who: ActivityActor; method: string; url: string; status: number | null; error: string | null; requestId: string | null; timeMs: number | null }
  | { kind: 'change'; id: string; at: number; who: ActivityActor; change: ChangeEntry; collection: string | null }
  | { kind: 'flow'; id: string; at: number; who: ActivityActor; flowId: string; flow: string; status: string; passed: number; failed: number; total: number };

export const ActivityQuery = z.object({
  /** Items before this time, for the next page. */
  before: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  kinds: z.string().optional().describe('Comma-separated: send, change, flow'),
  who: z.enum(['you', 'claude', 'script', 'other']).optional(),
  q: z.string().optional(),
});

export interface McpSetup {
  /** The command Claude Code runs to talk to this Postguy, e.g. for `claude mcp add`. */
  command: string;
  args: string[];
  /** Ready to paste into a terminal. */
  claudeCode: string;
}

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
  kind: 'openapi' | 'postman' | 'postguy' | 'har';
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

export type SyncAction = 'create' | 'update' | 'merge-edited' | 'keep-edited' | 'orphaned' | 'unchanged';

export interface SyncPlan {
  upToDate: boolean;
  fromVersion: string;
  toVersion: string;
  diff: SpecDiffSummary;
  requests: {
    requestId: string | null;
    name: string;
    operation: string;
    label: string;
    action: SyncAction;
    changes?: string[];
    /** For edited requests: what the merge adds, e.g. "query page", "header X-Tenant". */
    adds?: string[];
    /** The operation's path or method moved; the request follows it. */
    moved?: boolean;
  }[];
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

export const GraphqlSchemaInput = z.object({
  request: RequestDefinition,
  collectionId: z.string().nullable().optional(),
  requestId: z.string().nullable().optional(),
});
export interface GraphqlSchemaResult {
  /** The introspection result's data: `{ __schema }`. */
  schema: unknown;
  url: string;
  fetchedAt: number;
}

export const CurlImportInput = z.object({
  command: z.string().min(1).max(1_000_000),
  /** Where the request goes; its variables replace the values they hold. Omit both to use the active environment only. */
  collectionId: z.string().nullable().optional(),
  requestId: z.string().nullable().optional(),
  useVariables: z.boolean().default(true),
});
export interface CurlImportResult {
  request: z.output<typeof RequestDefinition>;
  warnings: string[];
  /** Variables used in place of the values pasted. */
  variables: string[];
  /** The request as pasted, when variables were used. */
  raw?: z.output<typeof RequestDefinition>;
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
  /** Pre-request and post-response scripts run around every request inside it. */
  scripts?: Scripts;
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

export const CreateExampleInput = z.object({
  name: z.string().trim().min(1).max(200),
  status: z.number().int().nullable(),
  statusText: z.string().nullable().default(null),
  headers: z.record(z.string(), z.string()).default({}),
  contentType: z.string().nullable().default(null),
  body: z.string().max(5 * 1024 * 1024 * 4 / 3 + 16),
  bodyEncoding: z.enum(['utf8', 'base64']).default('utf8'),
  request: ExampleRequest,
});
export const UpdateExampleInput = z.object({ name: z.string().trim().min(1).max(200) });

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
  'PATCH /environments/:id': { body: z.input<typeof UpdateEnvironmentInput>; response: Environment };
  'GET /collections/:id/changes': { query: { entityId?: string }; response: ChangeEntry[] };
  'GET /changes/deleted': { response: ChangeEntry[] };
  'POST /changes/:id/restore': { body: Empty; response: { message: string } };
  'GET /settings/mcp': { response: McpSettings };
  'PATCH /settings/mcp': { body: z.input<typeof UpdateMcpSettings>; response: McpSettings };
  'GET /settings/requests': { response: RequestDefaults };
  'PATCH /settings/requests': { body: z.input<typeof UpdateRequestDefaults>; response: RequestDefaults };
  'GET /settings/app': { response: AppInfo };
  'GET /activity': { query: z.input<typeof ActivityQuery>; response: { items: ActivityItem[]; next: number | null } };
  'GET /settings/preferences': { response: Preferences };
  'PATCH /settings/preferences': { body: z.input<typeof UpdatePreferences>; response: Preferences };
  'GET /settings/mcp/setup': { response: McpSetup };
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
  'POST /import/curl': { body: z.input<typeof CurlImportInput>; response: CurlImportResult };
  'POST /export/curl': { body: CurlExportInput; response: CurlExportResult };
  'POST /export/fetch': { body: CurlExportInput; response: CurlExportResult };
  'POST /graphql/schema': { body: z.input<typeof GraphqlSchemaInput>; response: GraphqlSchemaResult };
  'GET /requests/:id/graphql-schema': { response: GraphqlSchemaResult | null };
  'POST /resolve-preview': { body: ResolvePreviewInput; response: ResolvedPreview[] };
  'GET /context-variables': { query: { collectionId?: string; requestId?: string; flowId?: string }; response: ContextVariable[] };

  'GET /history': { query: { requestId?: string; limit?: number }; response: HistorySummary[] };
  'GET /history/:id': { response: HistoryEntry };
  'DELETE /history': { response: { ok: true } };

  'GET /cookies': { response: JarCookie[] };
  'DELETE /cookies/:id': { response: { ok: true } };
  /** environmentId '' = the workspace jar; omitted = every jar. */
  'DELETE /cookies': { query: { environmentId?: string; domain?: string }; response: { removed: number } };

  'GET /openapi': { response: OpenApiSpec[] };
  'POST /openapi/import': { body: OpenApiImportInput; response: OpenApiImportResult };
  'GET /openapi/:id': { response: OpenApiSpecDetail };
  'DELETE /openapi/:id': { response: { ok: true } };
  'POST /openapi/:id/sync/preview': { body: SyncInput; response: SyncPlan };
  'POST /openapi/:id/sync': { body: SyncInput; response: SyncResult };
  'GET /openapi/:id/compare': { query: { from: string; to: string }; response: SpecDiffSummary };
  'GET /requests/:id/operation': { response: { model: Pick<ApiModel, 'title' | 'version'>; operation: OpenApiOperation } | null };
  'GET /requests/:id/spec-merge': { response: { added: string[] } | null };
  'POST /requests/:id/spec-merge': { body: Empty; response: SavedRequest };

  'GET /reference-sources': { query: { collectionId?: string }; response: ReferenceSource[] };
  'GET /requests/:id/snapshots': { response: SnapshotSummary[] };
  'GET /snapshots/:id': { response: ResponseSnapshot };
  'GET /requests/:id/examples': { response: ExampleSummary[] };
  'POST /requests/:id/examples': { body: z.input<typeof CreateExampleInput>; response: ResponseExample };
  'GET /examples/:id': { response: ResponseExample };
  'PATCH /examples/:id': { body: z.input<typeof UpdateExampleInput>; response: ResponseExample };
  'DELETE /examples/:id': { response: { ok: true } };
  'POST /requests/:id/pin-snapshot': { body: { snapshotId: string | null }; response: SavedRequest };
  'GET /requests/:id/schema': { response: EffectiveSchema };

  'GET /flows': { response: Flow[] };
  'POST /flows': { body: zt.input<typeof CreateFlowInput>; response: FlowDetail };
  'POST /flows/:id/duplicate': { body: Empty; response: FlowDetail };
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
