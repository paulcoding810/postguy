import { describe, expect, it } from 'vitest';
import { FlowGraphInput, RequestDefinition, type FlowGraph, type FlowStep } from '@postguy/shared';
import { createContext, type ResponseRecord } from '../template/context.ts';
import { evaluateExpression, checkExpression, ExpressionError } from './expression.ts';
import { applyOverrides, executeFlow, topoOrder, upstreamSteps, validateGraph } from './executor.ts';
import { suggestMappings } from './mapping.ts';

const rec = (name: string, body: unknown, status = 200): ResponseRecord => ({ name, status, headers: { 'x-req': 'r1' }, body, source: 'execution' });

describe('evaluateExpression', () => {
  const ctx = createContext({ environment: { env: { value: 'prod' } } }, [rec('Login', { data: { user: { id: 1001, role: 'admin', tags: ['a', 'b'] } } })]);
  const ev = (s: string) => evaluateExpression(s, ctx).value;
  it('compares references, literals and booleans', () => {
    expect(ev('{{$res.Login.status}} == 200')).toBe(true);
    expect(ev("{{Login.data.user.role}} == 'admin' && {{env}} != \"dev\"")).toBe(true);
    expect(ev('{{Login.data.user.id}} >= 1000 && !({{Login.data.user.id}} > 2000)')).toBe(true);
    expect(ev('{{Login.data.user.id}} == "1001"')).toBe(true);
    expect(ev('{{Login.data.user.tags}} contains "b" || false')).toBe(true);
    expect(ev('exists({{Login.data.user.missing}})')).toBe(false);
    expect(ev('{{Login.data.user.role}}')).toBe(true);
  });
  it('reports unresolved refs and syntax errors', () => {
    expect(evaluateExpression('{{Nope.x}} == 1', ctx)).toEqual({ value: false, unresolved: ['Nope.x'] });
    expect(() => checkExpression('{{a}} ==')).toThrow(ExpressionError);
    expect(() => checkExpression('1 = 1')).toThrow(ExpressionError);
    expect(() => checkExpression('')).toThrow(/empty/);
  });
});

function graph(steps: Partial<FlowStep>[], connections: [string, string, string?][]): FlowGraph {
  return FlowGraphInput.parse({
    steps: steps.map((s, i) => ({ kind: 'request', requestId: 'r', position: { x: 0, y: i * 100 }, ...s })),
    connections: connections.map(([source, target, handle], i) => ({ id: `c${i}`, source, target, handle: handle ?? 'out' })),
  });
}

describe('graph helpers', () => {
  it('orders by dependency, detects cycles and validates', () => {
    const g = graph([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }], [['a', 'b']]);
    expect(topoOrder(g)!.map((s) => s.id)).toEqual(['a', 'b']);
    expect(topoOrder(graph([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], [['a', 'b'], ['b', 'a']]))).toBeNull();
    const bad = graph([{ id: 'a', name: 'X' }, { id: 'b', name: 'x', requestId: null }, { id: 'c', name: 'C', kind: 'condition', expression: '1 ==' }], []);
    expect(validateGraph(bad).map((i) => i.message)).toEqual([
      'Two steps are named "x"; references need unique names',
      'Step "x" has no request',
      'Condition "C": Unexpected end of expression',
    ]);
    expect(upstreamSteps(graph([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], [['a', 'b'], ['b', 'c']]), 'c').map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('applies only the overridden fields', () => {
    const def = RequestDefinition.parse({ name: 'r', method: 'GET', url: '/a', headers: [{ id: '1', key: 'h', value: 'v', enabled: true }] });
    const out = applyOverrides(def, { url: '/b' });
    expect(out.url).toBe('/b');
    expect(out.headers).toEqual(def.headers);
  });
});

describe('executeFlow', () => {
  it('runs steps in order using only this run’s responses', async () => {
    const g = graph([{ id: 'login', name: 'Login' }, { id: 'profile', name: 'Profile' }], [['login', 'profile']]);
    const seen: string[] = [];
    const res = await executeFlow(g, {
      stopOnError: true,
      run: async (step, responses) => {
        seen.push(`${step.name}:${[...responses.keys()].join(',')}`);
        return { ok: true, record: rec(step.name, { n: step.name }) };
      },
    });
    expect(res.status).toBe('success');
    expect(seen).toEqual(['Login:', 'Profile:Login']);
  });

  it('stops on error, or follows an error branch', async () => {
    const g = graph([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], [['a', 'b'], ['b', 'c']]);
    const events: string[] = [];
    const hooks = (stop: boolean) => ({
      stopOnError: stop,
      run: async (s: FlowStep) => ({ ok: s.id !== 'b', error: s.id === 'b' ? 'HTTP 500' : undefined }),
      onFinish: (s: FlowStep, st: string) => void events.push(`${s.id}:${st}`),
      onSkip: (s: FlowStep) => void events.push(`${s.id}:skipped`),
    });
    const stopped = await executeFlow(g, hooks(true));
    expect(stopped).toMatchObject({ status: 'failed', error: 'Step "B" failed: HTTP 500' });
    expect(events).toEqual(['a:success', 'b:failed', 'c:skipped']);

    events.length = 0;
    const g2 = graph([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }], [['a', 'b'], ['b', 'c'], ['b', 'd', 'error']]);
    const handled = await executeFlow(g2, hooks(true));
    expect(handled.status).toBe('success');
    expect(events).toEqual(['a:success', 'b:failed', 'c:skipped', 'd:success']);

    events.length = 0;
    const cont = await executeFlow(g, hooks(false));
    expect(cont.status).toBe('failed');
    expect(events).toEqual(['a:success', 'b:failed', 'c:success']);
  });

  it('takes one branch of a condition and joins afterwards', async () => {
    const g = graph(
      [
        { id: 'cond', name: 'Is admin', kind: 'condition', expression: 'true', requestId: null },
        { id: 'yes', name: 'Yes' },
        { id: 'no', name: 'No' },
        { id: 'end', name: 'End' },
      ],
      [['cond', 'yes', 'true'], ['cond', 'no', 'false'], ['yes', 'end'], ['no', 'end']],
    );
    const ran: string[] = [];
    await executeFlow(g, {
      stopOnError: true,
      run: async (s) => {
        ran.push(s.id);
        return s.kind === 'condition' ? { ok: true, branch: false } : { ok: true };
      },
    });
    expect(ran).toEqual(['cond', 'no', 'end']);
  });

  it('honours abort', async () => {
    const ctl = new AbortController();
    const g = graph([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], [['a', 'b']]);
    const res = await executeFlow(g, { stopOnError: true, signal: ctl.signal, run: async () => (ctl.abort(), { ok: true }) });
    expect(res.status).toBe('stopped');
  });
});

describe('suggestMappings', () => {
  const login = { name: 'Login', body: { data: { access_token: 'tok', user: { id: 1001, name: 'John' } } } };
  const orders = { name: 'Get User Orders', body: { data: [{ id: 5001, userId: 1001 }], meta: { total: 2 } } };
  it('maps path ids by the resource segment, tokens into bearer auth, and prefixed ids', () => {
    const profile = RequestDefinition.parse({
      name: 'p',
      method: 'GET',
      url: '{{baseUrl}}/users/:id',
      pathParams: [{ id: '1', key: 'id', value: '1001', enabled: true }],
      headers: [{ id: '2', key: 'X-User-Id', value: '', enabled: true }],
    });
    expect(suggestMappings(profile, { type: 'bearer', token: '{{accessToken}}' }, [login], (t) => t === '{{accessToken}}')).toEqual([
      { field: 'pathParam', key: 'id', ref: 'Login.data.user.id', reason: 'matches Login → data.user.id' },
      { field: 'header', key: 'X-User-Id', ref: 'Login.data.user.id', reason: 'matches Login → data.user.id' },
      { field: 'auth', key: 'token', ref: 'Login.data.access_token', reason: 'bearer token from Login → data.access_token' },
    ]);
    const order = RequestDefinition.parse({ name: 'o', method: 'GET', url: '/orders/:orderId', pathParams: [{ id: '1', key: 'orderId', value: '', enabled: true }] });
    expect(suggestMappings(order, { type: 'inherit' }, [orders, login])[0]).toMatchObject({ key: 'orderId', ref: 'Get User Orders.data[0].id' });
  });
  it('leaves fields that already reference something', () => {
    const def = RequestDefinition.parse({ name: 'p', method: 'GET', url: '/users/:id', pathParams: [{ id: '1', key: 'id', value: '{{Other.id}}', enabled: true }] });
    expect(suggestMappings(def, { type: 'none' }, [login])).toEqual([]);
  });
});
