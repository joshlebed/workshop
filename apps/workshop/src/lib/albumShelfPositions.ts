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
