// Translate a library-level reorder event ({from, to} in array-splice
// semantics) into the shelf's domain mutation: stay in current section,
// promote to ordered with a new `position`, or demote to detected.
//
// Both `react-native-reorderable-list` (native) and `@dnd-kit/sortable` (web)
// report `to` in post-removal coordinates: applying it is equivalent to
// `arr.splice(to, 0, arr.splice(from, 1)[0])`. So this helper accepts the
// pre-drag entry list + (from, to) and decides what mutation to send to the
// backend, regardless of which library produced the event.

import type { AlbumShelfItemMetadata, Item } from "@workshop/shared";
import { isRowEntry, type ShelfEntry } from "./types";

export type DropResult =
  | { kind: "ordered"; nextPosition: number }
  | { kind: "detected"; nextPosition: null }
  | { kind: "noop" };

export interface ReorderEvent {
  /** The entries the list rendered before the drag started. */
  entries: ShelfEntry[];
  /** Index of the dragged row in `entries`. */
  from: number;
  /**
   * Where the dragged row was released, in post-removal-splice coords (the
   * convention used by both libraries we drive). I.e. applying the move is
   * `splice(to, 0, splice(from, 1))`.
   */
  to: number;
}

/**
 * Decide what mutation to send when a drag finishes. Returns `noop` when no
 * PATCH is needed (released in place, or detected→detected which has no
 * meaningful order).
 */
export function resolveReorder({ entries, from, to }: ReorderEvent): DropResult {
  if (from === to) return { kind: "noop" };
  if (from < 0 || from >= entries.length) return { kind: "noop" };
  const dragged = entries[from];
  if (!dragged || !isRowEntry(dragged)) return { kind: "noop" };

  const wasOrdered = dragged.kind === "ordered-row";

  // Apply the reorder to find the post-drag context. Headers & the
  // ordered-hint are part of the array even though they aren't draggable;
  // the splice carries them along faithfully.
  const post = entries.slice();
  const [moved] = post.splice(from, 1);
  if (!moved) return { kind: "noop" };
  post.splice(to, 0, moved);

  // Walk back from the new position to find the nearest section header,
  // which tells us which band the dragged row landed in.
  const nowOrdered = sectionAt(post, to);

  // detected → detected is a no-op (detected has no user-visible order).
  if (!wasOrdered && !nowOrdered) return { kind: "noop" };

  // demote: ordered → detected
  if (wasOrdered && !nowOrdered) {
    return { kind: "detected", nextPosition: null };
  }

  // Promote (cross-section detected → ordered) or in-section reorder.
  // The dragged row's `kind` doesn't change on splice, so we can't filter for
  // it; instead we walk left/right from `to` in `post` to find the nearest
  // ordered-row neighbours, stopping at the detected-header boundary.
  const { before, after } = orderedNeighborsAround(post, to);
  const nextPosition = midpoint(
    before ? readPosition(before) : null,
    after ? readPosition(after) : null,
  );

  if (wasOrdered) {
    const currentPos = readPosition(dragged.item);
    if (currentPos !== null && Math.abs(nextPosition - currentPos) < 1e-9) {
      return { kind: "noop" };
    }
  }
  return { kind: "ordered", nextPosition };
}

function orderedNeighborsAround(
  post: ShelfEntry[],
  index: number,
): { before: Item | null; after: Item | null } {
  let before: Item | null = null;
  let after: Item | null = null;
  for (let i = index - 1; i >= 0; i--) {
    const e = post[i];
    if (!e) continue;
    if (e.kind === "ordered-row") {
      before = e.item;
      break;
    }
    if (e.kind === "detected-header" || e.kind === "detected-row") break;
  }
  for (let i = index + 1; i < post.length; i++) {
    const e = post[i];
    if (!e) continue;
    if (e.kind === "ordered-row") {
      after = e.item;
      break;
    }
    if (e.kind === "detected-header" || e.kind === "detected-row") break;
  }
  return { before, after };
}

/**
 * Returns true if the slot at `index` in `entries` is in the ordered band,
 * false if it's in the detected band. "Section" is determined by walking
 * backwards to the nearest section header. With no ordered or detected
 * header present (e.g. shelf has only ordered rows or only detected rows),
 * we fall back to "the section that exists". An entirely empty shelf
 * defaults to ordered (which can't actually happen — we only drag rows).
 */
function sectionAt(entries: ShelfEntry[], index: number): boolean {
  for (let i = Math.min(index, entries.length - 1); i >= 0; i--) {
    const e = entries[i];
    if (!e) continue;
    if (e.kind === "ordered-header") return true;
    if (e.kind === "detected-header") return false;
  }
  // No header above us → we're at the very top of the visible content,
  // which is always the ordered band (ordered always renders before
  // detected when both exist; if only the ordered-hint is shown above
  // the detected section, the hint sits in the ordered band).
  return true;
}

function readPosition(item: Item): number | null {
  const meta = item.metadata as Partial<AlbumShelfItemMetadata>;
  return typeof meta.position === "number" ? meta.position : null;
}

/**
 * Midpoint between two ordered-row positions:
 * - both null → 1   (empty ordered list)
 * - before null → after / 2  (insert at top)
 * - after null  → before + 1  (insert at bottom)
 * - both        → (before + after) / 2
 */
export function midpoint(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null && after !== null) return after / 2;
  if (after === null && before !== null) return before + 1;
  return ((before as number) + (after as number)) / 2;
}
