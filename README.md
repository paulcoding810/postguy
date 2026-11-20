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
pnpm build:app  # packaged desktop app with its own server (see Packaging)
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

1. Runtime values set by scripts with `flow.set`
2. Request variables
3. Flow variables
4. Collection variables, innermost folder first
5. The active environment
6. Globals

A response reference resolves from the request's pinned snapshot if one is pinned, otherwise from its latest successful (2xx) snapshot. Requests in the same collection are matched first.

## Smart response memory

Every JSON response of a saved request is stored as a new snapshot; older snapshots are kept (up to 50 per request). For each snapshot Postguy extracts all JSON paths and infers a JSON Schema. Schemas are stored separately from the values and deduplicated by hash. When the request came from an OpenAPI spec, the response is also validated against the documented schema.

Open the Smart Data panel (⌘J), pick a remembered response and double-click a value to insert its reference into the field you last focused.

## Flows

A flow chains saved requests on a canvas (Flows in the sidebar). In **Add step**, tick several requests to add them as a chain in the order ticked, or right-click a collection or folder and choose **Create flow from folder**. New steps connect to the previous one; Postguy maps its inputs from earlier responses, such as `:id` from `Login.data.user.id` and a bearer token from `Login.data.access_token`. Use **Auto-map inputs** after a first run to map values that only exist then.

- Step names are reference names: `{{Login.data.access_token}}` reads the Login step's response from the current run only, never a stale one. A step with an unresolved reference fails instead of sending.
- Condition steps branch on expressions such as `{{$res.Login.status}} == 200 && {{Login.data.user.role}} != 'admin'`.
- A request step's red output runs when it fails; otherwise **Stop on error** decides whether the flow continues.
- The execution log streams each step's status, timing and logs; any step can be rerun with the responses of that run.
- **Debug** pauses before every step; breakpoints pause before chosen steps. While paused you can edit the next step's inputs, then Step or Continue.
- **Report** exports a run as Markdown, HTML or JSON with credentials masked.

## Scripts

Requests and flow steps have pre-request and post-response scripts, run in a QuickJS WebAssembly sandbox with no filesystem, network or process access, a 2-second limit and a memory cap.

```js
// post-response
const login = flow.response('Login');          // this run's response, or the remembered one
flow.set('token', login.body.data.access_token); // {{token}} for later steps
flow.assert(response.status === 200, 'status is 200');
env.set('userId', response.body.data.user.id);   // saved to the active environment
flow.log('user', response.body.data.user.name);
```

Pre-request scripts run before variables are resolved and can edit `request.url`, `request.headers` and `request.body`. A script error stops the request; a failed assertion fails it. The editor autocompletes response fields from remembered responses.

## Auth

Bearer, Basic, API key and OAuth 2.0. For the client-credentials and password grants, leave the access token empty: Postguy fetches a token from the token URL, reuses it until it expires, and masks it everywhere.

For the authorization-code grant, choose **Sign in with OAuth 2.0**. Postguy opens the provider in your browser with PKCE, receives the redirect on `http://127.0.0.1:<port>/oauth/callback` (the loopback redirect recommended for native apps), exchanges the code, and refreshes the token with the refresh token when it expires. The port is the local server's, which changes between launches of the packaged app, so the provider must accept any loopback port. Tokens are held in memory, so you sign in again after restarting.

## OpenAPI sync

Open a spec under OpenAPI and choose **Sync & versions**. Postguy compares the new version operation by operation, shows the effect on your requests, and on apply creates requests for new operations, regenerates the ones you have not edited, keeps edited ones, and leaves requests of removed operations in place. Any two stored versions can be compared.

## Import

Paste a cURL command into the URL bar and the request is filled in, with Undo. Bash, zsh, Windows cmd and PowerShell forms from browsers' "Copy as cURL" work. **Import cURL…** opens one in a new tab, and **Copy as cURL** (next to Save) exports a request with variables and auth resolved, warning when it contains secrets.

Collections import from a Postguy export or a Postman v2.0/v2.1 file. Postman scripts run as they are through a `pm.*` compatibility layer: `pm.test`, `pm.expect` (chai-style), `pm.response`, `pm.request`, `pm.environment`, `pm.globals`, `pm.collectionVariables`, `pm.variables`, and the legacy `postman.*` and `tests[...]` forms. `pm.sendRequest` is not available; chain requests in a flow instead.

## Secrets

Variables marked secret, and auth credentials, are masked in history, previews and logs. Collection exports and OpenAPI exports never contain secret values. The local server only accepts requests carrying its per-session token.

## Change history

Each collection keeps a history of edits to its requests, folders, scripts, auth and collection variables: what changed, when, and who did it (you, Claude, another program through the API, OpenAPI sync, or an import). Open it from a collection's **Change history**, or **Show history** on a request or folder, to see a before/after diff and **Restore previous version**. Deleted requests and folders come back with **Bring back**, including their scripts and variables and their place in flows; deleted collections are under **Recently deleted** in the sidebar. Quick successive edits merge into one entry, reorders and values set by scripts are not recorded, and each collection keeps its latest 200 entries for up to 90 days. Secret values are masked in the history view.

## Claude (MCP)

Claude Code can use Postguy through the Model Context Protocol: find and send requests, read variables, history and flow runs, run flows, and create or change requests. Turn it on in **Claude (MCP)** (the robot icon in the top bar, or ⌘K), then run the setup command shown there once, e.g. `claude mcp add postguy -- node apps/server/bin/postguy-mcp.mjs`. The bridge finds the running app through `server.json` in its data folder, so Claude reaches Postguy only while it is open.

- **Off by default.** Once on, Claude may only read until you also allow **Send requests** and **Edit**. Each tool call checks the current switches.
- **Secrets stay hidden.** Secret values are masked in everything Claude reads, including response bodies that echo them; `decode_jwt` returns a token's claims but never the token. Claude writes `{{name}}` and Postguy fills it in when sending.
- **Secrets only go where they already go.** A request carrying a secret is refused unless its host is one your saved requests already use, so a prompt injection in a response cannot send your token elsewhere.
- **Per environment**, in the environment manager: keep an environment away from Claude entirely, or let it see that environment's secret values (for a throwaway local one).
- Everything Claude sends is labelled **MCP** in History.

## Packaging

`pnpm build:app` bundles the server with esbuild into `src-tauri/resources/server` (with the native SQLite module, QuickJS WebAssembly and migrations) and ships Node as a Tauri sidecar. If the local Node links shared libraries (Homebrew's does), the official build of the same version is downloaded from nodejs.org and verified against its published SHA-256 checksums. The app starts the server on a free port with a random token, stores data in the OS app-data folder (`server.log` sits there too), and stops it on exit.

Releases for macOS (Apple Silicon and Intel), Windows and Linux are built by GitHub Actions, with macOS signing and notarization when Apple credentials are configured. See [docs/RELEASING.md](docs/RELEASING.md).

## Status

All six roadmap phases are implemented: API client, OpenAPI integration, smart response memory, flow builder, script engine, and sync, OAuth, debugging, reports, Postman import and packaging.
