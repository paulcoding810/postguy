#!/usr/bin/env node
// Claude (MCP) bridge: relays stdio JSON-RPC to the running Postguy app's /mcp endpoint.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

function dataDirs() {
  const i = process.argv.indexOf('--data-dir');
  if (i > 0 && process.argv[i + 1]) return [process.argv[i + 1]];
  if (process.env.POSTGUY_DATA_DIR) return [process.env.POSTGUY_DATA_DIR];
  const app = 'com.postguy.app';
  if (process.platform === 'darwin') return [join(homedir(), 'Library', 'Application Support', app)];
  if (process.platform === 'win32') return [join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), app)];
  return [join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), app)];
}

/** Read on every message, so the bridge follows the app across restarts. */
function server() {
  for (const dir of dataDirs()) {
    try {
      const s = JSON.parse(readFileSync(join(dir, 'server.json'), 'utf8'));
      if (s.url && s.token) return s;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const fail = (id, message) => id !== undefined && id !== null && write({ jsonrpc: '2.0', id, error: { code: -32000, message } });

async function relay(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const s = server();
  if (!s) return fail(msg.id, "Postguy isn't running. Open Postguy and try again.");
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: line,
    });
    const text = await res.text();
    if (!text.trim()) return;
    let out;
    try {
      out = JSON.parse(text);
    } catch {
      return fail(msg.id, `Postguy answered ${res.status}: ${text.slice(0, 200)}`);
    }
    for (const m of Array.isArray(out) ? out : [out]) write(m);
  } catch {
    fail(msg.id, "Postguy isn't running. Open Postguy and try again.");
  }
}

let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim()) queue = queue.then(() => relay(line));
});
