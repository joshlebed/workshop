import type { Item } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import { neighborsForOrderedReorder } from "./albumShelfPositions";

function row(id: string): Item {
  return { id } as unknown as Item;
}

const A = row("A");
const B = row("B");
const C = row("C");
const D = row("D");
const list = [A, B, C, D];

describe("neighborsForOrderedReorder", () => {
  it("drag down by one — neighbors are the displaced row and its successor", () => {
    // [A,B,C,D] move A(0) → 1 → [B,A,C,D]: between B and C
    expect(neighborsForOrderedReorder(list, 0, 1)).toEqual({ before: B, after: C });
  });

  it("drag down past several rows", () => {
    // [A,B,C,D] move A(0) → 2 → [B,C,A,D]: between C and D
    expect(neighborsForOrderedReorder(list, 0, 2)).toEqual({ before: C, after: D });
  });

  it("drag up by one", () => {
    // [A,B,C,D] move C(2) → 1 → [A,C,B,D]: between A and B
    expect(neighborsForOrderedReorder(list, 2, 1)).toEqual({ before: A, after: B });
  });

  it("drag up past several rows", () => {
    // [A,B,C,D] move D(3) → 1 → [A,D,B,C]: between A and B
    expect(neighborsForOrderedReorder(list, 3, 1)).toEqual({ before: A, after: B });
  });

  it("drag to the top", () => {
    // [A,B,C,D] move C(2) → 0 → [C,A,B,D]: nothing before, A after
    expect(neighborsForOrderedReorder(list, 2, 0)).toEqual({ before: null, after: A });
  });

  it("drag to the bottom", () => {
    // [A,B,C,D] move A(0) → 3 → [B,C,D,A]: D before, nothing after
    expect(neighborsForOrderedReorder(list, 0, 3)).toEqual({ before: D, after: null });
  });

  it("returns null for a no-op", () => {
    expect(neighborsForOrderedReorder(list, 1, 1)).toBeNull();
  });

  it("returns null for out-of-range indices", () => {
    expect(neighborsForOrderedReorder(list, -1, 0)).toBeNull();
    expect(neighborsForOrderedReorder(list, 0, 4)).toBeNull();
    expect(neighborsForOrderedReorder([], 0, 0)).toBeNull();
  });
});
