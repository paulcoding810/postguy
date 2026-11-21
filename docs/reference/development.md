# Building from source

Requirements: Node 22 or later, pnpm 10, and Rust for the desktop shell.

```sh
pnpm install
pnpm dev        # mock API (4780) + server (4777) + Tauri desktop window
pnpm dev:web    # the same, with the UI in the browser at http://localhost:1420
pnpm test       # unit and integration tests
pnpm typecheck
pnpm build:app  # packaged desktop app with its own server
pnpm docs:dev   # this documentation site
```

In development, data is stored in `.data/postguy.db`. The bundled mock shop API runs on `http://127.0.0.1:4780` and serves its own spec at `/openapi.yaml` (user `john`, password `secret`), which is handy for trying imports, flows and auth.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/desktop` | Tauri shell and React UI |
| `apps/server` | Fastify API, SQLite schema and migrations, HTTP execution |
| `packages/core` | Pure engines: template resolution, redaction, OpenAPI and Postman import/export, schema inference, JSON paths, the script sandbox |
| `packages/shared` | Zod schemas, domain types and the typed route contract |
| `packages/mock-api` | Mock shop API and OpenAPI 2.0 / 3.0 / 3.1 fixtures |
| `docs` | This site (VitePress) |

The desktop app depends only on `shared`. The server depends on `core` and `shared`.

## Packaging

`pnpm build:app` bundles the server with esbuild into `src-tauri/resources/server`, with the native SQLite module, the QuickJS WebAssembly and the migrations, and ships Node as a Tauri sidecar. If your local Node links shared libraries (Homebrew's does), the official build of the same version is downloaded from nodejs.org and checked against its published SHA-256 checksums.

The installed app starts the server on a free port with a random token, keeps data in the OS app-data folder (`server.log` is there too), and stops the server on exit.
