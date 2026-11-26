# Claude (MCP)

Claude Code can use Postguy through the Model Context Protocol (MCP): find and send your requests, read variables, history and flow runs, run flows, and create or change requests. Claude reaches Postguy only while the app is open.

## Setting it up

1. Open **Settings → Claude (MCP)**: the robot icon in the top bar, <kbd>⌘,</kbd>, or <kbd>⌘K</kbd> → *Claude (MCP) settings*.
2. Turn it on and choose what Claude may do.
3. Run the command shown there once in a terminal. It looks like this:

   ```sh
   claude mcp add postguy -- node /path/to/postguy-mcp.mjs --data-dir /path/to/app-data
   ```

The command starts a small bridge that finds the running app through the `server.json` file in its data folder. Copy the exact command from the app, because the paths depend on your install.

## What Claude can do

MCP is off by default. Once it's on, Claude may only read until you also allow **Send requests**, **Edit** and **Delete**. Delete needs Edit too. Every tool call checks the switches as they are at that moment.

| Permission | Tools |
| --- | --- |
| Read | `list_requests`, `list_folders`, `get_request`, `list_environments`, `get_variables`, `list_history`, `get_history_entry`, `list_flows`, `get_flow`, `get_flow_run`, `decode_jwt` |
| Send requests | `send_request`, `run_flow` |
| Edit | `create_request`, `update_request`, `create_folder`, `rename_folder`, `move`, `import_curl`, `import_collection`, `set_variable`, `set_active_environment`, `restore_change` |
| Delete | `delete_request`, `delete_folder` (a folder or collection with up to 50 requests) |

Everything Claude sends, changes or runs is labelled **Claude** in [Activity](/guide/history#activity). Choose *Claude* there to review what it did, and undo any change from the same place. Batch actions, like moving 20 requests, show as one row you can expand.

`move` takes up to 50 requests and folders at once and moves all of them or none; items already in that place are left alone; `restore_change` takes a list of change ids to put a whole batch back. Moving a request into another collection can change the auth and variables it uses; `move` tells Claude when the auth type or the resolved host changes, or a `{{variable}}` is no longer defined, so it can tell you.

Claude can only delete what can be brought back: requests, folders and collections. Each deletion returns a change id that `restore_change` undoes, and you can bring it back yourself from Change history or **Recently deleted**. Environments, flows and history can't be deleted by Claude.

## Secrets stay hidden

- Secret values are masked in everything Claude reads, including response bodies that echo them back.
- `decode_jwt` returns a token's claims, never the token itself.
- Claude writes `{{name}}`, and Postguy fills in the value when sending.
- Scripts that run when Claude sends see secret values as `••••••`, so a script can't hand a secret on in another form. A script that signs requests with a secret only works when you send it yourself.

## Secrets only go where they already go

A request that would carry a secret is refused unless its host is one your saved requests already use. So a prompt injection hidden in a response can't make Claude send your token somewhere else. This covers requests a script sends and OAuth 2.0 token requests too. A host Claude adds, by saving a request or variable that points at it, stays untrusted until you send there yourself.

## Per environment

In the environment manager, each environment has two **Claude** switches:

- **Can use this environment**: turn it off to keep the environment away from Claude entirely.
- **May see secret values**: for throwaway local environments, where masking only gets in the way.
