import type { Item } from "@workshop/shared";

/**
 * Native list-detail drag promotes/demotes across the Ranked ↔ unranked
 * boundary by rendering both sections in ONE `react-native-reorderable-list`
 * (the library can't drag an item between two separate lists). The list's
 * `data` is `[...ordered, ...unordered]`; this helper turns the library's
 * `{ from, to }` reorder event into the neighbor-relative move the server
 * understands (`POST /v1/items/:id/move` — `beforeItemId`/`afterItemId` set →
 * ranked between those rows; both `null` → unranked).
 *
 * The ranked block is always the contiguous top `orderedCount` rows, so a
 * dropped row lands in the ranked block when it sits at the very top with
 * ranked rows present (`to === 0`) or directly beneath another ranked row.
 * Everything else lands unranked.
 *
 * For a move that stays entirely within the ranked block this returns the
 * exact same `before`/`after` ids as `neighborsForOrderedReorder`, so the
 * existing ranked-reorder behaviour is unchanged.
 */
export interface CombinedMove {
  item: Item;
  beforeItemId: string | null;
  afterItemId: string | null;
}

export function resolveCombinedReorder(
  combined: Item[],
  orderedCount: number,
  from: number,
  to: number,
): CombinedMove | null {
  if (from === to) return null;
  if (from < 0 || from >= combined.length) return null;
  if (to < 0 || to >= combined.length) return null;

  // Reproduce the library's implicit arrayMove(from, to) so `to` is the index
  // the dragged row occupies afterwards (the library's documented convention,
  // shared with dnd-kit — see neighborsForOrderedReorder).
  const post = combined.slice();
  const [moved] = post.splice(from, 1);
  if (!moved) return null;
  post.splice(to, 0, moved);

  // Ids of the rows that were ranked before the drag, excluding the dragged one
  // (the ranked block is the contiguous top `orderedCount` rows).
  const orderedOthers = new Set<string>();
  for (let i = 0; i < orderedCount && i < combined.length; i++) {
    const it = combined[i];
    if (it && it.id !== moved.id) orderedOthers.add(it.id);
  }

  const above = to > 0 ? (post[to - 1] ?? null) : null;
  const below = to < post.length - 1 ? (post[to + 1] ?? null) : null;

  const landsOrdered =
    orderedOthers.size > 0 && (to === 0 || (!!above && orderedOthers.has(above.id)));

  if (landsOrdered) {
    // Ranked between its neighbours; an `after` that isn't itself ranked (the
    // first unranked row) collapses to null so the row appends to the block.
    const beforeItemId = above ? above.id : null;
    const afterItemId = below && orderedOthers.has(below.id) ? below.id : null;
    return { item: moved, beforeItemId, afterItemId };
  }

  // Lands in the unranked region.
  if (from < orderedCount) {
    // Demote: clearing both neighbours sets position = null (unranked).
    return { item: moved, beforeItemId: null, afterItemId: null };
  }

  // Unranked → unranked: the unranked bucket has no persisted order, so there's
  // nothing to send. Returning null avoids a no-op move whose optimistic update
  // would jump the row to the end of the bucket.
  return null;
}
