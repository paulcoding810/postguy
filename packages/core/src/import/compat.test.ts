import { describe, expect, it } from 'vitest';
import { compatibilityWarnings } from './compat.ts';
import { postmanToCollection } from './postman.ts';

const collection = {
  info: { name: 'Shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  event: [{ listen: 'prerequest', script: { exec: ['console.log(1)'] } }],
  item: [
    {
      name: 'Login',
      request: { method: 'POST', url: '{{baseUrl}}/login?id={{$guid}}&x={{$randomBankAccount}}', body: { mode: 'raw', raw: '{"at":"{{$timestamp}}"}' } },
      event: [{ listen: 'prerequest', script: { exec: ["const sig = CryptoJS.HmacSHA256('a', 'k'); pm.sendRequest('https://x', () => {});", "CryptoJS.AES.encrypt('a','k')"] } }],
    },
    { name: 'Orders', item: [{ name: 'List', request: { method: 'GET', url: '{{baseUrl}}/orders' }, event: [{ listen: 'test', script: { exec: ['postman.setNextRequest("Login")'] } }] }] },
  ],
};

describe('compatibilityWarnings', () => {
  it('names unsupported script features and unknown built-in variables with the requests using them', () => {
    const w = compatibilityWarnings(postmanToCollection(collection).collection);
    expect(w).toEqual([
      `Scripts use pm.sendRequest (chain the requests in a flow instead), which Postguy doesn't run: "Login".`,
      `Scripts use CryptoJS ciphers (hashes, HMAC and encoders work), which Postguy doesn't run: "Login".`,
      `Scripts use setNextRequest (use flow conditions instead), which Postguy doesn't run: "Orders / List".`,
      `{{$randomBankAccount}} isn't a built-in variable Postguy knows, so it is sent as text: "Login".`,
    ]);
  });
  it('keeps collection and folder scripts', () => {
    expect(postmanToCollection(collection).collection.scripts).toEqual({ pre: '// Imported from Postman.\nconsole.log(1)\n', post: '' });
  });
  it('points at requests that send files', () => {
    const files = postmanToCollection({
      info: { name: 'F', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        { name: 'Up', request: { method: 'POST', url: 'https://x/up', body: { mode: 'formdata', formdata: [{ key: 'f', type: 'file', src: '/tmp/a.png' }] } } },
        { name: 'Blank', request: { method: 'POST', url: 'https://x/up', body: { mode: 'file', file: {} } } },
      ],
    }).collection;
    expect(compatibilityWarnings(files)).toEqual([
      'File fields have no file chosen; pick the files before sending: "Blank".',
      'Requests send files from the paths saved in the export; check they exist on this machine: "Up".',
    ]);
  });
});

describe('compatibility of collection and folder scripts', () => {
  it('names a collection or folder whose own script uses an unsupported feature', () => {
    const c = postmanToCollection({
      info: { name: 'Team', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      event: [{ listen: 'prerequest', script: { exec: ['pm.sendRequest("https://x", () => {})'] } }],
      item: [{ name: 'Users', event: [{ listen: 'test', script: { exec: ['pm.vault.get("k")'] } }], item: [] }],
    }).collection;
    expect(c.folders[0]!.scripts?.post).toContain('pm.vault');
    expect(compatibilityWarnings(c)).toEqual([
      `Scripts use pm.sendRequest (chain the requests in a flow instead), which Postguy doesn't run: "Team (collection scripts)".`,
      `Scripts use pm.vault, which Postguy doesn't run: "Users (folder scripts)".`,
    ]);
  });
});
