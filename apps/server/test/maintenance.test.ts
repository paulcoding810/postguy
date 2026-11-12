import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@postguy/shared';
import { requestHistory } from '../src/db/schema.ts';
import { pruneHistory } from '../src/services/maintenance.ts';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('maintenance', () => {
  it('keeps only the newest history rows', () => {
    for (let i = 0; i < 30; i++)
      h.db.insert(requestHistory).values({ id: newId(), method: 'GET', url: `http://x/${i}`, request: { headers: {}, body: null }, timing: { totalMs: 1 }, createdAt: 1000 + i }).run();
    expect(pruneHistory(h.db, 10)).toBe(20);
    const left = h.db.select({ url: requestHistory.url }).from(requestHistory).all().map((r) => r.url);
    expect(left).toHaveLength(10);
    expect(left).toContain('http://x/29');
    expect(pruneHistory(h.db, 10)).toBe(0);
  });
});
