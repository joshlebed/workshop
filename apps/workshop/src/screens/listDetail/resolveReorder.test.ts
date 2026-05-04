import type { Item } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import { midpoint, resolveReorder } from "./resolveReorder";
import type { ListEntry } from "./types";

function row(id: string, position: number | null): Item {
  return {
    id,
    listId: "list-1",
    type: "movie",
    title: id,
    url: null,
    note: null,
    metadata: { position } as Item["metadata"],
    addedBy: "user-1",
    completed: false,
    completedAt: null,
    completedBy: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function buildEntries(opts: {
  ordered: { id: string; position: number }[];
  unordered: string[];
  completed?: string[];
}): ListEntry[] {
  const out: ListEntry[] = [];
  if (opts.ordered.length > 0) {
    out.push({ kind: "ordered-header", count: opts.ordered.length });
    opts.ordered.forEach((o, i) => {
      out.push({ kind: "ordered-row", item: row(o.id, o.position), orderedIndex: i });
    });
  }
  if (opts.unordered.length > 0) {
    out.push({
      kind: "unordered-header",
      count: opts.unordered.length,
      isAlbumShelf: false,
    });
    for (const id of opts.unordered) {
      out.push({ kind: "unordered-row", item: row(id, null) });
    }
  }
  if (opts.completed && opts.completed.length > 0) {
    out.push({ kind: "completed-header", count: opts.completed.length });
    for (const id of opts.completed) {
      const it = row(id, null);
      it.completed = true;
      out.push({ kind: "completed-row", item: it });
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
  // entries layout for a list with 3 ordered + 2 unordered:
  //   0: ordered-header
  //   1: ordered-row ord-1 (position 1)
  //   2: ordered-row ord-2 (position 2)
  //   3: ordered-row ord-3 (position 3)
  //   4: unordered-header
  //   5: unordered-row un-1
  //   6: unordered-row un-2
  const baseEntries = () =>
    buildEntries({
      ordered: [
        { id: "ord-1", position: 1 },
        { id: "ord-2", position: 2 },
        { id: "ord-3", position: 3 },
      ],
      unordered: ["un-1", "un-2"],
    });

  it("returns noop when from === to", () => {
    expect(resolveReorder({ entries: baseEntries(), from: 1, to: 1 })).toEqual({ kind: "noop" });
  });

  it("returns noop when 'from' isn't a row entry", () => {
    expect(resolveReorder({ entries: baseEntries(), from: 0, to: 5 })).toEqual({ kind: "noop" });
  });

  it("reorders ord-1 down past ord-2 (between ord-2 and ord-3)", () => {
    const r = resolveReorder({ entries: baseEntries(), from: 1, to: 2 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 2.5 });
  });

  it("reorders ord-3 up to the top of ordered", () => {
    const r = resolveReorder({ entries: baseEntries(), from: 3, to: 1 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.5 });
  });

  it("demotes an ordered row dropped onto / past the unordered header", () => {
    const r = resolveReorder({ entries: baseEntries(), from: 2, to: 4 });
    expect(r).toEqual({ kind: "unordered", nextPosition: null });
  });

  it("demotes an ordered row dropped between two unordered rows", () => {
    const r = resolveReorder({ entries: baseEntries(), from: 1, to: 5 });
    expect(r).toEqual({ kind: "unordered", nextPosition: null });
  });

  it("promotes an unordered row dropped between two ordered rows (midpoint)", () => {
    const r = resolveReorder({ entries: baseEntries(), from: 5, to: 2 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 1.5 });
  });

  it("promotes an unordered row dropped at the top of ordered", () => {
    const r = resolveReorder({ entries: baseEntries(), from: 5, to: 1 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.5 });
  });

  it("promotes an unordered row dropped at the bottom of ordered (just above the divider)", () => {
    const r = resolveReorder({ entries: baseEntries(), from: 6, to: 4 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 4 });
  });

  it("treats unordered → unordered as a no-op (no order in that section)", () => {
    const r = resolveReorder({ entries: baseEntries(), from: 5, to: 6 });
    expect(r).toEqual({ kind: "noop" });
  });

  it("returns noop if an ordered row stays at exactly its current position", () => {
    const r = resolveReorder({ entries: baseEntries(), from: 2, to: 2 });
    expect(r).toEqual({ kind: "noop" });
  });

  it("handles a list with only ordered rows", () => {
    const entries = buildEntries({
      ordered: [
        { id: "ord-1", position: 1 },
        { id: "ord-2", position: 2 },
      ],
      unordered: [],
    });
    const r = resolveReorder({ entries, from: 2, to: 1 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.5 });
  });

  it("handles a list with only unordered rows: drop in unordered → noop", () => {
    const entries = buildEntries({
      ordered: [],
      unordered: ["un-1", "un-2", "un-3"],
    });
    const r = resolveReorder({ entries, from: 3, to: 1 });
    expect(r).toEqual({ kind: "noop" });
  });

  it("matches dnd-kit's drag-down-to-bottom semantics: ord-1 over ord-3 lands BELOW ord-3", () => {
    const r = resolveReorder({ entries: baseEntries(), from: 1, to: 3 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 4 });
  });

  it("matches dnd-kit's drag-up-to-top semantics: ord-3 over ord-1 lands ABOVE ord-1", () => {
    const r = resolveReorder({ entries: baseEntries(), from: 3, to: 1 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.5 });
  });

  it("does not drift the position when promoting with fractional neighbours", () => {
    const entries = buildEntries({
      ordered: [
        { id: "ord-1", position: 0.5 },
        { id: "ord-2", position: 0.75 },
      ],
      unordered: ["un-1"],
    });
    const r = resolveReorder({ entries, from: 4, to: 2 });
    expect(r).toEqual({ kind: "ordered", nextPosition: 0.625 });
  });

  it("treats a drop into the completed section as a noop", () => {
    const entries = buildEntries({
      ordered: [{ id: "ord-1", position: 1 }],
      unordered: [],
      completed: ["done-1"],
    });
    // entries: [ord-header, ord-1, comp-header, done-1]
    // Drag ord-1 (idx 1) into the completed band (idx 3).
    const r = resolveReorder({ entries, from: 1, to: 3 });
    expect(r).toEqual({ kind: "noop" });
  });
});
