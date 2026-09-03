// Hand-off between a home row and the board it opens.
//
// expo-router screens are separate trees, so there is no real shared-element
// transition to hook into. What we can do is remember *where the row was* at
// the moment it was tapped and let the board's header start life at that
// position, then step up to its own. Combined with a cross-fade stack
// animation the board reads as the row unfolding rather than a card sliding in
// from the right.
//
// One entry, consumed on read: a stale rect (deep link, back-forward, cold
// start) must never drag the header off-screen, so the board falls back to a
// plain fade when there's nothing to take.

export interface RowRect {
  /** Row top in window coordinates at press time. */
  pageY: number;
  height: number;
}

let pending: { id: string; rect: RowRect } | null = null;

export function rememberRow(id: string, rect: RowRect): void {
  pending = { id, rect };
}

/** Reads and clears the hand-off for `id`. Null when it wasn't this row. */
export function takeRow(id: string): RowRect | null {
  if (!pending || pending.id !== id) return null;
  const { rect } = pending;
  pending = null;
  return rect;
}
