// Pure logic for the album-shelf drag-to-reorder UX. Kept separate from the
// React component so we can unit-test the cross-section drop math without
// dragging into reanimated/gesture-handler runtime concerns.
//
// Layout model: the screen renders a flat list of "entries" in this order:
//
//   0..A-1   ordered rows               (orderedCount rows)
//   A        detected section header    (always present when detected has rows)
//   A+1..N-1 detected rows
//
// A drag's "drop slot" is the gap between two entries (or before the first /
// after the last). For an N-entry list there are N+1 slots: slot k means
// "between entry k-1 and entry k". The drop slot determines:
//
//   - which section the dragged item belongs to after release, and
//   - what `position` value to send when the new section is "ordered".
//
// The detected section is unordered (sorted server-side by detectedAt) so
// dropping anywhere within it just sets position=null.

export interface OrderedItem {
  id: string;
  /** `position` from `metadata.position`. Only ordered rows carry this. */
  position: number;
}

export interface DropContext {
  /** All ordered items, sorted by position ASC, before the drag. */
  ordered: OrderedItem[];
  /** Number of detected items (their order doesn't matter for math). */
  detectedCount: number;
  /** The id of the row being dragged. May be in `ordered` or in detected. */
  draggedId: string;
  /**
   * The slot index the user dropped on, in the *display* coordinate space.
   * Slot k means "between entry k-1 and entry k" of the visible flat list
   * (ordered rows + detected header + detected rows).
   *
   * Display indices:
   *   0..ordered.length-1                 → ordered rows
   *   ordered.length                      → detected header
   *   ordered.length+1..N-1               → detected rows
   *
   * So drop slots:
   *   0                                   → top of ordered (or top of detected if no ordered)
   *   1..ordered.length                   → between two ordered rows / after last ordered
   *   ordered.length                      → "right above the detected header"
   *   ordered.length+1                    → between detected header and first detected row
   *   ordered.length+2..N                 → inside detected
   *   N                                   → after last detected row
   */
  dropSlot: number;
}

export type DropResult =
  | { kind: "ordered"; nextPosition: number }
  | { kind: "detected"; nextPosition: null }
  | { kind: "noop" };

/**
 * Resolve a drop slot to a `{position}` patch. Returns `noop` if the drop
 * lands the item exactly where it already is (no PATCH needed).
 *
 * Promote / demote semantics:
 *  - Source detected, target slot inside ordered band → promote with midpoint.
 *  - Source ordered, target slot inside detected band → demote (position=null).
 *  - Same-section drop → reorder (ordered: midpoint; detected: noop).
 */
export function resolveDrop({
  ordered,
  detectedCount,
  draggedId,
  dropSlot,
}: DropContext): DropResult {
  const orderedWithoutDragged = ordered.filter((o) => o.id !== draggedId);
  const draggedInOrdered = ordered.some((o) => o.id === draggedId);

  // The "ordered band" of slot indices is [0, ordered.length] in pre-drag
  // coordinates. Slot ordered.length is "right at the divider"; we treat
  // it as the bottom of ordered (consistent with "Move to bottom" semantics).
  const orderedBand = ordered.length; // slots 0..orderedBand are ordered
  const detectedHeaderSlot = orderedBand; // slot index of header
  // After the header (slot orderedBand) detected rows occupy slots
  // orderedBand+1 .. orderedBand+1+detectedCount.

  const totalEntries = ordered.length + (detectedCount > 0 ? 1 + detectedCount : 0);
  const clampedSlot = Math.max(0, Math.min(dropSlot, totalEntries));

  // Drops between ordered rows or above ordered: ordered section.
  if (clampedSlot < orderedBand || (clampedSlot === orderedBand && detectedCount === 0)) {
    // The drop slot is the gap before the row currently at `clampedSlot`
    // (in the post-removal view of orderedWithoutDragged). Adjust because
    // removing the dragged row shifts everything below it up by one if the
    // dragged row was in ordered and above the drop slot.
    let targetIndex = clampedSlot;
    if (draggedInOrdered) {
      const draggedOrderedIdx = ordered.findIndex((o) => o.id === draggedId);
      if (draggedOrderedIdx >= 0 && draggedOrderedIdx < clampedSlot) {
        // The dragged row was above the slot; removing it shifts the slot up.
        targetIndex = clampedSlot - 1;
      }
    }
    targetIndex = Math.max(0, Math.min(targetIndex, orderedWithoutDragged.length));
    const nextPosition = computeMidpointAt(orderedWithoutDragged, targetIndex);

    if (draggedInOrdered) {
      // Same-section reorder. No-op if the position would land where we
      // already are (within sub-tolerance of current).
      const currentPos = ordered.find((o) => o.id === draggedId)?.position;
      if (typeof currentPos === "number" && Math.abs(nextPosition - currentPos) < 1e-9) {
        return { kind: "noop" };
      }
    }
    return { kind: "ordered", nextPosition };
  }

  // Anything at or below the detected header slot lands in detected.
  // No-op if the dragged row is already detected (its slot in detected
  // doesn't matter — position stays null and the server keeps the original
  // detectedAt for FIFO sort).
  if (!draggedInOrdered && clampedSlot >= detectedHeaderSlot) {
    return { kind: "noop" };
  }
  return { kind: "detected", nextPosition: null };
}

/**
 * Compute a fresh `position` value for inserting a row at `targetIndex` in
 * a 0-indexed list of already-sorted ordered items (without the dragged row).
 *
 * Per spec §3.3.1:
 *  - top (targetIndex 0): firstPosition / 2 (e.g. 0.5 if first is 1).
 *  - bottom (targetIndex length): lastPosition + 1.
 *  - middle: midpoint between adjacent positions.
 *  - empty list: 1.
 */
export function computeMidpointAt(items: OrderedItem[], targetIndex: number): number {
  if (items.length === 0) return 1;
  if (targetIndex <= 0) {
    const first = items[0]?.position ?? 1;
    return first / 2;
  }
  if (targetIndex >= items.length) {
    const last = items[items.length - 1]?.position ?? 0;
    return last + 1;
  }
  const before = items[targetIndex - 1]?.position ?? 0;
  const after = items[targetIndex]?.position ?? before + 2;
  return (before + after) / 2;
}
