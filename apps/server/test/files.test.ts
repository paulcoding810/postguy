import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
let dir: string;
let sink: http.Server;
let sinkUrl = '';
let last: { headers: http.IncomingHttpHeaders; body: Buffer } | null = null;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'postguy-files-'));
  sink = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      last = { headers: req.headers, body: Buffer.concat(chunks) };
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => sink.listen(0, '127.0.0.1', () => r()));
  const addr = sink.address();
  sinkUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(async () => {
  await new Promise((r) => sink.close(r));
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  h = await createHarness();
  last = null;
});
afterEach(async () => {
  await h.close();
});

const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a]);

describe('sending files', () => {
  it('sends a form-data file field as a real file part and keeps only a summary in history', async () => {
    const file = join(dir, 'avatar.png');
    writeFileSync(file, bytes);
    const res = await h.call('POST', '/send', {
      request: {
        name: 'up',
        method: 'POST',
        url: `${sinkUrl}/up`,
        body: { mode: 'form', form: [{ id: '1', key: 'name', value: 'paul', enabled: true }, { id: '2', key: 'avatar', value: '', enabled: true, type: 'file', src: file }] },
      },
    });
    expect(res.body.status).toBe(200);
    const boundary = /boundary=(.+)$/.exec(String(last!.headers['content-type']))![1]!;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\npaul\r\n--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n`,
    );
    expect(last!.body).toEqual(Buffer.concat([head, bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]));
    const entry = (await h.call('GET', `/history/${res.body.historyId}`)).body;
    expect(entry.request.body).toBe('name=paul\navatar=<file avatar.png, 8 B>');
  });

  it('sends a binary body with the file bytes and its content type', async () => {
    const file = join(dir, 'data.bin');
    writeFileSync(file, bytes);
    const res = await h.call('POST', '/send', { request: { name: 'bin', method: 'PUT', url: `${sinkUrl}/bin`, body: { mode: 'binary', src: file, contentType: 'image/png' } } });
    expect(res.body.status).toBe(200);
    expect(last!.headers['content-type']).toBe('image/png');
    expect(last!.body).toEqual(bytes);
    expect((await h.call('GET', `/history/${res.body.historyId}`)).body.request.body).toBe('<file data.bin, 8 B>');
  });

  it('reports a missing file instead of sending', async () => {
    const res = await h.call('POST', '/send', { request: { name: 'bin', method: 'POST', url: `${sinkUrl}/bin`, body: { mode: 'binary', src: join(dir, 'nope.png') } } });
    expect(res.body.error).toMatchObject({ code: 'FILE_NOT_FOUND' });
    expect(res.body.error.message).toContain('nope.png');
    expect(last).toBeNull();
    const empty = await h.call('POST', '/send', {
      request: { name: 'up', method: 'POST', url: `${sinkUrl}/up`, body: { mode: 'form', form: [{ id: '1', key: 'f', value: '', enabled: true, type: 'file' }] } },
    });
    expect(empty.body.error).toMatchObject({ code: 'FILE_NOT_FOUND', message: 'A file field has no file chosen' });
  });

  it('shows file fields and file bodies to scripts', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'hi');
    const res = await h.call('POST', '/send', {
      request: {
        name: 'up',
        method: 'POST',
        url: `${sinkUrl}/up`,
        body: { mode: 'form', form: [{ id: '1', key: 'doc', value: '', enabled: true, type: 'file', src: file }] },
        scripts: { pre: `pm.test('file field', () => pm.expect(pm.request.body.formdata[0]).to.eql({ key: 'doc', value: '', type: 'file', src: ${JSON.stringify(file)} })); pm.request.body.update(pm.request.body.toJSON());`, post: '' },
      },
    });
    expect(res.body.scripts[0].assertions).toEqual([{ ok: true, message: 'file field' }]);
    expect(res.body.status).toBe(200);
    const bin = await h.call('POST', '/send', {
      request: {
        name: 'bin',
        method: 'POST',
        url: `${sinkUrl}/bin`,
        body: { mode: 'binary', src: file },
        scripts: { pre: `pm.test('mode', () => pm.expect(pm.request.body.mode).to.equal('file')); pm.request.body.update(pm.request.body.toJSON());`, post: '' },
      },
    });
    expect(bin.body.scripts[0].assertions).toEqual([{ ok: true, message: 'mode' }]);
    expect(last!.body.toString()).toBe('hi');
  });
});
