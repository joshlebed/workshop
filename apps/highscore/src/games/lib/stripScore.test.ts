import { describe, expect, it } from "vitest";
import { stripScoreLabel } from "./stripScore";

describe("stripScoreLabel", () => {
  it("prints small integers as-is", () => {
    expect(stripScoreLabel({ scoreValue: 3, scoreRaw: "3/6" })).toBe("3");
    expect(stripScoreLabel({ scoreValue: 4812, scoreRaw: "" })).toBe("4812");
  });
  it("compacts large numbers", () => {
    expect(stripScoreLabel({ scoreValue: 12_500, scoreRaw: "" })).toBe("12.5k");
    expect(stripScoreLabel({ scoreValue: 10_000, scoreRaw: "" })).toBe("10k");
    expect(stripScoreLabel({ scoreValue: 250_000, scoreRaw: "" })).toBe("250k");
  });
  it("keeps one decimal when it fits", () => {
    expect(stripScoreLabel({ scoreValue: 2.5, scoreRaw: "" })).toBe("2.5");
    expect(stripScoreLabel({ scoreValue: 1234.56, scoreRaw: "" })).toBe("1235");
  });
  it("marks losses, unread shares and bare plays", () => {
    expect(stripScoreLabel({ scoreValue: null, parseStatus: "no_result", scoreRaw: "X/6" })).toBe(
      "X",
    );
    expect(stripScoreLabel({ scoreValue: null, parseStatus: "failed", scoreRaw: "??" })).toBe("?");
    expect(stripScoreLabel({ scoreValue: null, scoreRaw: "played" })).toBe("✓");
    expect(stripScoreLabel({ scoreValue: null, scoreRaw: null })).toBe("–");
  });
});
