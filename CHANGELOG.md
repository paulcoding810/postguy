# Changelog

What changed in each Postguy release, newest first. Add to **Unreleased** as you go; before tagging, rename it to the new version (see [Releasing](docs/reference/releasing.md)). The section for a version becomes its GitHub release notes and the notes in the in-app update message.

## Unreleased

## 0.1.0

The first release of Postguy, a local-first API workspace.

### Requests and responses
- Send requests with params, headers, auth (bearer, basic, API key, OAuth 2.0 with PKCE sign-in) and JSON, text, form, URL-encoded or file bodies.
- Responses as Pretty, Raw or a fast, filterable Tree; cookies kept in a jar; history of everything you send.
- Save responses as named **examples** on a request, and fill the editor from them.
- Edit `{{variables}}` in place: hover to change a value, ⌘-click to edit straight away.

### Remembering and reusing data
- Every JSON response of a saved request is remembered, so `{{Login.data.access_token}}` reads a value from another request, with autocomplete.
- Variables in globals, environments, collections, folders, flows and requests, with clear precedence.
- From the Tree view, save a value as a variable or add a test for it in one click.

### Automation
- **Flows** chain requests on a canvas, with mapped inputs, conditions, breakpoints, undo and run reports.
- Pre-request and post-response **scripts** in a sandbox, with Postman's `pm.*` API so imported scripts keep working.
- **Claude (MCP)**: let Claude Code find, send, edit, organise and delete requests and folders. Off by default, with secrets masked and only sent to hosts you use yourself; anything Claude deletes can be brought back.

### Bringing work in and out
- Import Postman collections and environments, OpenAPI 2.0/3.0/3.1, HAR recordings and cURL commands. Pasted cURL uses your variables in place of matching values.
- Sync collections with new versions of an OpenAPI spec without losing your edits.
- Export collections, OpenAPI specs, Postman environments and cURL; secrets are never included.

### Safety
- Change history for every collection: see what changed and who changed it, restore earlier versions and bring back deleted requests, folders and collections.
- Secret variables and credentials are masked everywhere.
- Signed in-app updates, with a backup of your data before an update changes it.

### Settings
- One **Settings** screen (⌘,) for theme, updates, default timeout, redirects and TLS checks for all requests, Claude (MCP), and where your data and backups are.
