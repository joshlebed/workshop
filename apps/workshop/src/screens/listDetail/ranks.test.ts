import { describe, expect, it } from "vitest";
import { rankAnchorsOf, rankByIdOf } from "./ranks";

const ranked = [{ id: "pasta" }, { id: "sunset" }, { id: "pottery" }, { id: "bread" }];
// What a "food" tag filter leaves visible.
const filtered = ranked.filter((it) => it.id === "pasta" || it.id === "bread");

describe("rank under a filter", () => {
  it("numbers rows by their place in the whole Ranked block", () => {
    const rankById = rankByIdOf(ranked);
    expect(filtered.map((it) => rankById.get(it.id))).toEqual([1, 4]);
  });

  it("anchors top/bottom on the whole Ranked block, not the visible rows", () => {
    expect(rankAnchorsOf(ranked)).toEqual({ firstId: "pasta", lastId: "bread" });
    expect(rankAnchorsOf([{ id: "pasta" }, { id: "sunset" }])).toEqual({
      firstId: "pasta",
      lastId: "sunset",
    });
    expect(rankAnchorsOf([])).toEqual({ firstId: null, lastId: null });
  });
});
