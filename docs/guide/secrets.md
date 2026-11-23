# Secrets

Mark a variable **secret** in the environment manager or a collection's variables. Postguy then treats its value carefully everywhere:

- **Masked on screen**: in history, previews, the variable popup, script logs and run reports.
- **Left out of files**: collection exports, OpenAPI exports and Postman environment exports leave secret values blank.
- **Kept out of examples**: when you [save a response as an example](/guide/examples), secret values in it are replaced by `{{name}}`.
- **Swapped back in when pasting**: a pasted cURL command that contains a secret's value gets `{{name}}` instead. See [Variables](/guide/variables#pasting-with-variables).
- **Hidden from Claude**: Claude sees masked values and can only send a secret to hosts your saved requests already use. See [Claude (MCP)](/guide/claude#secrets-stay-hidden).

Auth credentials (bearer tokens, passwords, API keys and OAuth tokens) are masked the same way, whether or not they come from a secret variable.

**Copy as cURL** resolves everything so the command runs outside Postguy. It warns you when the result contains a secret.

## What leaves your machine

Only the requests you send (including any a script sends with `pm.sendRequest`), and the daily update check: a single request to GitHub for the latest release, which you can turn off in **Settings → General**.

## The local server

The app talks to its own server on `127.0.0.1`, which accepts only requests carrying a token generated for that session. Other programs on your machine can't use it unless you give them the token. Claude reaches it through the MCP bridge, with the limits above.
