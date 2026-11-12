import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture } from '@postguy/mock-api';
import { waitForExecution } from '../src/services/flows.ts';
import { createHarness, TOKEN, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

async function setup() {
  const imp = (await h.call('POST', '/openapi/import', { sourceType: 'paste', content: fixture('mock-api.openapi.yaml') })).body;
  const root = (await h.call('GET', '/collections/tree')).body.find((c: any) => c.id === imp.collectionId);
  await h.call('PUT', `/variables/collection/${root.id}`, { variables: [{ key: 'baseUrl', value: h.mockUrl }, { key: 'accessToken', value: '', isSecret: true }] });
  const req = (name: string) => [root, ...root.children].flatMap((c: any) => c.requests).find((r: any) => r.name === name).id as string;
  const flow = (await h.call('POST', '/flows', { name: 'Checkout', collectionId: root.id })).body;
  return { root, req, flow };
}

const step = (id: string, name: string, requestId: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  kind: 'request',
  requestId,
  position: { x: 0, y: Number(id.replace(/\D/g, '') || 0) * 100 },
  ...extra,
});

async function run(flowId: string) {
  const exec = (await h.call('POST', `/flows/${flowId}/run`, {})).body;
  await waitForExecution(exec.id);
  return (await h.call('GET', `/executions/${exec.id}`)).body;
}

describe('flows', () => {
  it('runs Login → Profile → Orders → Order with auto-mapped inputs and fresh tokens', async () => {
    const { req, flow } = await setup();
    await h.call('PUT', `/flows/${flow.id}/graph`, {
      steps: [step('s1', 'Login', req('Login')), step('s2', 'Profile', req('Get User Profile'))],
      connections: [{ id: 'c1', source: 's1', target: 's2' }],
    });

    const before = (await h.call('POST', `/flows/${flow.id}/suggest-mappings`, { stepId: 's2' })).body;
    expect(before).toEqual([]);

    const first = await run(flow.id);
    expect(first.status).toBe('failed');
    expect(first.steps.map((s: any) => [s.stepName, s.status])).toEqual([['Login', 'success'], ['Profile', 'failed']]);

    const sources = (await h.call('GET', `/flows/${flow.id}/sources?stepId=s2`)).body;
    expect(sources[0]).toMatchObject({ name: 'Login', origin: 'execution', status: 200 });
    const suggestions = (await h.call('POST', `/flows/${flow.id}/suggest-mappings`, { stepId: 's2' })).body;
    expect(suggestions.map((s: any) => [s.field, s.key, s.ref])).toEqual([
      ['pathParam', 'id', 'Login.data.user.id'],
      ['auth', 'token', 'Login.data.access_token'],
    ]);

    await h.call('PUT', `/flows/${flow.id}/graph`, {
      steps: [
        step('s1', 'Login', req('Login')),
        step('s2', 'Profile', req('Get User Profile'), {
          overrides: {
            pathParams: [{ id: 'p', key: 'id', value: '{{Login.data.user.id}}', enabled: true }],
            auth: { type: 'bearer', token: '{{Login.data.access_token}}' },
          },
        }),
        step('s3', 'Orders', req('Get User Orders'), {
          overrides: {
            pathParams: [{ id: 'p', key: 'id', value: '{{Profile.data.id}}', enabled: true }],
            auth: { type: 'bearer', token: '{{Login.data.access_token}}' },
          },
        }),
        step('s4', 'Order', req('Get Order Details'), {
          overrides: {
            pathParams: [{ id: 'p', key: 'orderId', value: '{{Orders.data[0].id}}', enabled: true }],
            auth: { type: 'bearer', token: '{{Login.data.access_token}}' },
          },
        }),
      ],
      connections: [
        { id: 'c1', source: 's1', target: 's2' },
        { id: 'c2', source: 's2', target: 's3' },
        { id: 'c3', source: 's3', target: 's4' },
      ],
    });

    const ok = await run(flow.id);
    expect(ok.status).toBe('success');
    expect(ok.steps.map((s: any) => [s.stepName, s.status, s.response.status])).toEqual([
      ['Login', 'success', 200],
      ['Profile', 'success', 200],
      ['Orders', 'success', 200],
      ['Order', 'success', 200],
    ]);
    expect(ok.steps[3].request.url).toBe(`${h.mockUrl}/orders/5001`);
    expect(ok.steps[1].request.headers.Authorization).toBe('Bearer ••••••');
    expect(ok.steps[1].logs[0].message).toMatch(/GET .*\/users\/1001 → 200/);

    const again = await run(flow.id);
    const t1 = ok.steps[0].response.body.data.access_token;
    const t2 = again.steps[0].response.body.data.access_token;
    expect(t2).not.toBe(t1);
    expect(again.status).toBe('success');
  });

  it('never resolves references from stale runs or snapshots', async () => {
    const { req, flow } = await setup();
    const loginId = req('Login');
    const saved = (await h.call('GET', `/requests/${loginId}`)).body;
    await h.call('POST', '/send', { requestId: loginId, request: saved });
    await h.call('PUT', `/flows/${flow.id}/graph`, {
      steps: [step('s1', 'Profile', req('Get User Profile'), { overrides: { auth: { type: 'bearer', token: '{{Login.data.access_token}}' } } })],
      connections: [],
    });
    const exec = await run(flow.id);
    expect(exec.steps[0]).toMatchObject({ status: 'failed', error: 'Unresolved: {{Login.data.access_token}}' });
    expect(exec.steps[0].historyId).toBeNull();
  });

  it('branches on conditions, reruns a step and streams events', async () => {
    const { req, flow } = await setup();
    await h.call('PUT', `/flows/${flow.id}/graph`, {
      steps: [
        step('s1', 'Login', req('Login')),
        { id: 's2', name: 'Is customer', kind: 'condition', expression: "{{Login.data.user.role}} == 'customer'", position: { x: 0, y: 200 } },
        step('s3', 'Health', req('Health check')),
        step('s4', 'Never', req('Health check')),
      ],
      connections: [
        { id: 'c1', source: 's1', target: 's2' },
        { id: 'c2', source: 's2', target: 's3', handle: 'true' },
        { id: 'c3', source: 's2', target: 's4', handle: 'false' },
      ],
    });
    const exec = (await h.call('POST', `/flows/${flow.id}/run`, {})).body;
    const stream = await h.app.inject({ url: `/executions/${exec.id}/events`, headers: { authorization: `Bearer ${TOKEN}` } });
    expect(stream.headers['content-type']).toMatch(/event-stream/);
    expect(stream.body).toContain('event: snapshot');
    expect(stream.body).toContain('event: end');
    await waitForExecution(exec.id);
    const detail = (await h.call('GET', `/executions/${exec.id}`)).body;
    expect(detail.steps.map((s: any) => [s.stepName, s.status, s.handle])).toEqual([
      ['Login', 'success', 'out'],
      ['Is customer', 'success', 'true'],
      ['Health', 'success', 'out'],
      ['Never', 'skipped', null],
    ]);

    const rerun = (await h.call('POST', `/executions/${exec.id}/steps/s2/rerun`, {})).body;
    await waitForExecution(rerun.id);
    const after = (await h.call('GET', `/executions/${exec.id}`)).body;
    const attempts = after.steps.filter((s: any) => s.stepId === 's2');
    expect(attempts.map((s: any) => [s.attempt, s.status, s.handle])).toEqual([[1, 'success', 'true'], [2, 'success', 'true']]);
    expect(after.status).toBe('success');
  });

  it('validates graphs and stops running executions', async () => {
    const { req, flow } = await setup();
    expect((await h.call('POST', `/flows/${flow.id}/run`, {})).status).toBe(422);
    expect((await h.call('PUT', `/flows/${flow.id}/graph`, { steps: [step('s1', 'A', 'missing')], connections: [] })).status).toBe(400);
    await h.call('PUT', `/variables/flow/${flow.id}`, { variables: [{ key: 'slowUrl', value: `${h.mockUrl}/slow` }] });
    await h.call('PUT', `/flows/${flow.id}/graph`, {
      steps: [step('s1', 'Slow', req('Health check'), { overrides: { url: '{{slowUrl}}' } }), step('s2', 'After', req('Health check'))],
      connections: [{ id: 'c1', source: 's1', target: 's2' }],
    });
    const exec = (await h.call('POST', `/flows/${flow.id}/run`, {})).body;
    expect((await h.call('POST', `/flows/${flow.id}/run`, {})).status).toBe(409);
    await new Promise((r) => setTimeout(r, 100));
    await h.call('POST', `/executions/${exec.id}/stop`, {});
    await waitForExecution(exec.id);
    const detail = (await h.call('GET', `/executions/${exec.id}`)).body;
    expect(detail.status).toBe('stopped');
    expect(detail.steps.map((s: any) => s.status)).toEqual(['failed', 'skipped']);
  });
});

describe('flow debugging', () => {
  const poll = async (id: string, status: string) => {
    for (let i = 0; i < 100; i++) {
      const d = (await h.call('GET', `/executions/${id}`)).body;
      if (d.status === status) return d;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`execution never reached ${status}`);
  };

  it('pauses at breakpoints, applies edits made while paused, and steps through', async () => {
    const { req, flow } = await setup();
    const graph = (bp: boolean, profileId = '{{Login.data.user.id}}') => ({
      steps: [
        step('s1', 'Login', req('Login')),
        step('s2', 'Profile', req('Get User Profile'), {
          breakpoint: bp,
          overrides: { pathParams: [{ id: 'p', key: 'id', value: profileId, enabled: true }], auth: { type: 'bearer', token: '{{Login.data.access_token}}' } },
        }),
        step('s3', 'Health', req('Health check')),
      ],
      connections: [
        { id: 'c1', source: 's1', target: 's2' },
        { id: 'c2', source: 's2', target: 's3' },
      ],
    });
    await h.call('PUT', `/flows/${flow.id}/graph`, graph(true, '999'));
    const exec = (await h.call('POST', `/flows/${flow.id}/run`, {})).body;
    const paused = await poll(exec.id, 'paused');
    expect(paused.pausedStepId).toBe('s2');
    expect(paused.steps.map((s: any) => s.stepName)).toEqual(['Login']);

    await h.call('PUT', `/flows/${flow.id}/graph`, graph(true));
    await h.call('POST', `/executions/${exec.id}/continue`, { mode: 'step' });
    const pausedAgain = await poll(exec.id, 'paused');
    expect(pausedAgain.pausedStepId).toBe('s3');
    expect(pausedAgain.steps[1]).toMatchObject({ stepName: 'Profile', status: 'success' });
    expect(pausedAgain.steps[1].request.url).toBe(`${h.mockUrl}/users/1001`);

    await h.call('POST', `/executions/${exec.id}/continue`, { mode: 'continue' });
    await waitForExecution(exec.id);
    const done = (await h.call('GET', `/executions/${exec.id}`)).body;
    expect(done).toMatchObject({ status: 'success', pausedStepId: null });
    expect((await h.call('POST', `/executions/${exec.id}/continue`, { mode: 'continue' })).status).toBe(400);
  });

  it('debug mode pauses before the first step and stop ends a paused run', async () => {
    const { req, flow } = await setup();
    await h.call('PUT', `/flows/${flow.id}/graph`, { steps: [step('s1', 'Login', req('Login'))], connections: [] });
    const exec = (await h.call('POST', `/flows/${flow.id}/run`, { debug: true })).body;
    expect((await poll(exec.id, 'paused')).pausedStepId).toBe('s1');
    await h.call('POST', `/executions/${exec.id}/stop`, {});
    await waitForExecution(exec.id);
    const done = (await h.call('GET', `/executions/${exec.id}`)).body;
    expect(done.status).toBe('stopped');
    expect(done.steps.map((s: any) => s.status)).toEqual(['skipped']);
  });
});
