# Scripts

Requests, folders, collections and flow steps can run JavaScript before a request is sent (**Pre-request**) and after its response arrives (**Post-response**).

Scripts run in a QuickJS WebAssembly sandbox with no file, network or process access, a 2-second time limit and a memory cap.

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

`pm.sendRequest` is not available; chain the requests in a [flow](/guide/flows) instead. A `postman.setNextRequest` call is noted when importing.

## Writing scripts without typing them

- **Snippets** above the editor inserts common lines. In a post-response script, **From the last response** offers lines written for the response you actually got: its status, whether it's JSON, saving any token-like fields, and checking its main fields exist.
- In a response's **Tree** view, **Save as variable** on a row adds a line that saves that value after each response. **Test this value** adds an assertion: equality for stable values, presence for ids, tokens and dates. The Post-response tab opens with the new line highlighted.
