import type { Item, ItemMetadata, ListItemsResponse } from "@workshop/shared";

/**
 * Ordered rows are sorted by `metadata.position` (a float; see
 * docs/album-shelf.md §3.3.1 for the original album-shelf spec — the same
 * scheme is reused for every list type since the 2026-05 ordering refactor).
 * To insert at index `index` we pick a midpoint between the neighbours;
 * promoting to top or bottom carries off one end (half of the existing
 * first / last + 1). Empty list → 1 so we always start with positive
 * numbers.
 *
 * Pure function — kept here for unit tests.
 */
export function midpointAt(orderedItems: Item[], index: number): number {
  const positions = orderedItems
    .map((it) => positionOf(it))
    .filter((p): p is number => typeof p === "number");
  if (positions.length === 0) return 1;
  if (index <= 0) {
    const first = positions[0] ?? 1;
    return first / 2;
  }
  if (index >= positions.length) {
    const last = positions[positions.length - 1] ?? 0;
    return last + 1;
  }
  const before = positions[index - 1] ?? 0;
  const after = positions[index] ?? before + 2;
  return (before + after) / 2;
}

export function positionOf(item: Item): number | null {
  const meta = item.metadata as { position?: number | null };
  return typeof meta.position === "number" ? meta.position : null;
}

/**
 * Within-section reorder: given the current ordered array and a drag from
 * `fromIndex` to `toIndex` (post-removal-splice convention used by both
 * dnd-kit and react-native-reorderable-list), return the new `position`
 * value for the dragged item, or `null` if no mutation is needed.
 *
 * Cross-section moves (promote / demote) are handled separately via the
 * kebab menu so this helper never has to reason about which section the
 * row belongs to.
 */
export function midpointForOrderedReorder(
  orderedItems: Item[],
  fromIndex: number,
  toIndex: number,
): number | null {
  if (fromIndex === toIndex) return null;
  if (fromIndex < 0 || fromIndex >= orderedItems.length) return null;
  if (toIndex < 0 || toIndex >= orderedItems.length) return null;

  const post = orderedItems.slice();
  const [moved] = post.splice(fromIndex, 1);
  if (!moved) return null;
  post.splice(toIndex, 0, moved);

  const beforeItem = toIndex > 0 ? post[toIndex - 1] : null;
  const afterItem = toIndex < post.length - 1 ? post[toIndex + 1] : null;
  const before = beforeItem ? positionOf(beforeItem) : null;
  const after = afterItem ? positionOf(afterItem) : null;
  const next = midpointBetween(before, after);

  const current = positionOf(moved);
  if (current !== null && Math.abs(current - next) < 1e-9) return null;
  return next;
}

/**
 * Midpoint between two ordered-row positions:
 * - both null → 1   (empty ordered list)
 * - before null → after / 2  (insert at top)
 * - after null  → before + 1  (insert at bottom)
 * - both        → (before + after) / 2
 */
export function midpointBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null && after !== null) return after / 2;
  if (after === null && before !== null) return before + 1;
  return ((before as number) + (after as number)) / 2;
}

/**
 * Optimistic-update helper. Given the current ordered/unordered/completed
 * response and a patch that sets a row's position to `nextPosition` (number
 * → ordered, null → unordered), return the next response with the row
 * moved into the right section and re-sorted. Completed items are not
 * affected by position drag — they live in their own bucket.
 */
export function applyPositionPatch(
  data: ListItemsResponse,
  itemId: string,
  nextPosition: number | null,
): ListItemsResponse {
  const all = [...data.ordered, ...data.unordered];
  const target = all.find((i) => i.id === itemId);
  if (!target) return data;
  const otherOrdered = data.ordered.filter((i) => i.id !== itemId);
  const otherUnordered = data.unordered.filter((i) => i.id !== itemId);
  const patched: Item = {
    ...target,
    metadata: {
      ...(target.metadata as ItemMetadata),
      position: nextPosition,
    } as ItemMetadata,
  };
  if (typeof nextPosition === "number") {
    const ordered = [...otherOrdered, patched].sort(
      (a, b) => (positionOf(a) ?? 0) - (positionOf(b) ?? 0),
    );
    return { ordered, unordered: otherUnordered, completed: data.completed };
  }
  return {
    ordered: otherOrdered,
    unordered: [...otherUnordered, patched],
    completed: data.completed,
  };
}
