import type { Item, ListItemsResponse } from "@workshop/shared";

/**
 * Pure client-side optimistic-update helpers for drag-to-reorder.
 *
 * The server now owns position allocation via `POST /v1/items/:id/move`
 * (sparse integers, eager rebalance — see §3.4 of the redesign doc). These
 * helpers exist only for client-side optimistic updates while the move
 * request is in flight; they compute a plausible interim position so the UI
 * doesn't snap. The next `fetchItems` invalidation replaces them with the
 * server-authored truth.
 */

export function positionOf(item: Item): number | null {
  return item.position ?? null;
}

export function midpointAt(orderedItems: Item[], index: number): number {
  const positions = orderedItems.map(positionOf).filter((p): p is number => typeof p === "number");
  if (positions.length === 0) return 1024;
  if (index <= 0) {
    const first = positions[0] ?? 1024;
    return Math.floor(first / 2);
  }
  if (index >= positions.length) {
    const last = positions[positions.length - 1] ?? 0;
    return last + 1024;
  }
  const before = positions[index - 1] ?? 0;
  const after = positions[index] ?? before + 2048;
  return Math.floor((before + after) / 2);
}

export function midpointForOrderedReorder(
  orderedItems: Item[],
  fromIndex: number,
  toIndex: number,
): number | null {
  if (fromIndex === toIndex) return null;
  if (fromIndex < 0 || fromIndex >= orderedItems.length) return null;
  if (toIndex < 0 || toIndex >= orderedItems.length) return null;

  const neighbors = neighborsForOrderedReorder(orderedItems, fromIndex, toIndex);
  if (!neighbors) return null;
  const before = neighbors.before ? positionOf(neighbors.before) : null;
  const after = neighbors.after ? positionOf(neighbors.after) : null;
  const next = midpointBetween(before, after);

  const moved = orderedItems[fromIndex];
  const current = moved ? positionOf(moved) : null;
  if (current !== null && current === next) return null;
  return next;
}

/**
 * Final neighbors of the dragged row after a drag-to-reorder within a single
 * ordered section. Both dnd-kit (`@dnd-kit/sortable`) on web and
 * `react-native-reorderable-list` on native emit `toIndex` as the post-move
 * destination — i.e. the index the dragged row occupies after the implicit
 * `arrayMove(from, to)`. Reading neighbors directly off the source array
 * is off-by-one in one direction depending on whether the user dragged up or
 * down, which is the bug this helper exists to avoid.
 *
 * Returns `null` for out-of-range / no-op inputs so callers can short-circuit.
 */
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
  const before = toIndex > 0 ? (post[toIndex - 1] ?? null) : null;
  const after = toIndex < post.length - 1 ? (post[toIndex + 1] ?? null) : null;
  return { before, after };
}

export function midpointBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1024;
  if (before === null && after !== null) return Math.floor(after / 2);
  if (after === null && before !== null) return before + 1024;
  return Math.floor(((before as number) + (after as number)) / 2);
}

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
    position: nextPosition,
  };
  if (typeof nextPosition === "number") {
    const ordered = [...otherOrdered, patched].sort(
      (a, b) => (positionOf(a) ?? 0) - (positionOf(b) ?? 0),
    );
    return {
      ordered,
      unordered: otherUnordered,
      completed: data.completed,
      suggested: data.suggested,
    };
  }
  return {
    ordered: otherOrdered,
    unordered: [...otherUnordered, patched],
    completed: data.completed,
    suggested: data.suggested,
  };
}

/**
 * Apply an optimistic neighbor-based move — given a drag from `fromIndex`
 * (in the source ordered/unordered/completed array) to a destination
 * relative to siblings `beforeItemId` / `afterItemId`. Used by client code
 * that talks to `POST /v1/items/:id/move`.
 */
export function applyOptimisticMove(
  data: ListItemsResponse,
  itemId: string,
  beforeItemId: string | null,
  afterItemId: string | null,
): ListItemsResponse {
  if (!beforeItemId && !afterItemId) {
    return applyPositionPatch(data, itemId, null);
  }
  const all = [...data.ordered, ...data.unordered];
  const findPos = (id: string | null) => {
    if (!id) return null;
    const item = all.find((i) => i.id === id);
    return item ? positionOf(item) : null;
  };
  const before = findPos(beforeItemId);
  const after = findPos(afterItemId);
  let lower: number | null = null;
  let upper: number | null = null;
  if (before !== null && after !== null) {
    lower = Math.min(before, after);
    upper = Math.max(before, after);
  } else if (before !== null) {
    lower = before;
    upper = null;
  } else if (after !== null) {
    upper = after;
    lower = null;
  }
  const next = midpointBetween(lower, upper);
  return applyPositionPatch(data, itemId, next);
}
