import { describe, expect, it } from "vitest";
import { actionBarBottomPadding } from "./actionBar";

describe("actionBarBottomPadding", () => {
  it("uses the bar's own breathing room when the device has no bottom inset", () => {
    expect(actionBarBottomPadding(0, 12)).toBe(12);
  });

  it("clears the home indicator when the inset is larger", () => {
    expect(actionBarBottomPadding(34, 12)).toBe(34);
  });
});
