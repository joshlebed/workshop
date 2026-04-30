import type { AlbumShelfItemMetadata, Item } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import { applyPositionPatch, midpointAt, positionOf } from "./albumShelfPositions";

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
    upvoteCount: 0,
    hasUpvoted: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("positionOf", () => {
  it("returns the numeric position for an ordered item", () => {
    expect(positionOf(albumItem("a", 3))).toBe(3);
  });

  it("returns null for a detected item", () => {
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
  const initial = {
    ordered: [albumItem("a", 1), albumItem("b", 2)],
    detected: [albumItem("c", null)],
  };

  it("promotes a detected row into ordered and resorts", () => {
    const next = applyPositionPatch(initial, "c", 1.5);
    expect(next.detected).toEqual([]);
    expect(next.ordered.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("demotes an ordered row by setting position to null", () => {
    const next = applyPositionPatch(initial, "a", null);
    expect(next.ordered.map((i) => i.id)).toEqual(["b"]);
    expect(next.detected.map((i) => i.id)).toEqual(["c", "a"]);
  });

  it("returns the same response when the item id is unknown", () => {
    const next = applyPositionPatch(initial, "missing", 5);
    expect(next).toBe(initial);
  });

  it("re-orders an existing ordered row", () => {
    const next = applyPositionPatch(initial, "a", 3);
    expect(next.ordered.map((i) => i.id)).toEqual(["b", "a"]);
  });
});
