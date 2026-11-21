# OpenAPI sync

A collection imported from an OpenAPI spec stays linked to it. When the API changes, sync the new version instead of re-importing.

1. Open the spec under **OpenAPI** in the sidebar and choose **Sync & versions**.
2. Load the new version by file, URL or paste. Postguy compares it with the current one operation by operation, and shows what will happen to each of your requests.
3. Apply. Postguy then:
   - creates requests for new operations;
   - regenerates the requests you have not edited;
   - keeps the ones you have edited as they are;
   - leaves requests of removed operations in place, so nothing you rely on disappears.

Every stored version is kept, and any two can be compared.

## In the request

A request generated from a spec shows its operation in the **Docs** tab: summary, parameters, body schema and documented responses. If the spec now requires parameters the request lacks, Docs offers to add them.

Responses are validated against the documented schema. The result shows next to the status, and any differences are listed in the **Schema** tab.
