import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearTokenCache } from '../src/services/oauth.ts';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  clearTokenCache();
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

const stats = async () => ((await (await fetch(`${h.mockUrl}/oauth/stats`)).json()) as { tokenRequests: number }).tokenRequests;

describe('OAuth 2.0', () => {
  it('fetches, caches and applies client credentials tokens', async () => {
    const auth = { type: 'oauth2', grantType: 'client_credentials', tokenUrl: `${h.mockUrl}/oauth/token`, clientId: 'postguy', clientSecret: '{{secret}}', scope: 'read' };
    const col = (await h.call('POST', '/collections', { name: 'C', auth })).body;
    await h.call('PUT', `/variables/collection/${col.id}`, { variables: [{ key: 'secret', value: 'shh', isSecret: true }] });
    const request = { name: 'Me', method: 'GET', url: `${h.mockUrl}/users/1001` };
    const before = await stats();
    const a = (await h.call('POST', '/send', { collectionId: col.id, request })).body;
    const b = (await h.call('POST', '/send', { collectionId: col.id, request })).body;
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.request.headers.Authorization).toBe('Bearer ••••••');
    expect((await stats()) - before).toBe(1);

    const t = (await h.call('POST', '/oauth/token', { auth: { type: 'inherit' }, collectionId: col.id })).body;
    expect(t).toMatchObject({ tokenType: 'Bearer', cached: true, scope: 'read' });
    expect(t.tokenPreview).toMatch(/^oat_..….{4}$/);
    const fresh = (await h.call('POST', '/oauth/token', { auth, collectionId: col.id, refresh: true })).body;
    expect(fresh.cached).toBe(false);
  });

  it('supports the password grant with client credentials in the body', async () => {
    const auth = { type: 'oauth2', grantType: 'password', tokenUrl: `${h.mockUrl}/oauth/token`, clientId: 'postguy', clientSecret: 'shh', clientAuth: 'body', username: 'admin', password: 'admin' };
    const res = (await h.call('POST', '/send', { request: { name: 'Other', method: 'GET', url: `${h.mockUrl}/users/1001`, auth } })).body;
    expect(res.status).toBe(200);
  });

  it('reports token failures without sending', async () => {
    const auth = { type: 'oauth2', grantType: 'client_credentials', tokenUrl: `${h.mockUrl}/oauth/token`, clientId: 'postguy', clientSecret: 'wrong' };
    const res = (await h.call('POST', '/send', { request: { name: 'x', method: 'GET', url: `${h.mockUrl}/users/1001`, auth } })).body;
    expect(res.error).toEqual({ code: 'OAUTH_ERROR', message: 'Token request failed: invalid_client' });
    expect(res.historyId).toBeNull();
  });
});

describe('OAuth 2.0 authorization code', () => {
  it('signs in through the browser redirect with PKCE, then sends and refreshes', async () => {
    const auth = {
      type: 'oauth2',
      grantType: 'authorization_code',
      authUrl: `${h.mockUrl}/oauth/authorize`,
      tokenUrl: `${h.mockUrl}/oauth/token`,
      clientId: 'postguy-public',
      clientSecret: '',
      scope: 'profile',
    };
    const request = { name: 'Me', method: 'GET', url: `${h.mockUrl}/users/1001`, auth };
    const before = (await h.call('POST', '/send', { request })).body;
    expect(before.error.code).toBe('OAUTH_SIGN_IN_REQUIRED');

    const start = (await h.call('POST', '/oauth/authorize', { auth })).body;
    const url = new URL(start.authorizationUrl);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(start.redirectUri);
    expect(start.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    expect((await h.call('GET', `/oauth/authorize/${start.state}`)).body.status).toBe('pending');

    const provider = await fetch(start.authorizationUrl, { redirect: 'manual' });
    const back = new URL(provider.headers.get('location')!);
    expect(back.searchParams.get('state')).toBe(start.state);
    const cb = await h.app.inject({ url: `/oauth/callback${back.search}` });
    expect(cb.statusCode).toBe(200);
    expect(cb.body).toContain('Signed in');

    const status = (await h.call('GET', `/oauth/authorize/${start.state}`)).body;
    expect(status).toMatchObject({ status: 'done', error: null, token: { tokenType: 'Bearer', scope: 'profile' } });
    expect((await h.call('POST', '/send', { request })).body.status).toBe(200);

    const replay = await h.app.inject({ url: `/oauth/callback${back.search}` });
    expect(replay.statusCode).toBe(400);

    const refreshed = (await h.call('POST', '/oauth/token', { auth, refresh: true })).body;
    expect(refreshed.cached).toBe(false);
    expect((await h.call('POST', '/send', { request })).body.status).toBe(200);
  });

  it('rejects unknown state and reports provider errors', async () => {
    expect((await h.app.inject({ url: '/oauth/callback?state=nope&code=x' })).statusCode).toBe(400);
    const auth = { type: 'oauth2', grantType: 'authorization_code', authUrl: `${h.mockUrl}/oauth/authorize`, tokenUrl: `${h.mockUrl}/oauth/token`, clientId: 'postguy', clientSecret: 'shh' };
    const start = (await h.call('POST', '/oauth/authorize', { auth })).body;
    const denied = await h.app.inject({ url: `/oauth/callback?state=${start.state}&error=access_denied&error_description=User%20said%20no` });
    expect(denied.body).toContain('access_denied: User said no');
    expect((await h.call('GET', `/oauth/authorize/${start.state}`)).body).toMatchObject({ status: 'error', error: 'access_denied: User said no' });
  });
});
