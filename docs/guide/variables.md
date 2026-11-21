# Variables and environments

Write `{{name}}` anywhere in a request (URL, params, path variables, headers, auth or body) and Postguy fills it in when sending. Variables can contain other templates, so `accessToken = {{Login.data.access_token}}` keeps a token current by reading it from the latest login response.

## Where variables live

| Scope | Set in | Used by |
| --- | --- | --- |
| **Globals** | Environment manager | Every request |
| **Environment** | Environment manager, or the switcher in the top bar | Every request, while that environment is active |
| **Collection / folder** | A collection's or folder's settings | Requests inside it; inner folders override outer ones |
| **Flow** | The flow's **Variables** panel | Steps of that flow |
| **Request** | The variable popup, when adding a variable | That request only |
| **Runtime** | `flow.set(...)` in a script | The rest of the run |

### Precedence

When the same name is defined in several places, the first of these wins:

1. Runtime values set by scripts with `flow.set`
2. Request variables
3. Flow variables
4. Collection variables, innermost folder first
5. The active environment
6. Globals

Hovering over a variable shows which scope it came from, and which other definitions it hides.

## Environments

Open the manager with <kbd>⌘⇧E</kbd>, or from the environment switcher at the top right. Switch environments from the same menu, or with <kbd>⌘K</kbd> → *Use environment*.

- Each variable can be turned off without being deleted, and marked **secret**. Secret values are masked across the app. See [Secrets](/guide/secrets).
- Environments export to, and import from, Postman's environment format. Secret values are left blank in exported files.
- Two Claude switches per environment decide whether Claude can see that environment, and whether it may see its secret values. See [Claude (MCP)](/guide/claude#per-environment).

## Editing quickly

Hover over a `{{variable}}` in any field, the body or a script to edit its value in place, then press <kbd>Enter</kbd>. <kbd>⌘</kbd>-click a variable to edit it straight away. Saving updates the variable where it is defined.

## Pasting with variables

When you paste a cURL command, values that match one of your variables are swapped for the variable. This covers the start of the URL, header and query values, auth fields and JSON strings. So `https://api.shop.com/v2/users` becomes `{{baseUrl}}/users`, and the bearer token becomes `{{token}}`. **Keep raw values** in the message that follows puts the pasted values back.

## Response references

`{{Login.data.access_token}}` is not a variable: it reads from the remembered response of the request named `Login`. See [Response memory](/guide/memory).
