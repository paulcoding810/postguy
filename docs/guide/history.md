# History and undo

## Request history

**History** in the sidebar lists every request sent, newest first, with its status, time and where it came from: you, a flow, Claude (**MCP**) or another program through the API. Open an entry to see the request and response as they were.

## Change history

Each collection keeps a history of edits to its requests, folders, scripts, auth and collection variables. For each change it records what changed, when, and who made it: you, Claude, another program through the API, OpenAPI sync, or an import.

- Right-click a collection and choose **Change history**, or **Show history** on a folder or request.
- Each entry shows a before/after diff. **Restore previous version** undoes it, and a restore can itself be undone.
- Deleted requests and folders come back with **Bring back**, with their scripts, variables, [examples](/guide/examples) and their place in flows.
- Deleted collections are listed under **Recently deleted** at the bottom of the Collections sidebar.

Quick successive edits merge into one entry. Reordering and values set by scripts are not recorded. Each collection keeps its latest 200 entries, for up to 90 days. Secret values are masked in the history view.

## Undo while editing

- Pasting a cURL command, filling the editor from an example, and similar actions show a message with **Undo**.
- On a flow canvas, <kbd>⌘Z</kbd> and <kbd>⌘⇧Z</kbd> undo and redo.
