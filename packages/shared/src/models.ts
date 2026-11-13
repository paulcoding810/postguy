import { z } from 'zod';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export const HttpMethod = z.enum(HTTP_METHODS);
export type HttpMethod = z.infer<typeof HttpMethod>;

export const KeyValue = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
  /** Form-data only: a file field sends the file at `src` instead of `value`. */
  type: z.enum(['text', 'file']).optional(),
  src: z.string().optional(),
});
export type KeyValue = z.infer<typeof KeyValue>;

export const BODY_MODES = ['none', 'json', 'text', 'form', 'urlencoded', 'binary'] as const;
export const Body = z.object({
  mode: z.enum(BODY_MODES),
  raw: z.string().optional(),
  form: z.array(KeyValue).optional(),
  contentType: z.string().optional(),
  /** Binary mode: path of the file sent as the body. */
  src: z.string().optional(),
});
export type Body = z.infer<typeof Body>;

export const ApiKeyLocation = z.enum(['header', 'query']);

export const Auth = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('inherit') }),
  z.object({ type: z.literal('bearer'), token: z.string() }),
  z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }),
  z.object({ type: z.literal('apikey'), key: z.string(), value: z.string(), in: ApiKeyLocation }),
  z.object({
    type: z.literal('oauth2'),
    grantType: z.enum(['client_credentials', 'password', 'authorization_code']),
    tokenUrl: z.string(),
    authUrl: z.string().optional(),
    clientId: z.string(),
    clientSecret: z.string(),
    scope: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    clientAuth: z.enum(['header', 'body']).optional(),
    usePkce: z.boolean().optional(),
    accessToken: z.string().optional(),
  }),
]);
export type Auth = z.infer<typeof Auth>;
export type AuthType = Auth['type'];

export const RequestSettings = z.object({
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  followRedirects: z.boolean().optional(),
  rejectUnauthorized: z.boolean().optional(),
  /** false: neither send nor store cookies from the cookie jar. */
  cookies: z.boolean().optional(),
});
export type RequestSettings = z.infer<typeof RequestSettings>;

export const Scripts = z.object({
  pre: z.string().max(100_000).default(''),
  post: z.string().max(100_000).default(''),
});
export type Scripts = z.infer<typeof Scripts>;

export const RequestDefinition = z.object({
  name: z.string().min(1),
  method: HttpMethod,
  url: z.string(),
  params: z.array(KeyValue).default([]),
  pathParams: z.array(KeyValue).default([]),
  headers: z.array(KeyValue).default([]),
  auth: Auth.default({ type: 'inherit' }),
  body: Body.default({ mode: 'none' }),
  settings: RequestSettings.default({}),
  scripts: Scripts.default({ pre: '', post: '' }),
});
export type RequestDefinition = z.infer<typeof RequestDefinition>;

export const COLLECTION_KINDS = ['collection', 'folder'] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

export interface Collection {
  id: string;
  parentId: string | null;
  kind: CollectionKind;
  name: string;
  description: string | null;
  auth: Auth;
  sortOrder: number;
  openapiSpecId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Run around every request inside it; filled on reads of a collection or the tree. */
  scripts?: Scripts;
}

export interface SavedRequest extends RequestDefinition {
  id: string;
  collectionId: string;
  description: string | null;
  openapiOperationId: string | null;
  openapiFingerprint: string | null;
  latestSuccessSnapshotId: string | null;
  pinnedSnapshotId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionTreeNode extends Collection {
  children: CollectionTreeNode[];
  requests: Pick<SavedRequest, 'id' | 'name' | 'method' | 'url' | 'sortOrder' | 'collectionId'>[];
}

export type EnvironmentKind = 'global' | 'environment';
export interface Environment {
  id: string;
  kind: EnvironmentKind;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: number;
}

export const VARIABLE_SCOPES = ['global', 'environment', 'collection', 'flow', 'request'] as const;
export const VariableScope = z.enum(VARIABLE_SCOPES);
export type VariableScope = z.infer<typeof VariableScope>;

export interface Variable {
  id: string;
  scope: VariableScope;
  ownerId: string;
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

/** A cookie kept in the cookie jar. */
export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Sent only to `domain` itself, not its subdomains (no Domain attribute was given). */
  hostOnly: boolean;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
  /** Epoch ms; null for a session cookie. */
  expiresAt: number | null;
  createdAt: number;
}

export interface JarCookie extends StoredCookie {
  id: string;
  /** The environment whose jar holds it; null for the workspace jar used with no environment active. */
  environmentId: string | null;
}
export interface Timing {
  totalMs: number;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  schemaSource: string;
  errors: ValidationIssue[];
}

export interface ScriptRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  /** How the body string is sent; 'formdata' and 'file' bodies are read-only and kept as they are. */
  bodyMode?: 'raw' | 'urlencoded' | 'formdata' | 'file';
  /** The form-data fields when bodyMode is 'formdata'; file fields carry their path in `src`. */
  formdata?: { key: string; value: string; type?: 'text' | 'file'; src?: string }[];
  /** The file sent when bodyMode is 'file'. */
  file?: { src: string };
}

export interface ScriptResponse {
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  body: unknown;
  timeMs?: number;
}

export interface ScriptAssertion {
  ok: boolean;
  message: string;
}

export interface ScriptLog {
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ScriptRun {
  phase: 'pre' | 'post';
  ok: boolean;
  error: string | null;
  logs: ScriptLog[];
  assertions: ScriptAssertion[];
  request?: ScriptRequest;
  durationMs: number;
  /** Where the script came from, e.g. "request" or "step". */
  source?: string;
}

export interface SendResult {
  historyId: string | null;
  snapshotId: string | null;
  request: { method: string; url: string; headers: Record<string, string> };
  status: number | null;
  statusText: string | null;
  headers: Record<string, string>;
  cookies: Cookie[];
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  truncated: boolean;
  contentType: string | null;
  size: number;
  timing: Timing;
  error: { code: string; message: string } | null;
  unresolved: string[];
  validation: ValidationResult | null;
  scripts: ScriptRun[];
  /** An auth credential came out empty, so it was not sent. */
  emptyAuth?: EmptyAuthWarning;
}

export interface EmptyAuthWarning {
  field: string;
  template: string;
  /** Where the empty variable is defined, when the field is one `{{variable}}`. */
  variable: { name: string; scope: VariableScope | null; ownerId: string | null } | null;
  /** A remembered response value that looks like the credential, e.g. `Login.data.access_token`. */
  suggestion: { ref: string; source: string; path: string } | null;
}

export interface HistoryEntry {
  id: string;
  requestId: string | null;
  environmentId: string | null;
  method: string;
  url: string;
  request: { headers: Record<string, string>; body: string | null };
  status: number | null;
  statusText: string | null;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  truncated: boolean;
  bodySize: number;
  contentType: string | null;
  timing: Timing;
  error: string | null;
  createdAt: number;
}

export type HistorySummary = Pick<
  HistoryEntry,
  'id' | 'requestId' | 'method' | 'url' | 'status' | 'timing' | 'bodySize' | 'error' | 'createdAt'
>;

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export interface PathEntry {
  path: string;
  type: JsonType;
  sample?: unknown;
  wildcard?: boolean;
}

export interface ResponseSnapshot {
  id: string;
  requestId: string;
  historyId: string | null;
  schemaId: string;
  status: number;
  isSuccess: boolean;
  body: unknown;
  contentHash: string;
  paths: PathEntry[];
  createdAt: number;
}

export type SnapshotSummary = Omit<ResponseSnapshot, 'body' | 'paths'>;

export type JsonSchema = Record<string, unknown>;

export interface ResponseSchemaRecord {
  id: string;
  hash: string;
  schema: JsonSchema;
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount: number;
}

export type OpenApiSourceType = 'file' | 'paste' | 'url';

export interface OpenApiSpec {
  id: string;
  collectionId: string;
  name: string;
  sourceType: OpenApiSourceType;
  sourceUrl: string | null;
  currentVersionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface OpenApiParam {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  description?: string;
  schema?: JsonSchema;
  example?: unknown;
}

export interface OpenApiOperation {
  id: string;
  method: HttpMethod;
  path: string;
  tags: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  params: OpenApiParam[];
  requestBody?: { contentType: string; required: boolean; schema?: JsonSchema; example?: unknown };
  responses: { status: string; description?: string; contentType?: string; schema?: JsonSchema }[];
  security: string[];
}

export interface OpenApiSecurityScheme {
  name: string;
  type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect';
  scheme?: string;
  in?: 'header' | 'query' | 'cookie';
  paramName?: string;
  tokenUrl?: string;
  description?: string;
}

export interface ApiModel {
  title: string;
  version: string;
  specVersion: string;
  description?: string;
  servers: { url: string; description?: string }[];
  securitySchemes: OpenApiSecurityScheme[];
  tags: { name: string; description?: string }[];
  operations: OpenApiOperation[];
  globalSecurity: string[];
}

export interface OpenApiVersion {
  id: string;
  specId: string;
  label: string;
  hash: string;
  importedAt: number;
}

export interface OpenApiSpecDetail extends OpenApiSpec {
  model: ApiModel | null;
  versions: OpenApiVersion[];
}
