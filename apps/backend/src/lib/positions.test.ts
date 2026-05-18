import { describe, expect, it } from "vitest";
import { computeBetween, REBALANCE_FLOOR, shouldRebalanceForOverflow } from "./positions.js";

describe("computeBetween — sparse-integer allocator math", () => {
  it("returns the spacing when both bounds are null (first item)", () => {
    expect(computeBetween(null, null)).toBe(1024);
  });

  it("subtracts spacing from upper when there's no lower (insert at top)", () => {
    expect(computeBetween(null, 4096)).toBe(3072);
  });

  it("adds spacing to lower when there's no upper (append to bottom)", () => {
    expect(computeBetween(2048, null)).toBe(3072);
  });

  it("returns the midpoint when there's room between bounds", () => {
    expect(computeBetween(1024, 2048)).toBe(1536);
  });

  it("floors midpoints rather than producing a fractional position", () => {
    expect(computeBetween(0, 3)).toBe(1);
    expect(computeBetween(10, 13)).toBe(11);
  });

  it("returns null on a 1-gap collision (callers rebalance and retry)", () => {
    expect(computeBetween(5, 6)).toBeNull();
  });

  it("returns null when bounds are identical (degenerate collision)", () => {
    expect(computeBetween(7, 7)).toBeNull();
  });

  it("handles negative bounds (move-to-top forever produces negatives)", () => {
    expect(computeBetween(-2048, 0)).toBe(-1024);
    expect(computeBetween(null, -1024)).toBe(-2048);
  });
});

describe("shouldRebalanceForOverflow", () => {
  it("returns false when no ordered items exist (min=null)", () => {
    expect(shouldRebalanceForOverflow(null)).toBe(false);
  });

  it("returns false for fresh positive positions", () => {
    expect(shouldRebalanceForOverflow(1024)).toBe(false);
    expect(shouldRebalanceForOverflow(1_000_000)).toBe(false);
  });

  it("returns false for modest negatives (move-to-top a few times)", () => {
    expect(shouldRebalanceForOverflow(-2048)).toBe(false);
    expect(shouldRebalanceForOverflow(-1_000_000)).toBe(false);
  });

  it("triggers when the min sinks past the floor", () => {
    expect(shouldRebalanceForOverflow(REBALANCE_FLOOR - 1)).toBe(true);
    expect(shouldRebalanceForOverflow(REBALANCE_FLOOR - 1024)).toBe(true);
  });

  it("does not trigger exactly at the floor (boundary)", () => {
    expect(shouldRebalanceForOverflow(REBALANCE_FLOOR)).toBe(false);
  });

  it("REBALANCE_FLOOR is at -10^9 per the redesign spec", () => {
    expect(REBALANCE_FLOOR).toBe(-1_000_000_000);
  });
});
