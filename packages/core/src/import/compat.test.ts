import { describe, expect, it } from 'vitest';
import { compatibilityWarnings } from './compat.ts';
import { postmanDroppedScripts, postmanToCollection } from './postman.ts';

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
  it('reports dropped collection and folder scripts', () => {
    expect(postmanDroppedScripts(collection)).toEqual([`Collection- and folder-level scripts were not imported (Postguy runs scripts per request): "Shop".`]);
  });
});
