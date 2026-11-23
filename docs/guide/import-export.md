# Import and export

## Importing

Use **New / Import** at the top of the Collections sidebar, or <kbd>⌘K</kbd>.

### Postman

**Import collection, environment or HAR file** reads Postman collections (v2.0 and v2.1) and Postman environments, and tells them apart by themselves.

- Folders, requests, auth, variables and scripts come across. Scripts keep working through the [`pm.*` compatibility layer](/guide/scripts#postman-scripts).
- Anything that can't be carried over is listed in one message after the import, for example `postman.setNextRequest`, which flows replace. The same message lists the hosts that scripts send to with `pm.sendRequest`.
- Saved Postman examples are not imported yet.

### HAR recordings

A `.har` file saved from your browser's network panel, or from a proxy that exports HAR, becomes a collection with one request per entry. The recorded JSON responses are kept as [remembered responses](/guide/memory), so references work before you send anything.

### OpenAPI

**Import OpenAPI / Swagger** takes a spec as a file, a URL or pasted text, in versions 2.0, 3.0 and 3.1. It creates a collection with a request per operation, keeps the spec for [syncing](/guide/openapi), and checks responses against it.

### cURL

- Paste a cURL command into the URL bar and the request fills in, with **Undo**.
- **Import cURL…** opens one in a new tab.
- Bash, zsh, Windows cmd and PowerShell forms from browsers' "Copy as cURL" all work.
- Values that match your variables are swapped for them, such as `{{baseUrl}}` and `{{token}}`. **Keep raw values** undoes that. See [Variables](/guide/variables#pasting-with-variables).

## Exporting

Right-click a collection:

- **Export collection** saves a Postguy file with its folders, requests, scripts and variables, and the flows that use it. Import it on another machine the same way.
- **Export as OpenAPI (YAML / JSON)** writes a spec from the collection's requests.

For one request, **Copy as cURL** (next to Save) copies it with variables and auth resolved.

From the environment manager, an environment exports as a Postman environment file.

Exports never contain secret values: secret variables are left blank. See [Secrets](/guide/secrets).
