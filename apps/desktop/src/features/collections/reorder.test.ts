import { describe, expect, it } from 'vitest';
import { orderPatches, reorderIds } from './reorder';

describe('reorderIds', () => {
  it('places an item before or after a target', () => {
    expect(reorderIds(['a', 'b', 'c', 'd'], 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
    expect(reorderIds(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderIds(['a', 'b'], 'a', 'a', 'after')).toEqual(['a', 'b']);
  });
  it('adds an item from another folder', () => {
    expect(reorderIds(['a', 'b'], 'x', 'b', 'before')).toEqual(['a', 'x', 'b']);
  });
});

describe('orderPatches', () => {
  it('writes only rows whose order changed, plus the moved row', () => {
    const current = [
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 1 },
      { id: 'c', sortOrder: 2 },
    ];
    expect(orderPatches(['a', 'c', 'b'], current)).toEqual([
      { id: 'c', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
    ]);
    expect(orderPatches(['x', 'a', 'b', 'c'], current, 'x')).toEqual([
      { id: 'x', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'c', sortOrder: 3 },
    ]);
  });
});
