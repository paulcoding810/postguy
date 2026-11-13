export type Place = 'before' | 'after';

/** Ids in their new order after moving `moving` next to `target`. */
export function reorderIds(ids: string[], moving: string, target: string, place: Place): string[] {
  if (moving === target) return ids;
  const rest = ids.filter((id) => id !== moving);
  const at = rest.indexOf(target);
  if (at < 0) return [...rest, moving];
  rest.splice(place === 'before' ? at : at + 1, 0, moving);
  return rest;
}

/** The sort orders to write so the folder matches `ordered`; unchanged rows are skipped. */
export function orderPatches(ordered: string[], current: { id: string; sortOrder: number }[], alwaysWrite?: string): { id: string; sortOrder: number }[] {
  const was = new Map(current.map((r) => [r.id, r.sortOrder]));
  return ordered.map((id, i) => ({ id, sortOrder: i })).filter((p) => p.id === alwaysWrite || was.get(p.id) !== p.sortOrder);
}
