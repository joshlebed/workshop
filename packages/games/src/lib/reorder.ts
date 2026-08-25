/** Return the final neighbors after moving one item within an ordered array. */
export function neighborsForOrderedReorder<T>(
  orderedItems: T[],
  fromIndex: number,
  toIndex: number,
): { before: T | null; after: T | null } | null {
  if (fromIndex < 0 || fromIndex >= orderedItems.length) return null;
  if (toIndex < 0 || toIndex >= orderedItems.length) return null;
  if (fromIndex === toIndex) return null;
  const post = orderedItems.slice();
  const [moved] = post.splice(fromIndex, 1);
  if (!moved) return null;
  post.splice(toIndex, 0, moved);
  return {
    before: toIndex > 0 ? (post[toIndex - 1] ?? null) : null,
    after: toIndex < post.length - 1 ? (post[toIndex + 1] ?? null) : null,
  };
}
