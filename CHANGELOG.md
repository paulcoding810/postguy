# Changelog

What changed in each Postguy release, newest first. Add to **Unreleased** as you go; before tagging, rename it to the new version (see [Releasing](docs/reference/releasing.md)). The section for a version becomes its GitHub release notes and the notes in the in-app update message.

## Unreleased

### Added
- Variables that look like credentials (password, token, API key) but aren't marked secret get a **Mark secret** badge, and Claude is warned when it stores one as plain text.
- Settings → Claude → **Must name the environment** (on by default): Claude's sends and environment writes have to name the environment, so switching the active one never redirects it.
- Claude can create environments, with variables, and clone one into a new environment (`create_environment`, `clone_environment`). Cloned secret values are left for you to fill in.

### Fixed
- Claude can no longer get a secret past the host lock: an edit that failed after saving, an OAuth 2.0 token request, or a script reading the secret and sending it somewhere else. Scripts run by Claude now see secrets as ••••••.
- Secrets are masked in history and in what Claude reads even when they were URL-encoded, form-encoded or escaped in JSON.
- Importing an exported globals file no longer empties your global secrets; the values you have are kept.
- The variable popup no longer calls a variable "not defined" when its value points at a missing one; it shows where it's defined and lets you edit the value, instead of offering an Add that overwrote it.
- ⌘-clicking a `{{variable}}` inside a URL in the body editor opens only the variable popup, not the link.
- GraphQL variables with a bare reference, like `{"id": {{userId}}}`, are sent as an object.
- `pm.sendRequest` parses GraphQL variables given as a string, and sets the Content-Type from `options.raw.language`.
- `setTimeout` in scripts waits its delay, and its callback can await, send requests and chain promises.
- Fetching a GraphQL schema no longer runs collection or folder post-response scripts.
- OpenAPI sync keeps a request on its path when only its operationId moved elsewhere, creates the new endpoint, and keeps path values typed into a moved URL.
- Pasting a GraphQL cURL command keeps variables given as a string, and a body with `extensions` stays JSON instead of losing them.
- Restoring an edit from change history no longer brings back examples or flow links you removed since.
- Activity's Load older no longer skips entries that happened in the same millisecond.
- Copy as cURL keeps `;` in form values and file paths; Copy as fetch keeps integers too big for JavaScript.
- Release notes keep `##` lines inside code blocks.

## 0.1.0

The first release of Postguy, a local-first API workspace.

### Requests and responses
- Send requests with params, headers, auth (bearer, basic, API key, OAuth 2.0 with PKCE sign-in) and JSON, text, form, URL-encoded or file bodies.
- Responses as Pretty, Raw or a fast, filterable Tree; cookies kept in a jar; history of everything you send.
- Save responses as named **examples** on a request, and fill the editor from them.
- **GraphQL** requests with a query editor, variables, completion and checks from the endpoint's schema, and GraphQL errors shown above the response.
- Edit `{{variables}}` in place: hover to change a value, ⌘-click to edit straight away.

### Remembering and reusing data
- Every JSON response of a saved request is remembered, so `{{Login.data.access_token}}` reads a value from another request, with autocomplete.
- Variables in globals, environments, collections, folders, flows and requests, with clear precedence.
- From the Tree view, save a value as a variable or add a test for it in one click.

### Automation
- **Flows** chain requests on a canvas, with mapped inputs, conditions, breakpoints, undo and run reports.
- Pre-request and post-response **scripts** in a sandbox, with Postman's `pm.*` API, including `pm.sendRequest`, so imported scripts keep working; `fetch` works in scripts too.
- **Claude (MCP)**: let Claude Code find, send, edit, organise and delete requests and folders. Off by default, with secrets masked and only sent to hosts you use yourself; anything Claude deletes can be brought back.

### Bringing work in and out
- Import Postman collections and environments, OpenAPI 2.0/3.0/3.1, HAR recordings and cURL commands. Pasted cURL uses your variables in place of matching values.
- Sync collections with new versions of an OpenAPI spec without losing your edits.
- Export collections, OpenAPI specs and Postman environments, and copy any request as cURL or JavaScript `fetch`; secrets are never included in exports.

### Safety
- **Activity**: one timeline of requests sent, changes and flow runs, saying who did each (you, Claude, a script…), with filters, diffs and undo.
- Change history for every collection: see what changed and who changed it, restore earlier versions and bring back deleted requests, folders and collections. Environment variables and switching environment are recorded too.
- Secret variables and credentials are masked everywhere.
- Signed in-app updates, with a backup of your data before an update changes it.

### Settings
- One **Settings** screen (⌘,) for theme, updates, default timeout, redirects and TLS checks for all requests, Claude (MCP), and where your data and backups are.
