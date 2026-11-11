import { describe, expect, it } from 'vitest';
import { formatSegs, refFor } from './refs';

describe('refs', () => {
  it('formats segments like the core resolver expects', () => {
    expect(formatSegs(['data', 'items', 0, 'id'])).toBe('data.items[0].id');
    expect(formatSegs([0, 'a b'])).toBe('[0]["a b"]');
  });
  it('builds references for plain and unusual names', () => {
    expect(refFor('Login', 'data.access_token')).toBe('Login.data.access_token');
    expect(refFor('List', '[0].id')).toBe('List[0].id');
    expect(refFor('Get Profile', 'data.name')).toBe('Get Profile.data.name');
    expect(refFor('v1.users', 'id')).toBe('$res["v1.users"].body.id');
  });
});
