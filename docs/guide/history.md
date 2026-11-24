# History and undo

## Activity

**Activity** in the sidebar is one timeline of what happened, newest first and grouped by day:

- **Sent:** every request sent, with its status and time. Open one to see the request and response as they were, compare it, or open its request again.
- **Changes:** requests, folders and collections created, edited, moved or deleted, collection and environment variables changed, and switching environment. Open one to see a before/after diff and undo it: **Restore previous version**, **Move back**, **Bring back** or **Switch back**.
- **Flow runs:** each run with how many steps passed. Open one to go to the flow.

Every row says who did it: you, **Claude**, a **script** (`pm.sendRequest` or `fetch`), another program through the **API**, an OpenAPI **sync** or an **import**. Use the chips to show only some kinds, the menu to show one actor (for example *Claude*, to review what it did), and the box above to search. Several changes Claude made together, like a batch move, show as one row you can expand.

Secret values are masked everywhere in Activity. **Clear sent requests** removes the requests you sent; changes and flow runs stay.

## Change history

Each collection also keeps its own history of edits to its requests, folders, scripts, auth and collection variables, in its settings. For each change it records what changed, when, and who made it: you, Claude, another program through the API, OpenAPI sync, or an import.

- Right-click a collection and choose **Change history**, or **Show history** on a folder or request.
- Each entry shows a before/after diff. **Restore previous version** undoes it, and a restore can itself be undone.
- Deleted requests and folders come back with **Bring back**, with their scripts, variables, [examples](/guide/examples) and their place in flows.
- Deleted collections are listed under **Recently deleted** at the bottom of the Collections sidebar.

Quick successive edits merge into one entry. Reordering and values set by scripts are not recorded. Each collection keeps its latest 200 entries, for up to 90 days. Secret values are masked in the history view.

## Undo while editing

- Pasting a cURL command, filling the editor from an example, and similar actions show a message with **Undo**.
- On a flow canvas, <kbd>⌘Z</kbd> and <kbd>⌘⇧Z</kbd> undo and redo.
