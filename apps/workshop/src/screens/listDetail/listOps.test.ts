import type { Item, ListItemsResponse } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import {
  applyComplete,
  applyMove,
  applyRemove,
  applyRestore,
  applyUncomplete,
  completionCopy,
  type DragEntry,
  findItem,
  itemMatches,
  resolveDrop,
  stepNeighbours,
  tagChipCounts,
} from "./listOps";

function item(id: string, extra: Partial<Item> = {}): Item {
  return {
    id,
    listId: "L",
    kind: "plain",
    title: id,
    url: null,
    note: null,
    content: {},
    position: null,
    tags: [],
    addedBy: "u",
    completed: false,
    completedAt: null,
    completedBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

const ranked = (id: string): DragEntry => ({ kind: "row", id, section: "ordered" });
const open = (id: string): DragEntry => ({ kind: "row", id, section: "unordered" });
const titles = (xs: Item[]) => xs.map((i) => i.id);

describe("completionCopy", () => {
  it("uses the list's own word", () => {
    expect(completionCopy("movie").marked).toBe("Marked watched");
    expect(completionCopy("tv").mark).toBe("Mark watched");
    expect(completionCopy("book").done).toBe("Read");
    expect(completionCopy("book").unmark).toBe("Mark not read");
    expect(completionCopy("link").done).toBe("Tried");
    expect(completionCopy("plain").openCount(3)).toBe("3 to do");
    expect(completionCopy(null).done).toBe("Done");
    expect(completionCopy("movie").openCount(12)).toBe("12 to watch");
  });
});

describe("resolveDrop — implicit boundary (native, Ranked non-empty)", () => {
  // [A, B, C | U, V]
  const entries = [ranked("A"), ranked("B"), ranked("C"), open("U"), open("V")];
  const drop = (from: number, to: number) => resolveDrop(entries, from, to);

  it("reorders within Ranked with the same neighbours as before", () => {
    expect(drop(0, 1)).toEqual({
      itemId: "A",
      section: "ranked",
      beforeItemId: "B",
      afterItemId: "C",
    });
    expect(drop(2, 0)).toEqual({
      itemId: "C",
      section: "ranked",
      beforeItemId: null,
      afterItemId: "A",
    });
    expect(drop(0, 2)).toEqual({
      itemId: "A",
      section: "ranked",
      beforeItemId: "C",
      afterItemId: null,
    });
  });

  it("promotes to the top, between, and to the end of Ranked", () => {
    expect(drop(3, 0)).toEqual({
      itemId: "U",
      section: "ranked",
      beforeItemId: null,
      afterItemId: "A",
    });
    expect(drop(3, 1)).toEqual({
      itemId: "U",
      section: "ranked",
      beforeItemId: "A",
      afterItemId: "B",
    });
    expect(drop(4, 3)).toEqual({
      itemId: "V",
      section: "ranked",
      beforeItemId: "C",
      afterItemId: null,
    });
  });

  it("demotes to a place in the open block", () => {
    expect(drop(0, 4)).toEqual({
      itemId: "A",
      section: "unranked",
      beforeItemId: "V",
      afterItemId: null,
    });
    expect(drop(2, 3)).toEqual({
      itemId: "C",
      section: "unranked",
      beforeItemId: "U",
      afterItemId: "V",
    });
  });

  it("reorders within the open block", () => {
    expect(drop(3, 4)).toEqual({
      itemId: "U",
      section: "unranked",
      beforeItemId: "V",
      afterItemId: null,
    });
  });

  it("drops open-to-open moves where the open block is recency-sorted (album shelf)", () => {
    expect(resolveDrop(entries, 3, 4, { openReorderable: false })).toBeNull();
    expect(resolveDrop(entries, 0, 4, { openReorderable: false })?.section).toBe("unranked");
  });

  it("ignores no-ops and bad indices", () => {
    expect(drop(2, 2)).toBeNull();
    expect(drop(-1, 2)).toBeNull();
    expect(drop(2, 99)).toBeNull();
  });
});

describe("resolveDrop — divider marker (web)", () => {
  it("promotes into an empty Ranked section", () => {
    // [RANKED_TOP, divider, U, V, W]: drag V above the divider
    const entries: DragEntry[] = [{ kind: "divider", id: "div" }, open("U"), open("V"), open("W")];
    expect(resolveDrop(entries, 2, 0)).toEqual({
      itemId: "V",
      section: "ranked",
      beforeItemId: null,
      afterItemId: null,
    });
  });

  it("demotes the last ranked row below the divider", () => {
    const entries: DragEntry[] = [
      ranked("A"),
      { kind: "divider", id: "div" },
      open("U"),
      open("V"),
    ];
    // A → index 2: [div, U, A, V]
    expect(resolveDrop(entries, 0, 2)).toEqual({
      itemId: "A",
      section: "unranked",
      beforeItemId: "U",
      afterItemId: "V",
    });
    // A → index 1 swaps it with the divider: top of the open block.
    expect(resolveDrop(entries, 0, 1)).toEqual({
      itemId: "A",
      section: "unranked",
      beforeItemId: null,
      afterItemId: "U",
    });
  });

  it("works on a list without ranking (no marker, all open)", () => {
    const entries = [open("A"), open("B"), open("C")];
    expect(resolveDrop(entries, 2, 0)).toEqual({
      itemId: "C",
      section: "unranked",
      beforeItemId: null,
      afterItemId: "A",
    });
  });
});

describe("resolveDrop — slot marker (native, empty Ranked)", () => {
  const entries: DragEntry[] = [{ kind: "slot", id: "slot" }, open("U"), open("V"), open("W")];
  it("ranks a row dropped directly under the slot", () => {
    // V → 1: [slot, V, U, W]
    expect(resolveDrop(entries, 2, 1)).toEqual({
      itemId: "V",
      section: "ranked",
      beforeItemId: null,
      afterItemId: null,
    });
  });
  it("ranks a row dropped above the slot", () => {
    expect(resolveDrop(entries, 3, 0)?.section).toBe("ranked");
  });
  it("keeps a row dropped lower down in the open block", () => {
    // U → 3: [slot, V, W, U]
    expect(resolveDrop(entries, 1, 3)).toEqual({
      itemId: "U",
      section: "unranked",
      beforeItemId: "W",
      afterItemId: null,
    });
  });
});

describe("stepNeighbours", () => {
  const rows = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }];
  it("moves up past the row above", () => {
    expect(stepNeighbours(rows, "C", "up")).toEqual({ beforeItemId: "A", afterItemId: "B" });
    expect(stepNeighbours(rows, "B", "up")).toEqual({ beforeItemId: null, afterItemId: "A" });
  });
  it("moves down past the row below", () => {
    expect(stepNeighbours(rows, "B", "down")).toEqual({ beforeItemId: "C", afterItemId: "D" });
    expect(stepNeighbours(rows, "C", "down")).toEqual({ beforeItemId: "D", afterItemId: null });
  });
  it("is null at the ends", () => {
    expect(stepNeighbours(rows, "A", "up")).toBeNull();
    expect(stepNeighbours(rows, "D", "down")).toBeNull();
    expect(stepNeighbours(rows, "Z", "down")).toBeNull();
  });
});

describe("optimistic edits", () => {
  const data = (): ListItemsResponse => ({
    ordered: [item("R1", { position: 1024 }), item("R2", { position: 2048 })],
    unordered: [
      item("U3", { createdAt: "2026-01-03T00:00:00.000Z" }),
      item("U1", { createdAt: "2026-01-01T00:00:00.000Z" }),
    ],
    completed: [item("D1", { completed: true, completedAt: "2026-01-05T00:00:00.000Z" })],
    suggested: [],
  });

  it("completes onto the top of Done", () => {
    const next = applyComplete(data(), "U3", "me", new Date("2026-02-01T00:00:00.000Z"));
    expect(titles(next.unordered)).toEqual(["U1"]);
    expect(titles(next.completed)).toEqual(["U3", "D1"]);
    expect(next.completed[0]).toMatchObject({ completed: true, completedBy: "me" });
  });

  it("reopens a ranked row into its rank and an open row by age", () => {
    const rankedDone = applyComplete(data(), "R1", "me");
    expect(titles(applyUncomplete(rankedDone, "R1", true).ordered)).toEqual(["R1", "R2"]);
    const withMid = {
      ...data(),
      completed: [item("U2", { completed: true, createdAt: "2026-01-02T00:00:00.000Z" })],
    };
    expect(titles(applyUncomplete(withMid, "U2", true).unordered)).toEqual(["U3", "U2", "U1"]);
  });

  it("removes and restores in place", () => {
    const before = data();
    const placement = findItem(before, "U1");
    expect(placement).not.toBeNull();
    const removed = applyRemove(before, "U1");
    expect(titles(removed.unordered)).toEqual(["U3"]);
    const restored = applyRestore(removed, placement as NonNullable<typeof placement>);
    expect(titles(restored.unordered)).toEqual(["U3", "U1"]);
    // Restoring twice is harmless.
    expect(applyRestore(restored, placement as NonNullable<typeof placement>)).toBe(restored);
  });

  it("moves between sections like the server", () => {
    const promoted = applyMove(data(), "U1", {
      section: "ranked",
      beforeItemId: "R1",
      afterItemId: "R2",
    });
    expect(titles(promoted.ordered)).toEqual(["R1", "U1", "R2"]);
    const demoted = applyMove(data(), "R2", {
      section: "unranked",
      beforeItemId: null,
      afterItemId: null,
    });
    expect(titles(demoted.unordered)).toEqual(["R2", "U3", "U1"]);
    expect(demoted.unordered[0]?.position).toBeNull();
    const appended = applyMove(data(), "U3", {
      section: "ranked",
      beforeItemId: null,
      afterItemId: null,
    });
    expect(titles(appended.ordered)).toEqual(["R1", "R2", "U3"]);
    expect(
      applyMove(data(), "D1", { section: "ranked", beforeItemId: null, afterItemId: null }),
    ).toEqual(data());
  });
});

describe("filtering", () => {
  const a = item("Tacos", { tags: ["food", "cheap"], note: "Friday" });
  const b = item("Opera", { tags: ["fancy"] });
  const c = item("Pizza", { tags: ["food"] });

  it("matches tag names in the search text", () => {
    expect(itemMatches(b, { text: "fanc", tags: [] })).toBe(true);
    expect(itemMatches(a, { text: "friday", tags: [] })).toBe(true);
    expect(itemMatches(c, { text: "cheap", tags: [] })).toBe(false);
  });

  it("ANDs selected tags with the text", () => {
    expect(itemMatches(a, { text: "", tags: ["food", "cheap"] })).toBe(true);
    expect(itemMatches(c, { text: "", tags: ["food", "cheap"] })).toBe(false);
    expect(itemMatches(c, { text: "taco", tags: ["food"] })).toBe(false);
  });

  it("counts chips over the current result in a stable order", () => {
    const all = [a, b, c];
    expect(tagChipCounts(all, all)).toEqual([
      { tag: "food", count: 2 },
      { tag: "cheap", count: 1 },
      { tag: "fancy", count: 1 },
    ]);
    // Filtering to "food" keeps every chip where it was.
    expect(tagChipCounts(all, [a, c])).toEqual([
      { tag: "food", count: 2 },
      { tag: "cheap", count: 1 },
      { tag: "fancy", count: 0 },
    ]);
  });
});
