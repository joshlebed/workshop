import type { AlbumShelfItemMetadata, Item } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import { midpoint, resolveReorder } from "./resolveReorder";
import type { ShelfEntry } from "./types";

function row(id: string, position: number | null): Item {
  return {
    id,
    listId: "list-1",
    type: "album_shelf",
    title: id,
    url: null,
    note: null,
    metadata: {
      source: "spotify",
      spotifyAlbumId: id,
      spotifyAlbumUrl: `https://open.spotify.com/album/${id}`,
      title: id,
      artist: "Artist",
      trackCount: 10,
      position,
      detectedAt: "2024-01-01T00:00:00.000Z",
    } satisfies AlbumShelfItemMetadata,
    addedBy: "user-1",
    completed: false,
    completedAt: null,
    completedBy: null,
    upvoteCount: 0,
    hasUpvoted: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function buildEntries(opts: {
  ordered: { id: string; position: number }[];
  detected: string[];
}): ShelfEntry[] {
  const out: ShelfEntry[] = [];
  if (opts.ordered.length > 0) {
    out.push({ kind: "ordered-header", count: opts.ordered.length });
    opts.ordered.forEach((o, i) => {
      out.push({ kind: "ordered-row", item: row(o.id, o.position), orderedIndex: i });
    });
  }
  if (opts.detected.length > 0) {
    out.push({ kind: "detected-header", count: opts.detected.length });
    for (const id of opts.detected) {
      out.push({ kind: "detected-row", item: row(id, null) });
    }
  }
  return out;
}

describe("midpoint", () => {
  it("returns 1 for an empty ordered list", () => {
    expect(midpoint(null, null)).toBe(1);
  });
  it("halves the first position when inserting at top", () => {
    expect(midpoint(null, 4)).toBe(2);
  });
  it("adds 1 to the last position when inserting at bottom", () => {
    expect(midpoint(4, null)).toBe(5);
  });
  it("averages two neighbours", () => {
    expect(midpoint(2, 4)).toBe(3);
    expect(midpoint(1, 1.5)).toBe(1.25);
  });
});

describe("resolveReorder", () => {
  // entries layout for a shelf with 3 ordered + 2 detected:
  //   0: ordered-header
  //   1: ordered-row ord-1 (position 1)
  //   2: ordered-row ord-2 (position 2)
  //   3: ordered-row ord-3 (position 3)
  //   4: detected-header
  //   5: detected-row det-1
  //   6: detected-row det-2
  const baseEntries = () =>
    buildEntries({
      ordered: [
        { id: "ord-1", position: 1 },
        { id: "ord-2", position: 2 },
        { id: "ord-3", position: 3 },
      ],
      detected: ["det-1", "det-2"],
    });

  it("returns noop when from === to", () => {
    expect(resolveReorder({ entries: baseEntries(), from: 1, to: 1 })).toEqual({ kind: "noop" });
  });

  it("returns noop when 'from' isn't a row entry", () => {
    // header is at index 0 — not a row, shouldn't trigger any mutation.
    expect(resolveReorder({ entries: baseEntries(), from: 0, to: 5 })).toEqual({ kind: "noop" });
  });

  it("reorders ord-1 down past ord-2 (between ord-2 and ord-3)", () => {
    // Pre: [H, ord-1, ord-2, ord-3, ...]. from=1, to=2 (post-removal index)
    // Removed: [H, ord-2, ord-3, ...]. Insert ord-1 at idx 2 →
    // [H, ord-2, ord-1, ord-3, ...]. ord-1 is between ord-2 (pos 2) and
    // ord-3 (pos 3) → midpoint 2.5.
    const r = resolveReorder({ entries: baseEntries(), from: 1, to: 2 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 2.5 });
  });

  it("reorders ord-3 up to the top of ordered", () => {
    // from=3, to=1. Remove → [H, ord-1, ord-2, ...]. Insert at 1 →
    // [H, ord-3, ord-1, ord-2, ...]. ord-3 has no predecessor (just header)
    // and ord-1 (pos 1) follows → midpoint(null, 1) = 0.5.
    const r = resolveReorder({ entries: baseEntries(), from: 3, to: 1 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.5 });
  });

  it("demotes an ordered row dropped onto / past the detected header", () => {
    // from=2 (ord-2), to=4 (the detected header slot post-removal).
    // After splice: ord-2 lands inside the detected band → demote.
    const r = resolveReorder({ entries: baseEntries(), from: 2, to: 4 });
    expect(r).toEqual({ kind: "detected", nextPosition: null });
  });

  it("demotes an ordered row dropped between two detected rows", () => {
    // from=1 (ord-1), to=5 (between detected rows).
    const r = resolveReorder({ entries: baseEntries(), from: 1, to: 5 });
    expect(r).toEqual({ kind: "detected", nextPosition: null });
  });

  it("promotes a detected row dropped between two ordered rows (midpoint)", () => {
    // from=5 (det-1), to=2. After splice: ordered = [ord-1, det-1, ord-2, ord-3].
    // det-1 lands between ord-1 (pos 1) and ord-2 (pos 2) → midpoint 1.5.
    const r = resolveReorder({ entries: baseEntries(), from: 5, to: 2 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 1.5 });
  });

  it("promotes a detected row dropped at the top of ordered", () => {
    // from=5 (det-1), to=1. After splice: [H, det-1, ord-1, ord-2, ord-3, ...].
    // det-1 → midpoint(null, 1) = 0.5.
    const r = resolveReorder({ entries: baseEntries(), from: 5, to: 1 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.5 });
  });

  it("promotes a detected row dropped at the bottom of ordered (just above the divider)", () => {
    // from=6 (det-2), to=4 (post-removal: [H, ord-1, ord-2, ord-3, dH, det-1].
    // Insert det-2 at idx 4 → [H, ord-1, ord-2, ord-3, det-2, dH, det-1].
    // det-2 has ord-3 before (pos 3) and detected-header after → midpoint(3, null) = 4.
    const r = resolveReorder({ entries: baseEntries(), from: 6, to: 4 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 4 });
  });

  it("treats detected → detected as a no-op (detected has no order)", () => {
    // from=5 (det-1), to=6.
    const r = resolveReorder({ entries: baseEntries(), from: 5, to: 6 });
    expect(r).toEqual({ kind: "noop" });
  });

  it("returns noop if an ordered row stays at exactly its current position", () => {
    // Remove ord-2 (from=2) and re-insert at idx 2 (post-removal).
    // Post-removal: [H, ord-1, ord-3, ...]. Insert at 2 → [H, ord-1, ord-2, ord-3, ...].
    // ord-2 is between ord-1 (pos 1) and ord-3 (pos 3) → midpoint 2 == current.
    const r = resolveReorder({ entries: baseEntries(), from: 2, to: 2 });
    expect(r).toEqual({ kind: "noop" });
  });

  it("handles a shelf with only ordered rows (no detected section)", () => {
    const entries = buildEntries({
      ordered: [
        { id: "ord-1", position: 1 },
        { id: "ord-2", position: 2 },
      ],
      detected: [],
    });
    // Reorder ord-2 to the top: from=2, to=1.
    const r = resolveReorder({ entries, from: 2, to: 1 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.5 });
  });

  it("handles a shelf with only detected rows: drop in detected → noop", () => {
    const entries = buildEntries({
      ordered: [],
      detected: ["det-1", "det-2", "det-3"],
    });
    // Reorder det-3 to the top: from=3, to=1.
    const r = resolveReorder({ entries, from: 3, to: 1 });
    expect(r).toEqual({ kind: "noop" });
  });

  it("matches dnd-kit's drag-down-to-bottom semantics: ord-1 dropped over ord-3 lands BELOW ord-3", () => {
    // dnd-kit reports `over=ord-3` (pre-move idx 3) when the user drags
    // ord-1 down past ord-2 onto ord-3. With splice semantics that means
    // `to = overIdx = 3`. Post: [H, ord-2, ord-3, ord-1, dH, ...]. ord-1
    // ends up below ord-3, which matches the visual feedback dnd-kit
    // shows during the drag (ord-2/ord-3 slide up to fill the gap).
    const r = resolveReorder({ entries: baseEntries(), from: 1, to: 3 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 4 });
  });

  it("matches dnd-kit's drag-up-to-top semantics: ord-3 dropped over ord-1 lands ABOVE ord-1", () => {
    // Pre-move overIdx=1 → to=1. Post: [H, ord-3, ord-1, ord-2, dH, ...].
    const r = resolveReorder({ entries: baseEntries(), from: 3, to: 1 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.5 });
  });

  it("does not drift the position when promoting and computing midpoints with fractional neighbours", () => {
    const entries = buildEntries({
      ordered: [
        { id: "ord-1", position: 0.5 },
        { id: "ord-2", position: 0.75 },
      ],
      detected: ["det-1"],
    });
    // det-1 → between ord-1 and ord-2: from=4, to=2.
    const r = resolveReorder({ entries, from: 4, to: 2 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.625 });
  });
});
