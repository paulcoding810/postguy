# Postguy

A local-first desktop API workspace: import OpenAPI specs, send requests, remember JSON responses, and reference values from earlier responses without copying them by hand.

Built with Tauri, React, Vite and TypeScript on the front end, and a Node/Fastify server with SQLite (Drizzle ORM) behind it.

## Getting started

Requirements: Node 22+, pnpm 10, Rust (for the desktop shell).

```sh
pnpm install
pnpm dev        # mock API (4780) + server (4777) + Tauri desktop window
pnpm dev:web    # same, but the UI runs in the browser at http://localhost:1420
pnpm test       # unit and integration tests
pnpm typecheck
```

Data is stored in `.data/postguy.db`. The bundled mock shop API runs on `http://127.0.0.1:4780` and serves its own spec at `/openapi.yaml` (user `john` / password `secret`).

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/desktop` | Tauri shell and React UI |
| `apps/server` | Fastify API, SQLite schema and migrations, HTTP execution |
| `packages/core` | Pure engines: template resolution, redaction, OpenAPI import/export, schema inference, JSON paths |
| `packages/shared` | Zod schemas, domain types and the typed route contract |
| `packages/mock-api` | Mock shop API and OpenAPI 2.0 / 3.0 / 3.1 fixtures |

The desktop app depends only on `shared`. The server depends on `core` and `shared`.

## Variables and references

Templates use double braces anywhere in a request: URL, params, path variables, headers, auth and body.

- `{{baseUrl}}` reads a variable.
- `{{Login.data.access_token}}` reads a value from the remembered response of the request named `Login`.
- `{{$res.Login.status}}`, `{{$res.Login.headers.content-type}}` and `{{$res.Login.body.data}}` are the explicit forms.
- Paths support `items[0].id`, `items[*].id` and JSONPath filters such as `items[?(@.active)].id`.
- Variables can contain references, so a collection variable `accessToken = {{Login.data.access_token}}` keeps auth fresh.

**Variable precedence, highest first:**

1. Runtime values set by scripts during a flow (planned)
2. Request variables
3. Flow variables (planned)
4. Collection variables, innermost folder first
5. The active environment
6. Globals

A response reference resolves from the request's pinned snapshot if one is pinned, otherwise from its latest successful (2xx) snapshot. Requests in the same collection are matched first.

## Smart response memory

Every JSON response of a saved request is stored as a new snapshot; older snapshots are kept (up to 50 per request). For each snapshot Postguy extracts all JSON paths and infers a JSON Schema. Schemas are stored separately from the values and deduplicated by hash. When the request came from an OpenAPI spec, the response is also validated against the documented schema.

Open the Smart Data panel (⌘J), pick a remembered response and double-click a value to insert its reference into the field you last focused.

## Secrets

Variables marked secret, and auth credentials, are masked in history, previews and logs. Collection exports and OpenAPI exports never contain secret values. The local server only accepts requests carrying its per-session token.

## Roadmap

Phases 1–3 are implemented: API client, OpenAPI integration and smart response memory. Next are the flow builder, the sandboxed script engine, OpenAPI sync and diff, and production packaging of the Node server as a Tauri sidecar.
