import type {
  AlbumShelfItemMetadata,
  AlbumShelfItemsResponse,
  Item,
  ItemMetadata,
} from "@workshop/shared";

/**
 * Album-shelf "ordered" rows are sorted by `metadata.position` (a float,
 * docs/album-shelf.md §3.3.1). To insert at index `index` we pick a
 * midpoint between the neighbours; promoting to top or bottom carries off
 * one end (half of the existing first / last + 1). Empty list → 1 so we
 * always start with positive numbers.
 *
 * Pulled out of `AlbumShelfDetail.tsx` because it had two near-identical
 * implementations (`computeInsertPosition` + `midpointAt`) and neither was
 * tested. Pure function, easy to test.
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
  const meta = item.metadata as Partial<AlbumShelfItemMetadata>;
  return typeof meta.position === "number" ? meta.position : null;
}

/**
 * Optimistic-update helper. Given the current ordered/detected response and a
 * patch that sets a row's position to `nextPosition` (number → ordered, null →
 * detected), return the next response shape with the row moved into the right
 * section and re-sorted.
 */
export function applyPositionPatch(
  data: AlbumShelfItemsResponse,
  itemId: string,
  nextPosition: number | null,
): AlbumShelfItemsResponse {
  const all = [...data.ordered, ...data.detected];
  const target = all.find((i) => i.id === itemId);
  if (!target) return data;
  const otherOrdered = data.ordered.filter((i) => i.id !== itemId);
  const otherDetected = data.detected.filter((i) => i.id !== itemId);
  const patched: Item = {
    ...target,
    metadata: {
      ...(target.metadata as unknown as AlbumShelfItemMetadata),
      position: nextPosition,
    } as unknown as ItemMetadata,
  };
  if (typeof nextPosition === "number") {
    const ordered = [...otherOrdered, patched].sort(
      (a, b) => (positionOf(a) ?? 0) - (positionOf(b) ?? 0),
    );
    return { ordered, detected: otherDetected };
  }
  return { ordered: otherOrdered, detected: [...otherDetected, patched] };
}
