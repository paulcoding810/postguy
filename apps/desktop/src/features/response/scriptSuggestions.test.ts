import { describe, expect, it } from 'vitest';
import { jsAccess, responseSnippets, saveLine, suggestName, testLine } from './scriptSuggestions';

describe('script suggestions', () => {
  it('reads any path as valid JavaScript', () => {
    expect(jsAccess(['data', 'access_token'])).toBe('response.body.data.access_token');
    expect(jsAccess(['items', 0, 'user-id'])).toBe('response.body.items[0]["user-id"]');
    expect(jsAccess([])).toBe('response.body');
  });

  it('names variables after the key, borrowing the parent for generic ones', () => {
    expect(suggestName(['data', 'access_token'])).toBe('accessToken');
    expect(suggestName(['data', 'user', 'id'])).toBe('userId');
    expect(suggestName(['data', 'id'])).toBe('id');
    expect(suggestName([0])).toBe('value');
  });

  it('saves to the collection or the environment', () => {
    expect(saveLine(['token'], 'token', 'collection')).toBe('pm.collectionVariables.set("token", response.body.token);\n');
    expect(saveLine(['token'], 'token', 'environment')).toBe('env.set("token", response.body.token);\n');
  });

  it('tests stable values for equality and changing ones for presence', () => {
    expect(testLine(['data', 'role'], 'admin')).toBe(`flow.assert(response.body.data.role === "admin", "data.role is admin");\n`);
    expect(testLine(['total'], 3)).toBe(`flow.assert(response.body.total === 3, "total is 3");\n`);
    expect(testLine(['data', 'id'], 42)).toBe(`flow.assert(response.body.data.id != null, "has data.id");\n`);
    expect(testLine(['createdAt'], '2026-01-01T00:00:00Z')).toBe(`flow.assert(response.body.createdAt != null, "has createdAt");\n`);
    expect(testLine(['ref'], 'a3f9c2d4-1b2c-4d5e-8f90-123456789abc')).toBe(`flow.assert(response.body.ref != null, "has ref");\n`);
    expect(testLine(['items'], [])).toBe(`flow.assert(Array.isArray(response.body.items), "items is a list");\n`);
    expect(testLine(['next'], null)).toBe(`flow.assert(response.body.next === null, "next is null");\n`);
  });

  it('suggests snippets from the real response', () => {
    const s = responseSnippets(
      { status: 201, contentType: 'application/json', body: { data: { access_token: 'abc', refresh_token: 'def', user: { id: 1 } }, ok: true } },
      'collection',
    );
    expect(s.map((x) => x.label)).toEqual([
      'Status is 201',
      'Returns JSON',
      'Save data.access_token as {{accessToken}}',
      'Save data.refresh_token as {{refreshToken}}',
      'Check data.access_token, data.refresh_token, data.user exist',
    ]);
    expect(s[0]!.code).toBe("flow.assert(response.status === 201, 'status is 201');\n");
    expect(s[2]!.code).toBe('pm.collectionVariables.set("accessToken", response.body.data.access_token);\n');
  });
});
