# Response memory and references

Postguy keeps the JSON responses of saved requests, so later requests can use their values without copying.

## What is remembered

Each JSON response of a saved request is stored as a snapshot, up to 50 per request. For each one Postguy records every JSON path and infers a JSON schema. Schemas are stored apart from values and shared between identical shapes. When the request came from an OpenAPI spec, the response is also checked against the documented schema, and the result shows next to the status.

## Referencing a value

| Template | Reads |
| --- | --- |
| `{{Login.data.access_token}}` | `data.access_token` in the latest response of the request named **Login** |
| `{{$res.Login.status}}` | Its status code |
| `{{$res.Login.headers.content-type}}` | A response header |
| `{{$res.Login.body.data}}` | The explicit body form, needed when the request name has dots or brackets |

Paths can index lists and filter them:

- `items[0].id` reads the first item.
- `items[*].id` reads every item.
- `items[?(@.active)].id` uses a JSONPath filter.

A reference resolves from the request's **pinned** snapshot if one is pinned, otherwise from its latest successful (2xx) response. Requests in the same collection are matched first.

## Inserting references

You don't have to type paths:

- Type `{{` in a field for suggestions from variables and remembered responses.
- Open **Smart Data** with <kbd>⌘J</kbd>, pick a request and double-click a value. Its reference goes into the field you last clicked.
- In a response's **Tree** view, use **Insert reference** or **Copy reference** on a row.

In the Smart Data panel you can browse older snapshots, pin the one references should use, and see the inferred schema.

## In scripts

Scripts get the same data with types: `flow.response('Login').body.data.access_token` autocompletes from the remembered response. See [Scripts](/guide/scripts).
