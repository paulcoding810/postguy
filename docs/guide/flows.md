# Flows

A flow chains saved requests on a canvas, passing values from one response to the next request. Open **Flows** in the sidebar.

## Building a flow

- **Add step** lists your saved requests. Tick several to add them as a chain, in the order you ticked them.
- Right-click a collection or folder and choose **Create flow from folder** to start from all its requests.
- New steps connect to the previous one. Postguy maps their inputs from earlier responses: a `:id` from `Login.data.user.id`, a bearer token from `Login.data.access_token`. After a first run, **Auto-map inputs** maps values that only exist then.
- Drag between handles to connect steps. Select a connection and press <kbd>Delete</kbd>, or use its **×**, to remove it.
- <kbd>⌘Z</kbd> and <kbd>⌘⇧Z</kbd> undo and redo changes on the canvas.
- **Duplicate** in the flow list copies a flow with all its steps.
- **Variables** in the toolbar holds flow variables, available to every step.

## How steps read values

Step names are reference names. In a flow, `{{Login.data.access_token}}` reads the **Login** step's response from the current run only, never an older one. A step with a reference that can't be resolved fails instead of sending.

## Branching

- **Condition** steps branch on expressions, for example `{{$res.Login.status}} == 200 && {{Login.data.user.role}} != 'admin'`.
- A request step's red output runs when the step fails. Without it, **Stop on error** decides whether the flow carries on.

## Running and debugging

- The execution log streams each step's status, timing and logs. Any step can be rerun with the responses of that run.
- **Debug** pauses before every step, and breakpoints pause before the steps you choose. While paused you can edit the next step's inputs, then **Step** or **Continue**.
- **Report** exports a run as Markdown, HTML or JSON, with credentials masked.

## Scripts in flows

Each step can have its own pre-request and post-response scripts. They run after the request's own, and `flow.set` values reach every later step. See [Scripts](/guide/scripts).
