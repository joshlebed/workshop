/**
 * Rank numbers and "Rank at top / bottom" anchors come from the whole Ranked
 * block, never from the filtered view (UX pass 0.8). With a tag or search
 * filter on, the old code numbered the visible rows 1..n and anchored
 * "Rank at bottom" on the last *visible* ranked row, so "Bake bread" showed
 * as #2 when it was #4 and "bottom" landed mid-list.
 */
export function rankByIdOf(ordered: readonly { id: string }[]): Map<string, number> {
  return new Map(ordered.map((item, index) => [item.id, index + 1]));
}

/** Neighbour ids for appending to / prepending to the full Ranked block. */
export function rankAnchorsOf(ordered: readonly { id: string }[]): {
  firstId: string | null;
  lastId: string | null;
} {
  return {
    firstId: ordered[0]?.id ?? null,
    lastId: ordered[ordered.length - 1]?.id ?? null,
  };
}
