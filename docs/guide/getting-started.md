# Getting started

Postguy is a desktop app for working with HTTP APIs. Everything stays on your machine: requests, responses, variables and history live in a local SQLite database, served by a small server the app starts and stops with itself.

## Install

Download the installer for your platform from the [releases page](https://github.com/paulcoding810/postguy/releases):

| Platform | File |
| --- | --- |
| macOS (Apple Silicon or Intel) | `.dmg` |
| Windows | `.msi` or `.exe` |
| Linux | `.deb`, `.rpm` or `.AppImage` |

To run it from source instead, see [Building from source](/reference/development).

## Your first request

1. Press <kbd>⌘T</kbd> (<kbd>Ctrl+T</kbd> on Windows and Linux) for a new request tab.
2. Type a URL, or paste a cURL command copied from your browser: the request fills in by itself.
3. Press <kbd>⌘↵</kbd> to send. The response appears below, as **Pretty**, **Raw** or **Tree**.
4. Press <kbd>⌘S</kbd> to save it into a collection.

Once a request is saved, Postguy remembers its JSON responses. Another request can then use a value from it, for example `{{Login.data.access_token}}` in an `Authorization` header. See [Response memory](/guide/memory).

## Bring what you already have

Open **New / Import** at the top of the Collections sidebar:

- **Import collection, environment or HAR file** takes Postman collections (v2.0 and v2.1), Postman environments, Postguy exports and HAR recordings.
- **Import OpenAPI / Swagger** takes a spec by file, URL or paste, versions 2.0, 3.0 and 3.1.
- **Import cURL** opens a command as a new request.

See [Import and export](/guide/import-export).

## Updates

Postguy checks for a new version at most once a day. When there is one, a message offers **Restart to update** and links to what's new. Nothing installs until you click.

- <kbd>⌘K</kbd> → *Check for updates…* checks right away; on macOS it's also in the Postguy menu.
- <kbd>⌘K</kbd> → *Turn off automatic update checks* stops the daily check. You can still check by hand.
- Before an update changes the database, a copy is kept next to it as `postguy.db.bak-before-…`.
- On Linux, only the AppImage updates itself; `.deb` and `.rpm` installs get a download link.

## Where your data lives

The installed app keeps its database, logs (`server.log`) and settings in your operating system's app-data folder. Nothing is synced or sent anywhere, apart from the requests you send and the [update check](#updates).

## Find your way around

- The left rail switches between **Collections**, **Flows**, **OpenAPI**, **Environments** and **History**.
- <kbd>⌘K</kbd> searches requests, flows and environments, and runs actions such as switching environment or theme.
- <kbd>⌘J</kbd> opens the **Smart Data** panel, which lists remembered responses whose values you can insert.

All shortcuts are on the [Keyboard shortcuts](/reference/shortcuts) page.
