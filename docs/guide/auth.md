# Auth

Pick an auth type in a request's **Auth** tab, or set it on a collection or folder so the requests inside inherit it.

| Type | Sends |
| --- | --- |
| **Inherit** | The nearest folder's or collection's auth |
| **Bearer** | `Authorization: Bearer <token>` |
| **Basic** | `Authorization: Basic …` from a username and password |
| **API key** | A key and value, in a header or the query string |
| **OAuth 2.0** | A token Postguy fetches and refreshes |

Every field takes templates, so a bearer token is usually `{{accessToken}}` or `{{Login.data.access_token}}`. If a credential resolves to an empty value, Postguy sends without it and says which variable was empty. When a remembered response holds something that looks like the token, it offers that too.

## OAuth 2.0

For the **client credentials** and **password** grants, leave the access token empty. Postguy fetches a token from the token URL, reuses it until it expires, and masks it everywhere.

For the **authorization code** grant, choose **Sign in with OAuth 2.0**:

1. Postguy opens the provider's sign-in page in your browser, using PKCE.
2. The provider redirects to `http://127.0.0.1:<port>/oauth/callback`, the loopback address recommended for native apps.
3. Postguy exchanges the code, and refreshes the token with the refresh token when it expires.

The port is the local server's, which changes each time the installed app starts, so the provider must accept any loopback port. Tokens are held in memory, so you sign in again after restarting.
