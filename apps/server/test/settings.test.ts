import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
let slow: http.Server;
let slowUrl: string;
beforeEach(async () => {
  h = await createHarness();
  slow = http.createServer((req, res) => {
    if (req.url === '/hop') return res.writeHead(302, { location: '/done' }).end();
    if (req.url === '/done') return res.end('done');
    setTimeout(() => res.end('late'), 400);
  });
  await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r));
  const a = slow.address();
  slowUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
afterEach(async () => {
  await h.close();
  slow.close();
});

const send = async (url: string, settings: Record<string, unknown> = {}) =>
  (await h.call('POST', '/send', { request: { name: 'R', method: 'GET', url, settings } })).body;

describe('request defaults', () => {
  it('start as before and can be changed', async () => {
    expect((await h.call('GET', '/settings/requests')).body).toEqual({ timeoutMs: 30000, followRedirects: true, rejectUnauthorized: true });
    expect((await h.call('PATCH', '/settings/requests', { followRedirects: false })).body).toMatchObject({ followRedirects: false, timeoutMs: 30000 });
    expect((await h.call('PATCH', '/settings/requests', { timeoutMs: 5000 })).body).toMatchObject({ followRedirects: false, timeoutMs: 5000 });
    expect((await h.call('PATCH', '/settings/requests', { timeoutMs: 0 })).status).toBe(400);
    await h.call('PATCH', '/settings/preferences', { autoUpdateCheck: false });
    expect((await h.call('PATCH', '/settings/preferences', {})).body).toEqual({ autoUpdateCheck: false });
  });

  it('apply to requests that leave a setting unset, while a request’s own value wins', async () => {
    await h.call('PATCH', '/settings/requests', { timeoutMs: 100, followRedirects: false });
    expect((await send(`${slowUrl}/slow`)).error?.message).toMatch(/timed out after 100 ms/);
    expect((await send(`${slowUrl}/slow`, { timeoutMs: 2000 })).body).toBe('late');
    expect((await send(`${slowUrl}/hop`)).status).toBe(302);
    expect((await send(`${slowUrl}/hop`, { followRedirects: true })).body).toBe('done');
  });
});

describe('Copy as cURL', () => {
  it('follows the default for checking TLS certificates', async () => {
    const curl = async (settings: Record<string, unknown> = {}) =>
      (await h.call('POST', '/export/curl', { request: { name: 'R', method: 'GET', url: 'https://self-signed.test/', settings } })).body.command;
    expect(await curl()).not.toContain('-k');
    await h.call('PATCH', '/settings/requests', { rejectUnauthorized: false });
    expect(await curl()).toContain('-k');
    expect(await curl({ rejectUnauthorized: true })).not.toContain('-k');
  });
});
