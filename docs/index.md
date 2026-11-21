---
layout: home

hero:
  name: Postguy
  text: An API workspace that remembers
  tagline: Send requests, keep every JSON response, and reference earlier values with {{Login.data.token}} instead of copying them by hand. Local-first, on your machine.
  image:
    src: /icon.svg
    alt: Postguy
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Download
      link: https://github.com/paulcoding810/postguy/releases

features:
  - title: Response memory
    details: Every JSON response of a saved request is kept with its schema. Reference any value from another request, with autocomplete.
    link: /guide/memory
  - title: Flows
    details: Chain requests on a canvas. Inputs are mapped from earlier responses, with conditions, breakpoints and run reports.
    link: /guide/flows
  - title: Scripts
    details: Pre-request and post-response scripts in a sandbox, with Postman's pm.* API so imported collections keep working.
    link: /guide/scripts
  - title: OpenAPI in and out
    details: Import a spec, sync new versions without losing your edits, validate responses against it.
    link: /guide/openapi
  - title: Bring your work
    details: Postman collections and environments, HAR recordings and cURL commands import as they are.
    link: /guide/import-export
  - title: Claude, safely
    details: Let Claude Code find, send and edit requests over MCP, off by default, with secrets masked and locked to known hosts.
    link: /guide/claude
---
