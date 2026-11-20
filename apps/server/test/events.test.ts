import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TOKEN, type Harness } from './harness.ts';

let h: Harness;
let url: string;
beforeEach(async () => {
  h = await createHarness();
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = h.app.server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterEach(async () => {
  await h.close();
});

/** Collects `change` events from /events until stopped. */
async function listen() {
  const controller = new AbortController();
  const events: { origin: string | null; what: string }[] = [];
  const res = await fetch(`${url}/events`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: controller.signal });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  const done = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (chunk.includes('event: change') && data) events.push(JSON.parse(data.slice(5)));
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { events, stop: async () => (controller.abort(), done) };
}

const post = (path: string, body: unknown, client?: string) =>
  fetch(`${url}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(client && { 'X-Postguy-Client': client }) },
    body: JSON.stringify(body),
  });

describe('workspace change events', () => {
  it('reports writes with the window that made them, and skips reads and failures', async () => {
    const live = await listen();
    const col = (await (await post('/collections', { name: 'Shop', parentId: null }, 'window-1')).json()) as { id: string };
    await post('/requests', { collectionId: col.id, name: 'Ping', method: 'GET', url: 'http://x' });
    await post('/resolve-preview', { templates: ['{{a}}'] }, 'window-1');
    await post('/requests', { collectionId: 'missing', name: 'Bad', method: 'GET', url: 'http://x' });
    await new Promise((r) => setTimeout(r, 200));
    await live.stop();
    expect(live.events).toEqual([
      { origin: 'window-1', what: 'POST /collections' },
      { origin: null, what: 'POST /requests' },
    ]);
  });

  it('reports changes Claude makes through MCP, but not its reads', async () => {
    await h.call('PATCH', '/settings/mcp', { enabled: true, edit: true });
    const col = (await h.call('POST', '/collections', { name: 'Shop', parentId: null })).body;
    const live = await listen();
    const rpc = (id: number, name: string, args: object) =>
      fetch(`${url}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
      });
    await rpc(1, 'list_requests', {});
    await rpc(2, 'create_request', { collectionId: col.id, name: 'From Claude', url: 'http://x/y' });
    await new Promise((r) => setTimeout(r, 200));
    await live.stop();
    expect(live.events).toEqual([{ origin: null, what: 'mcp:create_request' }]);
  });
});
