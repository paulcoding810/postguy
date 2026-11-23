import { getQuickJS, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten';
import type { JsonSchema, ScriptAssertion, ScriptRequest, ScriptResponse, ScriptRun, StepLog } from '@postguy/shared';
import { dynamicVariable } from '../template/dynamic.ts';
import { validateJson } from '../memory/validate.ts';
import { CRYPTO_PRELUDE, hostCrypto } from './crypto.ts';
import { PM_PRELUDE } from './pm.ts';

export interface ScriptHost {
  /** A named response visible to this script, or undefined. */
  response(name: string): ScriptResponse | undefined;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  envGet(key: string): unknown;
  /** Saves a variable; `scope` is where Postman scripts asked for it (environment by default). */
  envSet(key: string, value: unknown, scope?: 'environment' | 'globals' | 'collection'): void;
  /** Cookie-jar cookies for the request's URL (the final URL once a response arrived). */
  cookies?(): { name: string; value: string }[];
  /** Sends a request for pm.sendRequest; rejects with a message the script sees as the error. */
  sendRequest?(request: ScriptRequest): Promise<ScriptResponse>;
}

/** What pm.sendRequest may do in one script run. */
export const SEND_LIMITS = { count: 10, totalMs: 30_000 };

export interface ScriptInput {
  source: string;
  phase: 'pre' | 'post';
  host: ScriptHost;
  request?: ScriptRequest;
  response?: ScriptResponse;
  /** CPU time the script itself may use; time spent waiting on pm.sendRequest doesn't count. */
  timeoutMs?: number;
  memoryMb?: number;
}

const PRELUDE = `"use strict";
const __failures = [];
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
const __timers = [];
const setTimeout = (fn, _ms, ...args) => { __timers.push(() => fn(...args)); return __timers.length; };
const clearTimeout = (id) => { __timers[id - 1] = null; };
const setInterval = () => { throw new Error('setInterval is not available in Postguy scripts'); };
const request = __call('request');
if (request) {
  let __body = request.body;
  Object.defineProperty(request, 'body', { enumerable: true, get: () => __body, set: (v) => { __body = v; request.bodyMode = 'raw'; delete request.formdata; delete request.file; } });
}
const response = __call('currentResponse');
${CRYPTO_PRELUDE}
${PM_PRELUDE}`;
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
  // The CPU budget only runs while the script is executing, not while it waits on pm.sendRequest.
  let cpuLeft = timeoutMs;
  let deadline = started + timeoutMs;
  let timedOut = false;
  runtime.setInterruptHandler(() => {
    timedOut = Date.now() > deadline;
    return timedOut;
  });
  const inVm = <T>(fn: () => T): T => {
    const t = Date.now();
    deadline = t + cpuLeft;
    try {
      return fn();
    } finally {
      cpuLeft -= Date.now() - t;
    }
  };
  const vm: QuickJSContext = runtime.newContext();
  let error: string | null = null;
  const pending: { id: number; request: ScriptRequest }[] = [];
  let sent = 0;

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
        case 'cookies':
          out = input.host.cookies?.() ?? [];
          break;
        case 'envGet':
          out = input.host.envGet(String(args[0]));
          break;
        case 'envSet':
          input.host.envSet(String(args[0]), args[1], (args[2] as 'environment' | 'globals' | 'collection' | undefined) ?? undefined);
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
        case 'crypto':
          out = hostCrypto(String(args[0]), args.slice(1));
          break;
        case 'jsonSchema':
          out = validateJson(args[0] as JsonSchema, args[1]);
          break;
        case 'dynamic':
          out = dynamicVariable(String(args[0]));
          break;
        case 'currentResponse':
          out = input.response ?? null;
          break;
        case 'result':
          if (request && args[0] && typeof args[0] === 'object') request = args[0] as ScriptRequest;
          break;
        case 'send':
          pending.push({ id: Number(args[0]), request: normalizeScriptRequest(args[1] as ScriptRequest) });
          break;
      }
      return out === undefined ? vm.undefined : vm.newString(JSON.stringify(out));
    });
    vm.setProp(vm.global, '__host', host);
    host.dispose();

    // The script runs as an async function so it may await pm.sendRequest; a rejection is its error.
    const code = `${PRELUDE}(async function () {\n${input.source}\n})().then(() => { globalThis.__mainDone = true; }, (e) => { globalThis.__mainDone = true; globalThis.__mainError = e; });\n`;
    const result = inVm(() => vm.evalCode(code, 'script.js'));
    if (result.error) {
      error = errorText(vm.dump(result.error), timedOut, timeoutMs);
      result.error.dispose();
    } else result.value.dispose();

    const sendDeadline = Date.now() + SEND_LIMITS.totalMs;
    const settle = (id: number, failure: string | null, res: ScriptResponse | null) => {
      const call = inVm(() => vm.evalCode(`__settleSend(${id}, ${JSON.stringify(failure)}, ${JSON.stringify(res)})`, 'settle.js'));
      if (call.error) {
        error ??= errorText(vm.dump(call.error), timedOut, timeoutMs);
        call.error.dispose();
      } else call.value.dispose();
    };
    for (let rounds = 0; !error && rounds < 1000; rounds++) {
      const jobs = inVm(() => runtime.executePendingJobs());
      if (jobs.error) {
        error = errorText(vm.dump(jobs.error), timedOut, timeoutMs);
        jobs.error.dispose();
        break;
      }
      if (!pending.length) break;
      const batch = pending.splice(0);
      const results = await Promise.all(
        batch.map(async ({ id, request: req }) => {
          if (!input.host.sendRequest) return { id, failure: 'pm.sendRequest is not available here', res: null };
          if (++sent > SEND_LIMITS.count) return { id, failure: `pm.sendRequest can be called at most ${SEND_LIMITS.count} times per script`, res: null };
          const left = sendDeadline - Date.now();
          if (left <= 0) return { id, failure: `pm.sendRequest calls took longer than ${SEND_LIMITS.totalMs / 1000} s in total`, res: null };
          try {
            const res = await Promise.race([
              input.host.sendRequest(req),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`pm.sendRequest timed out: the script's ${SEND_LIMITS.totalMs / 1000} s for requests ran out`)), left)),
            ]);
            return { id, failure: null, res };
          } catch (e) {
            return { id, failure: (e as Error).message, res: null };
          }
        }),
      );
      for (const r of results) {
        const req = batch.find((b) => b.id === r.id)!.request;
        const line = r.res ? `${r.res.status}${r.res.timeMs !== undefined ? ` in ${r.res.timeMs} ms` : ''}` : `failed: ${r.failure}`;
        if (logs.length < 500) logs.push({ at: Date.now(), level: r.res ? 'info' : 'warn', message: `pm.sendRequest ${req.method} ${req.url} → ${line}` });
        settle(r.id, r.failure, r.res);
      }
    }

    if (!error) {
      const finish = inVm(() =>
        vm.evalCode(
          `if (!globalThis.__mainDone) throw new Error('The script was still waiting when it ended; await pm.sendRequest or give it a callback');
if (globalThis.__mainError) throw globalThis.__mainError;
if (__failures.length) throw __failures[0];
for (let i = 0; i < __timers.length; i++) { const t = __timers[i]; __timers[i] = null; if (t) t(); }
if (request) __call('result', request);`,
          'script.js',
        ),
      );
      if (finish.error) {
        error = errorText(vm.dump(finish.error), timedOut, timeoutMs);
        finish.error.dispose();
      } else finish.value.dispose();
    }
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
  return { method: String(r.method ?? 'GET').toUpperCase(), url: String(r.url ?? ''), headers, body, ...(r.bodyMode && { bodyMode: r.bodyMode }) };
}
