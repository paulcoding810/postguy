import { getQuickJS, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten';
import type { ScriptAssertion, ScriptRequest, ScriptResponse, ScriptRun, StepLog } from '@postguy/shared';

export interface ScriptHost {
  /** A named response visible to this script, or undefined. */
  response(name: string): ScriptResponse | undefined;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  envGet(key: string): unknown;
  envSet(key: string, value: unknown): void;
}

export interface ScriptInput {
  source: string;
  phase: 'pre' | 'post';
  host: ScriptHost;
  request?: ScriptRequest;
  response?: ScriptResponse;
  timeoutMs?: number;
  memoryMb?: number;
}

const PRELUDE = `"use strict";
const __call = (n, ...a) => { const r = __host(n, JSON.stringify(a)); return r === undefined ? undefined : JSON.parse(r); };
const __fmt = (v) => { if (typeof v === 'string') return v; if (v === undefined) return 'undefined'; try { return JSON.stringify(v); } catch (e) { return String(v); } };
const __log = (level) => (...a) => { __call('log', level, a.map(__fmt).join(' ')); };
const flow = Object.freeze({
  response: (name) => __call('response', String(name)),
  get: (key) => __call('get', String(key)),
  set: (key, value) => { __call('set', String(key), value === undefined ? null : value); },
  assert: (condition, message) => { const ok = !!condition; __call('assert', ok, message === undefined ? 'Assertion' : String(message)); return ok; },
  log: __log('info'),
});
const env = Object.freeze({
  get: (key) => __call('envGet', String(key)),
  set: (key, value) => { __call('envSet', String(key), value === undefined ? null : value); },
});
const console = Object.freeze({ log: __log('info'), info: __log('info'), warn: __log('warn'), error: __log('error'), debug: __log('info') });
const request = __call('request');
const response = __call('currentResponse');
`;
const PRELUDE_LINES = PRELUDE.split('\n').length;

let warm: ReturnType<typeof getQuickJS> | null = null;

/** Loads the WebAssembly module once; later scripts start in a fresh, isolated context. */
export function loadSandbox() {
  warm ??= getQuickJS();
  return warm;
}

function errorText(dumped: unknown, timedOut: boolean, timeoutMs: number): string {
  if (timedOut) return `Script timed out after ${timeoutMs} ms`;
  if (dumped && typeof dumped === 'object') {
    const e = dumped as { name?: string; message?: string; stack?: string };
    if (/out of memory/i.test(e.message ?? '')) return 'Script ran out of memory';
    const line = /script\.js:(\d+)/.exec(e.stack ?? '');
    const where = line ? ` (line ${Math.max(1, Number(line[1]) - PRELUDE_LINES)})` : '';
    return `${e.name ?? 'Error'}: ${e.message ?? String(dumped)}${where}`;
  }
  return String(dumped);
}

/**
 * Runs a user script in a fresh QuickJS context with no filesystem, network or process
 * access. Host calls cross as JSON. Limits: wall-clock timeout, heap size, stack size.
 */
export async function runScript(input: ScriptInput): Promise<ScriptRun> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? 1000;
  const logs: StepLog[] = [];
  const assertions: ScriptAssertion[] = [];
  let request = input.request ? structuredClone(input.request) : undefined;
  if (!input.source.trim()) return { phase: input.phase, ok: true, error: null, logs, assertions, durationMs: 0 };

  const QuickJS = await loadSandbox();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit((input.memoryMb ?? 32) * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = started + timeoutMs;
  let timedOut = false;
  runtime.setInterruptHandler(() => {
    timedOut = Date.now() > deadline;
    return timedOut;
  });
  const vm: QuickJSContext = runtime.newContext();
  let error: string | null = null;

  try {
    const host = vm.newFunction('__host', (nameH: QuickJSHandle, argsH: QuickJSHandle) => {
      const name = vm.getString(nameH);
      const args = JSON.parse(vm.getString(argsH)) as unknown[];
      let out: unknown;
      switch (name) {
        case 'response':
          out = input.host.response(String(args[0]));
          break;
        case 'get':
          out = input.host.get(String(args[0]));
          break;
        case 'set':
          input.host.set(String(args[0]), args[1]);
          break;
        case 'envGet':
          out = input.host.envGet(String(args[0]));
          break;
        case 'envSet':
          input.host.envSet(String(args[0]), args[1]);
          break;
        case 'assert':
          assertions.push({ ok: !!args[0], message: String(args[1]) });
          break;
        case 'log':
          if (logs.length < 500) logs.push({ at: Date.now(), level: args[0] as StepLog['level'], message: String(args[1]).slice(0, 4000) });
          break;
        case 'request':
          out = request ?? null;
          break;
        case 'currentResponse':
          out = input.response ?? null;
          break;
        case 'result':
          if (request && args[0] && typeof args[0] === 'object') request = args[0] as ScriptRequest;
          break;
      }
      return out === undefined ? vm.undefined : vm.newString(JSON.stringify(out));
    });
    vm.setProp(vm.global, '__host', host);
    host.dispose();

    const code = `${PRELUDE}(function () {\n${input.source}\n})();\nif (request) __call('result', request);\n`;
    const result = vm.evalCode(code, 'script.js');
    if (result.error) {
      error = errorText(vm.dump(result.error), timedOut, timeoutMs);
      result.error.dispose();
    } else result.value.dispose();
  } catch (e) {
    error = errorText({ name: 'Error', message: (e as Error).message }, timedOut, timeoutMs);
  } finally {
    vm.dispose();
    runtime.dispose();
  }

  const failed = assertions.filter((a) => !a.ok);
  return {
    phase: input.phase,
    ok: !error && failed.length === 0,
    error,
    logs,
    assertions,
    request: input.phase === 'pre' ? request : undefined,
    durationMs: Date.now() - started,
  };
}

/** Normalizes a script request after editing: header values become strings, body a string or null. */
export function normalizeScriptRequest(r: ScriptRequest): ScriptRequest {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers ?? {})) if (v !== null && v !== undefined) headers[k] = typeof v === 'string' ? v : JSON.stringify(v);
  const body = r.body === null || r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  return { method: String(r.method ?? 'GET').toUpperCase(), url: String(r.url ?? ''), headers, body };
}
