# GraphQL

Choose **GraphQL** in a request's **Body** tab to write a query instead of JSON.

- The query has its own editor with GraphQL highlighting. **Variables** go in a JSON editor below it, and an **Operation name** picks which operation runs when the query defines several.
- `{{variables}}` and response references work in the query, the variables and the headers, as everywhere else.
- **Format** tidies the query and the variables; `{{variables}}` in the query are kept as written.
- Postguy sends `POST` with `{ "query", "variables", "operationName" }` as JSON, the way GraphQL servers expect.

Switching a JSON body of that shape to GraphQL splits it into the query and variables, and switching back joins them again.

## Completion from the schema

**Fetch schema** asks the endpoint for its schema with the standard introspection query. It is sent like the request itself: same URL, auth, headers and pre-request scripts. Then:

- the query editor completes fields and arguments, and underlines ones that don't exist;
- hovering over a field shows its type and description;
- **Schema** opens a panel listing every type and field, with a search box.

The schema is kept with the saved request, so it works offline. Use **Refresh schema** when the API changes. If the server has introspection turned off, Postguy says so.

## Errors

GraphQL servers usually answer `200 OK` even when a query fails, and put the problems in an `errors` array. Postguy shows those messages in a red bar above the response, with the path where each happened. Scripts and `pm.response` still see the body as it came.

## Importing and exporting

- Postman GraphQL requests import as GraphQL, with their variables.
- A pasted cURL command whose body is `{ "query": … }` becomes a GraphQL request.
- **Copy as cURL** and **Copy as fetch** send the JSON form.
- Remembered responses work as for any request, so `{{GetUser.data.user.id}}` reads from the last `GetUser` response.

Subscriptions, file uploads and batched queries aren't supported.
