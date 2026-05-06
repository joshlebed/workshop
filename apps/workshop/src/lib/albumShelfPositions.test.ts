import type { AlbumShelfItemMetadata, Item, ListItemsResponse } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import {
  applyPositionPatch,
  midpointAt,
  midpointBetween,
  midpointForOrderedReorder,
  positionOf,
} from "./albumShelfPositions";

function albumItem(id: string, position: number | null): Item {
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
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("positionOf", () => {
  it("returns the numeric position for an ordered item", () => {
    expect(positionOf(albumItem("a", 3))).toBe(3);
  });

  it("returns null for an unordered item", () => {
    expect(positionOf(albumItem("a", null))).toBeNull();
  });
});

describe("midpointAt", () => {
  it("returns 1 for an empty ordered list", () => {
    expect(midpointAt([], 0)).toBe(1);
  });

  it("inserts at top by halving the first position", () => {
    const items = [albumItem("a", 4), albumItem("b", 6)];
    expect(midpointAt(items, 0)).toBe(2);
  });

  it("inserts at bottom by adding 1 to the last position", () => {
    const items = [albumItem("a", 4), albumItem("b", 6)];
    expect(midpointAt(items, items.length)).toBe(7);
  });

  it("inserts in the middle as the midpoint of neighbours", () => {
    const items = [albumItem("a", 2), albumItem("b", 4), albumItem("c", 6)];
    expect(midpointAt(items, 1)).toBe(3);
    expect(midpointAt(items, 2)).toBe(5);
  });

  it("clamps a negative index to top behavior", () => {
    const items = [albumItem("a", 4)];
    expect(midpointAt(items, -1)).toBe(2);
  });

  it("clamps an out-of-range index to bottom behavior", () => {
    const items = [albumItem("a", 4)];
    expect(midpointAt(items, 99)).toBe(5);
  });
});

describe("applyPositionPatch", () => {
  const initial: ListItemsResponse = {
    ordered: [albumItem("a", 1), albumItem("b", 2)],
    unordered: [albumItem("c", null)],
    completed: [],
  };

  it("promotes an unordered row into ordered and resorts", () => {
    const next = applyPositionPatch(initial, "c", 1.5);
    expect(next.unordered).toEqual([]);
    expect(next.ordered.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("demotes an ordered row by setting position to null", () => {
    const next = applyPositionPatch(initial, "a", null);
    expect(next.ordered.map((i) => i.id)).toEqual(["b"]);
    expect(next.unordered.map((i) => i.id)).toEqual(["c", "a"]);
  });

  it("returns the same response when the item id is unknown", () => {
    const next = applyPositionPatch(initial, "missing", 5);
    expect(next).toBe(initial);
  });

  it("re-orders an existing ordered row", () => {
    const next = applyPositionPatch(initial, "a", 3);
    expect(next.ordered.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("preserves the completed bucket through position patches", () => {
    const initialWithCompleted: ListItemsResponse = {
      ordered: [albumItem("a", 1)],
      unordered: [albumItem("c", null)],
      completed: [albumItem("done", null)],
    };
    const next = applyPositionPatch(initialWithCompleted, "c", 0.5);
    expect(next.completed.map((i) => i.id)).toEqual(["done"]);
  });
});

describe("midpointBetween", () => {
  it("returns 1 for an empty ordered list", () => {
    expect(midpointBetween(null, null)).toBe(1);
  });
  it("halves the first position when inserting at top", () => {
    expect(midpointBetween(null, 4)).toBe(2);
  });
  it("adds 1 to the last position when inserting at bottom", () => {
    expect(midpointBetween(4, null)).toBe(5);
  });
  it("averages two neighbours", () => {
    expect(midpointBetween(2, 4)).toBe(3);
    expect(midpointBetween(1, 1.5)).toBe(1.25);
  });
});

describe("midpointForOrderedReorder", () => {
  const ordered = () => [albumItem("a", 1), albumItem("b", 2), albumItem("c", 3)];

  it("returns null when fromIndex equals toIndex", () => {
    expect(midpointForOrderedReorder(ordered(), 1, 1)).toBeNull();
  });

  it("returns null for out-of-range indices", () => {
    expect(midpointForOrderedReorder(ordered(), -1, 0)).toBeNull();
    expect(midpointForOrderedReorder(ordered(), 0, 99)).toBeNull();
  });

  it("moves a row down past the next neighbour: a → between b and c", () => {
    expect(midpointForOrderedReorder(ordered(), 0, 1)).toBe(2.5);
  });

  it("moves a row up past the previous neighbour: c → between a and b", () => {
    expect(midpointForOrderedReorder(ordered(), 2, 1)).toBe(1.5);
  });

  it("moves a row to the very top by halving the first remaining position", () => {
    expect(midpointForOrderedReorder(ordered(), 2, 0)).toBe(0.5);
  });

  it("moves a row to the very bottom by adding 1 to the last remaining position", () => {
    expect(midpointForOrderedReorder(ordered(), 0, 2)).toBe(4);
  });

  it("handles fractional neighbours without drift", () => {
    const items = [albumItem("a", 0.5), albumItem("b", 0.75), albumItem("c", 1)];
    expect(midpointForOrderedReorder(items, 2, 1)).toBe(0.625);
  });

  it("returns null when the row already sits at the computed midpoint", () => {
    const items = [albumItem("a", 1), albumItem("b", 2)];
    expect(midpointForOrderedReorder(items, 0, 0)).toBeNull();
  });
});
