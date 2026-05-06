// Translate a library-level reorder event ({from, to} in array-splice
// semantics) into the list's domain mutation: stay in current section,
// promote to ordered with a new `position`, or demote to unordered.
//
// Both `react-native-reorderable-list` (native) and `@dnd-kit/sortable` (web)
// report `to` in post-removal coordinates: applying it is equivalent to
// `arr.splice(to, 0, arr.splice(from, 1)[0])`. So this helper accepts the
// pre-drag entry list + (from, to) and decides what mutation to send to the
// backend, regardless of which library produced the event. The completed
// section is non-draggable, so we never see `to` land inside it.

import type { Item } from "@workshop/shared";
import { isDraggableRow, type ListEntry } from "./types";

export type DropResult =
  | { kind: "ordered"; nextPosition: number }
  | { kind: "unordered"; nextPosition: null }
  | { kind: "noop" };

export interface ReorderArgs {
  /** The entries the list rendered before the drag started. */
  entries: ListEntry[];
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
 * PATCH is needed (released in place, or unordered→unordered which has no
 * meaningful order).
 */
export function resolveReorder({ entries, from, to }: ReorderArgs): DropResult {
  if (from === to) return { kind: "noop" };
  if (from < 0 || from >= entries.length) return { kind: "noop" };
  const dragged = entries[from];
  if (!dragged || !isDraggableRow(dragged)) return { kind: "noop" };

  const wasOrdered = dragged.kind === "ordered-row";

  // Apply the reorder to find the post-drag context. Headers, the
  // ordered-hint, and completed rows are part of the array even though
  // they aren't draggable; the splice carries them along faithfully.
  const post = entries.slice();
  const [moved] = post.splice(from, 1);
  if (!moved) return { kind: "noop" };
  post.splice(to, 0, moved);

  // Walk back from the new position to find the nearest section header,
  // which tells us which band the dragged row landed in. If the drag
  // crossed into the completed section we treat it as a noop — completed
  // rows aren't draggable and we don't change completed state via drag.
  const section = sectionAt(post, to);
  if (section === "completed") return { kind: "noop" };
  const nowOrdered = section === "ordered";

  // unordered → unordered is a no-op (unordered has no user-visible order).
  if (!wasOrdered && !nowOrdered) return { kind: "noop" };

  // demote: ordered → unordered
  if (wasOrdered && !nowOrdered) {
    return { kind: "unordered", nextPosition: null };
  }

  // Promote (cross-section unordered → ordered) or in-section reorder.
  // The dragged row's `kind` doesn't change on splice, so we can't filter
  // for it; instead we walk left/right from `to` in `post` to find the
  // nearest ordered-row neighbours, stopping at the unordered boundary.
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
  post: ListEntry[],
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
    if (
      e.kind === "unordered-header" ||
      e.kind === "unordered-row" ||
      e.kind === "completed-header" ||
      e.kind === "completed-row"
    ) {
      break;
    }
  }
  for (let i = index + 1; i < post.length; i++) {
    const e = post[i];
    if (!e) continue;
    if (e.kind === "ordered-row") {
      after = e.item;
      break;
    }
    if (
      e.kind === "unordered-header" ||
      e.kind === "unordered-row" ||
      e.kind === "completed-header" ||
      e.kind === "completed-row"
    ) {
      break;
    }
  }
  return { before, after };
}

type Section = "ordered" | "unordered" | "completed";

/**
 * Returns the section at `index` in `entries`. "Section" is determined by
 * walking backwards to the nearest section header. With no header present
 * we fall back to "ordered" (the topmost band).
 */
function sectionAt(entries: ListEntry[], index: number): Section {
  for (let i = Math.min(index, entries.length - 1); i >= 0; i--) {
    const e = entries[i];
    if (!e) continue;
    if (e.kind === "ordered-header") return "ordered";
    if (e.kind === "unordered-header") return "unordered";
    if (e.kind === "completed-header") return "completed";
  }
  return "ordered";
}

function readPosition(item: Item): number | null {
  const meta = item.metadata as { position?: number | null };
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
