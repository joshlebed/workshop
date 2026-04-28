import { describe, expect, it } from "vitest";
import { computeNewItemsDelta } from "./newItemsPill";

describe("computeNewItemsDelta", () => {
  const baseline = { scrollY: 500, threshold: 120 };

  it("returns 0 when previousLength is null (first observation)", () => {
    expect(computeNewItemsDelta({ ...baseline, previousLength: null, currentLength: 5 })).toBe(0);
  });

  it("returns 0 when the user is at the top (scrollY <= threshold)", () => {
    expect(
      computeNewItemsDelta({
        previousLength: 3,
        currentLength: 7,
        scrollY: 0,
        threshold: 120,
      }),
    ).toBe(0);
    expect(
      computeNewItemsDelta({
        previousLength: 3,
        currentLength: 7,
        scrollY: 120,
        threshold: 120,
      }),
    ).toBe(0);
  });

  it("returns the positive delta when scrolled past the threshold", () => {
    expect(computeNewItemsDelta({ ...baseline, previousLength: 3, currentLength: 7 })).toBe(4);
    expect(computeNewItemsDelta({ ...baseline, previousLength: 0, currentLength: 1 })).toBe(1);
  });

  it("returns 0 when the count is unchanged or shrunk", () => {
    expect(computeNewItemsDelta({ ...baseline, previousLength: 5, currentLength: 5 })).toBe(0);
    expect(computeNewItemsDelta({ ...baseline, previousLength: 5, currentLength: 3 })).toBe(0);
  });
});
