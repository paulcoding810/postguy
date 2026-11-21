# Examples

An example is a response you choose to keep with a request, such as "200 OK" or "422 invalid email". Remembered responses come and go; examples stay until you delete them.

## Saving one

Send the request, then click **Save as example** in the response body bar and give it a name. Postguy stores:

- the status, headers and body (JSON, text or images);
- the request as you wrote it, with `{{variables}}` unresolved.

Secret values found in the response are replaced by their variable, so an example never keeps a live token. A `"token": "eyJ…"` whose value is your `token` secret is stored as `"token": "{{token}}"`.

The request has to be saved first. Responses that were cut short because they were too large can't be kept.

## Viewing and using them

The **Examples** tab of the response panel lists a request's examples, even before you send it. Open one to see its body (Pretty, Raw or Tree), headers and request.

- **Use its request** fills the editor with the method, URL, params, headers and body the example was sent with, with Undo.
- Rename an example with the pencil button or by double-clicking it. Delete it with the bin.

The request's **Docs** tab lists its examples too, and clicking one opens it.

Examples are copied when you duplicate a request, removed when you delete it, and come back with it if you restore it from [history](/guide/history).
