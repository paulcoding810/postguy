# Requests and responses

## Tabs

Each open request or flow has a tab. Opening a request from the sidebar uses a **preview tab**, shown in italics, which the next request you open replaces. Editing it, or double-clicking the tab, keeps it open.

Scroll the tab strip with the mouse wheel when it overflows. <kbd>⌃Tab</kbd> and <kbd>⌃⇧Tab</kbd> move between tabs, <kbd>⌘1</kbd> to <kbd>⌘8</kbd> jump to a tab, and <kbd>⌘9</kbd> to the last one. A dot on a tab means unsaved changes; closing it asks first.

Click the request name above the URL to rename it. The whole name is selected, so you can type straight over it.

## The URL bar

- Type `{{` for variable and response suggestions.
- Path variables such as `/users/:id` get a row under **Params → Path variables**.
- Query parameters typed into the URL appear under **Params**, and the other way round.
- Paste a cURL command to fill the whole request. See [cURL](/guide/import-export#curl).

## Editing a request

| Tab | What it holds |
| --- | --- |
| **Params** | Query parameters and path variables |
| **Headers** | Request headers; untick a row to keep it without sending it |
| **Auth** | Bearer, Basic, API key, OAuth 2.0, or inherit from the folder. See [Auth](/guide/auth) |
| **Body** | JSON, text, form-data, URL-encoded, a binary file, or a [GraphQL](/guide/graphql) query |
| **Pre-request** / **Post-response** | [Scripts](/guide/scripts) |
| **Docs** | The OpenAPI operation the request came from, and its [examples](/guide/examples) |
| **Settings** | Timeout, following redirects, TLS certificate checks, and whether to use the cookie jar. Unset values follow the defaults in **Settings → Requests** (<kbd>⌘,</kbd>); **Use default** puts a changed one back |

### Editing variables in place

Hover over a `{{variable}}` in any field, the body or a script to see its value and where it comes from. You can edit the value right there: press <kbd>Enter</kbd> to save. <kbd>⌘</kbd>-click a variable to edit it straight away. An undefined variable can be created the same way.

## Sending and saving

- <kbd>⌘↵</kbd> sends, <kbd>⌘S</kbd> saves, <kbd>⌘⇧S</kbd> saves a copy.
- **Copy as cURL** and **Copy as fetch** (in the menu next to Save) copy the request with variables and auth resolved, as a shell command or JavaScript, and warn when it contains a secret.

## The response

The status, time and size sit at the top right.

| Tab | Shows |
| --- | --- |
| **Body** | **Pretty** (formatted), **Raw**, or **Tree** for JSON. ⌘-click a link to open it in your browser |
| **Headers** | Response headers |
| **Cookies** | Cookies the response set. They are kept and sent with later requests to the same site. **Manage cookies** edits the jar |
| **Schema** | The JSON schema inferred from remembered responses, or the one the OpenAPI spec documents |
| **Tests** | Results of the request's assertions and script logs |
| **Request** | What was actually sent, with variables resolved |
| **Examples** | Responses you saved with the request |

### Tree view

The Tree view shows JSON as rows you can fold. Filter by key or value at the top, and expand or collapse everything at once. It stays fast on responses of several megabytes.

Hover over a row for its actions:

- **Save as variable** adds a line to the post-response script that stores the value, such as the `access_token` from a login, each time the request runs.
- **Test this value** adds an assertion for it.
- **Copy value** and **Copy reference** copy the value, or a `{{Login.data.user.id}}` reference to it.
- **Insert reference** puts that reference into the field you last clicked. Double-clicking the row does the same.

## History

Every request you send is in **History** in the sidebar, with its status and time. Requests sent by a flow, by Claude or through the API are labelled.
