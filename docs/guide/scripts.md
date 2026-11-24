# Scripts

Requests, folders, collections and flow steps can run JavaScript before a request is sent (**Pre-request**) and after its response arrives (**Post-response**).

Scripts run in a QuickJS WebAssembly sandbox with no file or process access, a 2-second time limit and a memory cap. The only way out to the network is [`pm.sendRequest`](#sending-requests-from-a-script).

## Order

For one request, scripts run outermost first: collection, then folders, then the request, then the flow step if it runs in a flow. This is the same order as Postman.

## Pre-request scripts

A pre-request script runs before `{{variables}}` are resolved. It can change what is sent through `request`:

```js
request.headers['X-Request-Id'] = String(Date.now());
request.url = request.url + '&debug=1';
```

## Post-response scripts

`response` holds the response: `status`, `headers`, `body` (parsed JSON, or text) and `timeMs`.

```js
flow.assert(response.status === 200, 'status is 200');
flow.set('token', response.body.data.access_token); // {{token}} for later steps
env.set('userId', response.body.data.user.id);       // saved to the active environment
flow.log('user', response.body.data.user.name);
```

A failed assertion fails the request, or the step in a flow. A script error stops it.

## The API

| Call | Does |
| --- | --- |
| `flow.response(name)` | The response of the request or step called `name`: from this run in a flow, otherwise the remembered one |
| `flow.set(key, value)` | Sets a runtime variable, the highest [precedence](/guide/variables#precedence) |
| `flow.get(key)` | Reads a runtime value, or any variable |
| `flow.assert(condition, message)` | Records a check; false fails the request |
| `flow.log(...values)` | Writes to the **Tests** tab, or the flow's run log |
| `env.get(key)`, `env.set(key, value)` | Reads or saves a variable in the active environment, or globals when none is active |
| `request` | Pre-request only: `method`, `url`, `headers`, `body` |
| `response` | Post-response only: `status`, `headers`, `body`, `timeMs` |
| `console.log` / `info` / `warn` / `error` | Same as `flow.log` |
| `btoa`, `atob` | Base64 |
| `CryptoJS` or `require('crypto-js')` | Hashes (MD5, SHA-1, SHA-2, SHA-3), HMAC, encoders and random bytes. Ciphers such as AES are not available |

The editor autocompletes `response.body` and `flow.response('…').body` from remembered responses, so field names come from real data.

## Postman scripts

Scripts imported from Postman run as they are:

- `pm.test` and `pm.expect` (chai-style);
- `pm.response`, `pm.request` (including `pm.request.body.update`) and `pm.cookies`;
- `pm.environment`, `pm.globals`, `pm.collectionVariables` and `pm.variables`;
- the older `postman.*` functions and the `tests["…"]` form.

`postman.setNextRequest` doesn't run; use a [flow](/guide/flows) and its conditions instead. It is noted when importing.

## Sending requests from a script

`pm.sendRequest` sends a request of its own, most often to fetch a token before the main request:

```js
// pre-request
const res = await pm.sendRequest({
  url: '{{baseUrl}}/auth/login',
  method: 'POST',
  header: { 'Content-Type': 'application/json' },
  body: { mode: 'raw', raw: JSON.stringify({ user: 'ann', password: pm.environment.get('password') }) },
});
pm.environment.set('token', res.json().access_token);
```

`fetch` works too, for the usual case: `fetch(url, { method, headers, body })` with a string body, and a response with `ok`, `status`, `headers.get()`, `json()` and `text()`. Streams, `blob()`, `FormData` and `AbortController` aren't available. Like the browser's, it rejects only on network errors; check `res.ok` for error statuses.

The callback form of `pm.sendRequest` works too: `pm.sendRequest(req, (err, res) => { … })`. `req` is a URL or `{ url, method, header, body }`, with raw, URL-encoded or GraphQL bodies. `res` has `code`, `status`, `headers`, `json()` and `text()`, like `pm.response`.

- `{{variables}}` are filled in, the cookie jar is used, and the default timeout and TLS settings from **Settings → Requests** apply.
- Each call appears in the script's log and in **Activity**, labelled *script*.
- A script may send up to 10 requests, with `pm.sendRequest` and `fetch` together, in at most 30 seconds in all. Waiting for them doesn't count towards the 2-second limit.
- When a collection is imported, its notes list the hosts its scripts send to. Check them: a script can send your variables anywhere.
- When Claude sends the request, script requests follow the same [host lock](/guide/claude#secrets-only-go-where-they-already-go): secrets only go to hosts your saved requests use.

Prefer a [flow](/guide/flows) when the steps are requests you'd also send on their own; `pm.sendRequest` is for small helpers like logging in.

## Writing scripts without typing them

- **Snippets** above the editor inserts common lines. In a post-response script, **From the last response** offers lines written for the response you actually got: its status, whether it's JSON, saving any token-like fields, and checking its main fields exist.
- In a response's **Tree** view, **Save as variable** on a row adds a line that saves that value after each response. **Test this value** adds an assertion: equality for stable values, presence for ids, tokens and dates. The Post-response tab opens with the new line highlighted.
