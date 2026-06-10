import { describe, expect, it } from "vitest";
import { cleanGameTitle, defaultGameIconUrl } from "./gameCatalog.js";

describe("cleanGameTitle", () => {
  it("passes short titles through (hyphenated names survive)", () => {
    expect(cleanGameTitle("Wordle")).toBe("Wordle");
    expect(cleanGameTitle("Cross-wordle")).toBe("Cross-wordle");
  });

  it("collapses whitespace and trims", () => {
    expect(cleanGameTitle("  Daily\n  Tens \t")).toBe("Daily Tens");
  });

  it("keeps the segment before the separator on long page titles", () => {
    expect(cleanGameTitle("Wordle — The New York Times Games And Puzzles Hub")).toBe("Wordle");
    expect(cleanGameTitle("Globle | Guess the Mystery Country in This Daily Game")).toBe("Globle");
    expect(
      cleanGameTitle("Travle - the daily geography game where you travel between countries"),
    ).toBe("Travle");
  });

  it("caps runaway titles", () => {
    const long = "A".repeat(200);
    const cleaned = cleanGameTitle(long);
    expect(cleaned?.length).toBeLessThanOrEqual(80);
    expect(cleaned?.endsWith("…")).toBe(true);
  });

  it("returns null for empty input", () => {
    expect(cleanGameTitle(null)).toBeNull();
    expect(cleanGameTitle("   ")).toBeNull();
  });
});

describe("defaultGameIconUrl", () => {
  it("uses the host segment of the normalized URL", () => {
    expect(defaultGameIconUrl("nytimes.com/games/wordle")).toBe(
      "https://www.google.com/s2/favicons?domain=nytimes.com&sz=128",
    );
  });

  it("strips a port", () => {
    expect(defaultGameIconUrl("example.com:8080/daily")).toBe(
      "https://www.google.com/s2/favicons?domain=example.com&sz=128",
    );
  });
});
