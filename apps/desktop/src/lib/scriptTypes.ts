import { monaco } from './monaco';

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** A TypeScript type literal describing a JSON value, for autocomplete. */
export function tsTypeOf(value: unknown, depth = 0): string {
  if (depth > 8) return 'any';
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? `Array<${tsTypeOf(value[0], depth + 1)}>` : 'any[]';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object': {
      const entries = Object.entries(value as Record<string, unknown>).slice(0, 200);
      if (!entries.length) return 'Record<string, any>';
      return `{ ${entries.map(([k, v]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${tsTypeOf(v, depth + 1)}`).join('; ')} }`;
    }
    default:
      return 'any';
  }
}

const BASE = `
interface PgResponse<B = any> {
  /** HTTP status code */
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON body, or the body text */
  body: B;
  timeMs?: number;
}
interface PgRequest {
  method: string;
  /** URL including query string; {{variables}} are resolved after the script */
  url: string;
  headers: Record<string, string>;
  body: string | null;
}
`;

export interface ScriptTypeInput {
  responses: { name: string; body: unknown }[];
  self?: { name: string; body: unknown } | null;
  phase: 'pre' | 'post';
}

/** Declares the script globals with response types taken from remembered or upstream responses. */
export function scriptLib(input: ScriptTypeInput): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const r of [...(input.self ? [input.self] : []), ...input.responses]) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    entries.push(`  ${JSON.stringify(r.name)}: PgResponse<${tsTypeOf(r.body)}>;`);
  }
  const selfType = input.self ? `PgResponse<${tsTypeOf(input.self.body)}>` : 'PgResponse';
  return `${BASE}
interface PgResponses {
${entries.join('\n')}
}
declare const flow: {
  /** A response from this run (in flows) or the latest remembered response of a request, by name */
  response<K extends keyof PgResponses>(name: K): PgResponses[K];
  response(name: string): PgResponse | undefined;
  /** Stores a value as a {{variable}} for later steps (highest precedence) */
  set(key: string, value: unknown): void;
  /** Reads a value set with flow.set, or any variable */
  get(key: string): any;
  /** Records an assertion; a false condition fails the request or step */
  assert(condition: unknown, message?: string): boolean;
  log(...values: unknown[]): void;
};
/** Reads or saves variables in the active environment (globals when none is active) */
declare const env: { get(key: string): any; set(key: string, value: unknown): void };
/** Postman compatibility: pm.test, pm.expect, pm.response, pm.request, pm.environment, pm.globals, pm.collectionVariables, pm.variables */
declare const pm: {
  test(name: string, fn: () => void): void;
  expect: { (value: unknown): any; fail(message?: string): never; fail(actual: unknown, expected: unknown, message?: string, operator?: string): never };
  response: { code: number; status: string; responseTime: number; json(): any; text(): string; headers: { get(name: string): string | undefined; has(name: string): boolean }; to: any };
  request: { url: { toString(): string }; method: string; headers: { add(h: { key: string; value: unknown }): void; upsert(h: { key: string; value: unknown }): void; remove(name: string): void; get(name: string): string | undefined }; body: { raw: string | null; readonly mode: 'none' | 'raw' | 'urlencoded'; readonly urlencoded: { key: string; value: string }[]; isEmpty(): boolean; update(o: string | null | { mode: 'raw' | 'urlencoded' | 'graphql'; raw?: unknown; urlencoded?: { key: string; value: unknown; disabled?: boolean }[] | Record<string, unknown>; graphql?: { query: string; variables?: unknown }; options?: { raw?: { language?: 'json' | 'text' | 'xml' | 'html' | 'javascript' } } }): void } };
  environment: PmScope; globals: PmScope; collectionVariables: PmScope; variables: PmScope;
  /** Sends a request of its own; await it, or pass a callback. Up to 10 per script */
  sendRequest(request: string | PmSendRequest): Promise<PmSendResponse>;
  sendRequest(request: string | PmSendRequest, callback: (error: Error | null, response: PmSendResponse | null) => void): Promise<PmSendResponse | null>;
  /** Cookie-jar cookies for this request's URL */
  cookies: { get(name: string): string | undefined; has(name: string): boolean; toObject(): Record<string, string>; all(): { name: string; value: string }[] };
};
interface PmSendRequest { url: string; method?: string; header?: Record<string, string> | { key: string; value: string; disabled?: boolean }[]; body?: { mode: 'raw'; raw: string } | { mode: 'urlencoded'; urlencoded: { key: string; value: string }[] | Record<string, string> } | { mode: 'graphql'; graphql: { query: string; variables?: unknown } } }
interface PmSendResponse { code: number; status: string; responseTime: number; json(): any; text(): string; headers: { get(name: string): string | undefined; has(name: string): boolean } }
interface PmScope { get(key: string): any; set(key: string, value: unknown): void; unset(key: string): void; has(key: string): boolean; replaceIn(text: string): string }
declare const tests: Record<string, boolean>;
/** The common part of fetch: url, method, headers and a string body. Counts towards the script's 10 requests */
declare function fetch(input: string | { url: string }, init?: { method?: string; headers?: Record<string, string> | [string, string][]; body?: string | null }): Promise<{ ok: boolean; status: number; statusText: string; url: string; headers: { get(name: string): string | null; has(name: string): boolean }; json(): Promise<any>; text(): Promise<string> }>;
declare const console: { log(...v: unknown[]): void; info(...v: unknown[]): void; warn(...v: unknown[]): void; error(...v: unknown[]): void };
${input.phase === 'pre' ? '/** The outgoing request; edit it to change what is sent */\ndeclare const request: PgRequest;' : '/** The response of this request */\ndeclare const response: ' + selfType + ';'}
`;
}

let current: monaco.IDisposable | null = null;

export function setScriptLib(lib: string | null) {
  if (!lib) return;
  current?.dispose();
  current = monaco.typescript.javascriptDefaults.addExtraLib(lib, 'file:///postguy-script-env.d.ts');
}
