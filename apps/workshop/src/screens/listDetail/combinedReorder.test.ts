import type { Item } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import { neighborsForOrderedReorder } from "../../lib/albumShelfPositions";
import { resolveCombinedReorder } from "./combinedReorder";

function row(id: string): Item {
  return { id } as unknown as Item;
}

const A = row("A");
const B = row("B");
const C = row("C");
const U = row("U");
const V = row("V");

// combined = [A, B, C, U, V], ranked block = [A, B, C]
const combined = [A, B, C, U, V];
const ORDERED = 3;

function move(from: number, to: number) {
  const r = resolveCombinedReorder(combined, ORDERED, from, to);
  if (!r) return null;
  return { id: r.item.id, before: r.beforeItemId, after: r.afterItemId };
}

describe("resolveCombinedReorder — reorder within the ranked block", () => {
  it("drag a ranked row down stays ranked, matching neighborsForOrderedReorder", () => {
    // [A,B,C] move A(0) → 1 → between B and C
    expect(move(0, 1)).toEqual({ id: "A", before: "B", after: "C" });
    expect(neighborsForOrderedReorder([A, B, C], 0, 1)).toEqual({ before: B, after: C });
  });

  it("drag a ranked row to the top", () => {
    // [A,B,C] move C(2) → 0 → before null, after A
    expect(move(2, 0)).toEqual({ id: "C", before: null, after: "A" });
    expect(neighborsForOrderedReorder([A, B, C], 2, 0)).toEqual({ before: null, after: A });
  });

  it("drag a ranked row to the bottom of the ranked block", () => {
    // [A,B,C] move A(0) → 2 → after C, and the first unranked row collapses to null
    expect(move(0, 2)).toEqual({ id: "A", before: "C", after: null });
  });
});

describe("resolveCombinedReorder — promote from unranked into the ranked block", () => {
  it("promotes to the very top (above rank 1)", () => {
    // move U(3) → 0 → [U,A,B,C,V]: before null, after A
    expect(move(3, 0)).toEqual({ id: "U", before: null, after: "A" });
  });

  it("promotes between two ranked rows", () => {
    // move U(3) → 1 → [A,U,B,C,V]: between A and B
    expect(move(3, 1)).toEqual({ id: "U", before: "A", after: "B" });
  });

  it("promotes to the end of the ranked block (drop just past the last ranked row)", () => {
    // move U(3) → 3 is a no-op (from===to); dropping onto C's slot promotes below C.
    // move V(4) → 3 → [A,B,C,V,U]: above is C (ranked) → appends after C
    expect(move(4, 3)).toEqual({ id: "V", before: "C", after: null });
  });
});

describe("resolveCombinedReorder — demote from ranked to unranked", () => {
  it("demotes when a ranked row is dropped into the unranked region", () => {
    // move A(0) → 4 → [B,C,U,V,A]: lands below unranked rows → demote
    expect(move(0, 4)).toEqual({ id: "A", before: null, after: null });
  });

  it("demotes when a ranked row is dropped just past the boundary", () => {
    // move C(2) → 3 → [A,B,U,C,V]: above is U (unranked) → demote
    expect(move(2, 3)).toEqual({ id: "C", before: null, after: null });
  });
});

describe("resolveCombinedReorder — no-ops", () => {
  it("returns null for an unranked → unranked move (bucket has no persisted order)", () => {
    // move U(3) → 4 → [A,B,C,V,U]: stays unranked → nothing to send
    expect(move(3, 4)).toBeNull();
  });

  it("returns null when from === to", () => {
    expect(move(2, 2)).toBeNull();
  });

  it("returns null for out-of-range indices", () => {
    expect(resolveCombinedReorder(combined, ORDERED, -1, 2)).toBeNull();
    expect(resolveCombinedReorder(combined, ORDERED, 2, 99)).toBeNull();
  });
});

describe("resolveCombinedReorder — single ranked row", () => {
  // combined = [A, U, V], ranked block = [A]
  const single = [A, U, V];
  it("promotes an unranked row above the lone ranked row", () => {
    // move U(1) → 0 → [U,A,V]: before null, after A
    expect(resolveCombinedReorder(single, 1, 1, 0)).toMatchObject({
      beforeItemId: null,
      afterItemId: "A",
    });
  });

  it("demotes the lone ranked row", () => {
    // move A(0) → 2 → [U,V,A]: demote
    expect(resolveCombinedReorder(single, 1, 0, 2)).toMatchObject({
      beforeItemId: null,
      afterItemId: null,
    });
  });
});
