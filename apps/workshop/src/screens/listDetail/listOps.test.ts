import type { Item, ListRowsResponse } from "@workshop/shared";
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
  moveRequest,
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

const row = (id: string): DragEntry => ({ kind: "row", id, section: "open" });
const waiting = (id: string): DragEntry => ({ kind: "row", id, section: "inbox" });
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

describe("resolveDrop — one list", () => {
  const entries = [row("A"), row("B"), row("C"), row("D")];
  const drop = (from: number, to: number) => resolveDrop(entries, from, to);

  it("moves to the top, between two rows, and to the bottom", () => {
    expect(drop(2, 0)).toEqual({ itemId: "C", beforeItemId: null, afterItemId: "A" });
    expect(drop(0, 1)).toEqual({ itemId: "A", beforeItemId: "B", afterItemId: "C" });
    expect(drop(0, 3)).toEqual({ itemId: "A", beforeItemId: "D", afterItemId: null });
    expect(drop(3, 1)).toEqual({ itemId: "D", beforeItemId: "A", afterItemId: "B" });
  });

  it("ignores no-ops and bad indices", () => {
    expect(drop(2, 2)).toBeNull();
    expect(drop(-1, 2)).toBeNull();
    expect(drop(2, 99)).toBeNull();
  });
});

describe("resolveDrop — the inbox under a divider (web)", () => {
  // [A, B, | inbox: X, Y]
  const entries: DragEntry[] = [
    row("A"),
    row("B"),
    { kind: "divider", id: "div" },
    waiting("X"),
    waiting("Y"),
  ];

  it("places an inbox row dragged above the heading", () => {
    // Y → 1: [A, Y, B, div, X]
    expect(resolveDrop(entries, 4, 1)).toEqual({
      itemId: "Y",
      beforeItemId: "A",
      afterItemId: "B",
    });
    // X onto the heading: the bottom of the list.
    expect(resolveDrop(entries, 3, 2)).toEqual({
      itemId: "X",
      beforeItemId: "B",
      afterItemId: null,
    });
  });

  it("keeps the inbox's own order: an inbox row dropped inside it stays put", () => {
    expect(resolveDrop(entries, 3, 4)).toBeNull();
  });

  it("lands a list row dropped into the inbox at the bottom of the list", () => {
    expect(resolveDrop(entries, 0, 4)).toEqual({
      itemId: "A",
      beforeItemId: "B",
      afterItemId: null,
    });
    // Already the last list row: nothing changes.
    expect(resolveDrop(entries, 1, 4)).toBeNull();
  });

  it("starts an empty list from the inbox", () => {
    const empty: DragEntry[] = [{ kind: "divider", id: "div" }, waiting("X"), waiting("Y")];
    expect(resolveDrop(empty, 2, 0)).toEqual({
      itemId: "Y",
      beforeItemId: null,
      afterItemId: null,
    });
  });
});

describe("resolveDrop — the inbox after the list (native, implicit boundary)", () => {
  const entries = [row("A"), row("B"), waiting("X"), waiting("Y")];
  it("places an inbox row dropped beside a list row", () => {
    expect(resolveDrop(entries, 3, 0)).toEqual({
      itemId: "Y",
      beforeItemId: null,
      afterItemId: "A",
    });
    // Just under the last list row: the bottom of the list.
    expect(resolveDrop(entries, 3, 2)).toEqual({
      itemId: "Y",
      beforeItemId: "B",
      afterItemId: null,
    });
  });
  it("leaves the inbox's order alone and sends a list row to the bottom of the list", () => {
    expect(resolveDrop(entries, 2, 3)).toBeNull();
    expect(resolveDrop(entries, 0, 3)).toEqual({
      itemId: "A",
      beforeItemId: "B",
      afterItemId: null,
    });
  });
});

describe("resolveDrop — slot marker (native, nothing placed yet)", () => {
  const entries: DragEntry[] = [{ kind: "slot", id: "slot" }, waiting("U"), waiting("V")];
  it("starts the list with a row dropped onto or right under the slot", () => {
    expect(resolveDrop(entries, 1, 0)).toEqual({
      itemId: "U",
      beforeItemId: null,
      afterItemId: null,
    });
    expect(resolveDrop(entries, 2, 1)).toEqual({
      itemId: "V",
      beforeItemId: null,
      afterItemId: null,
    });
  });
  it("keeps a row dropped lower down in the inbox", () => {
    expect(resolveDrop(entries, 1, 2)).toBeNull();
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
  const data = (): ListRowsResponse => ({
    open: [
      item("A", { position: 1024 }),
      item("B", { position: 2048 }),
      item("C", { position: 3072 }),
    ],
    inbox: [item("X"), item("Y")],
    completed: [item("D1", { completed: true, position: 1536 })],
    suggested: [],
    ordered: [],
    unordered: [],
  });

  it("completes onto the top of Done, from the list or the inbox", () => {
    const next = applyComplete(data(), "B", "me", new Date("2026-02-01T00:00:00.000Z"));
    expect(titles(next.open)).toEqual(["A", "C"]);
    expect(titles(next.completed)).toEqual(["B", "D1"]);
    expect(next.completed[0]).toMatchObject({ completed: true, completedBy: "me" });
    expect(titles(applyComplete(data(), "X", "me").inbox)).toEqual(["Y"]);
  });

  it("reopens a row into its old place by position", () => {
    expect(titles(applyUncomplete(data(), "D1", false).open)).toEqual(["A", "D1", "B", "C"]);
  });

  it("reopens a never-placed row into the inbox, or the top of a list without one", () => {
    const d = { ...data(), completed: [item("N", { completed: true })] };
    expect(titles(applyUncomplete(d, "N", true).inbox)).toEqual(["N", "X", "Y"]);
    expect(titles(applyUncomplete(d, "N", false).open)).toEqual(["N", "A", "B", "C"]);
  });

  it("removes and restores in place", () => {
    const before = data();
    const placement = findItem(before, "B");
    expect(placement).not.toBeNull();
    const removed = applyRemove(before, "B");
    expect(titles(removed.open)).toEqual(["A", "C"]);
    const restored = applyRestore(removed, placement as NonNullable<typeof placement>);
    expect(titles(restored.open)).toEqual(["A", "B", "C"]);
    // Restoring twice is harmless.
    expect(applyRestore(restored, placement as NonNullable<typeof placement>)).toBe(restored);
  });

  it("moves like the server: below `before`, above `after`, else to the top", () => {
    expect(titles(applyMove(data(), "C", { beforeItemId: "A", afterItemId: "B" }).open)).toEqual([
      "A",
      "C",
      "B",
    ]);
    expect(titles(applyMove(data(), "A", { beforeItemId: null, afterItemId: "C" }).open)).toEqual([
      "B",
      "A",
      "C",
    ]);
    expect(titles(applyMove(data(), "C", { beforeItemId: null, afterItemId: null }).open)).toEqual([
      "C",
      "A",
      "B",
    ]);
    expect(applyMove(data(), "D1", { beforeItemId: null, afterItemId: null })).toEqual(data());
  });

  it("places an inbox row in the list, and puts it back for Undo", () => {
    const placed = applyMove(data(), "Y", { beforeItemId: "A", afterItemId: "B" });
    expect(titles(placed.open)).toEqual(["A", "Y", "B", "C"]);
    expect(titles(placed.inbox)).toEqual(["X"]);
    const back = applyMove(placed, "Y", { beforeItemId: null, afterItemId: null, toInbox: true });
    expect(titles(back.inbox)).toEqual(["Y", "X"]);
    expect(back.inbox[0]?.position).toBeNull();
  });

  it("sends `section: list`, and `section: inbox` only to undo an Add to list", () => {
    expect(moveRequest({ beforeItemId: "A", afterItemId: null })).toEqual({
      section: "list",
      beforeItemId: "A",
      afterItemId: null,
    });
    expect(moveRequest({ beforeItemId: null, afterItemId: null, toInbox: true })).toEqual({
      section: "inbox",
    });
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
