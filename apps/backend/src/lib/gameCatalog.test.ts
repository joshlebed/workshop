import { describe, expect, it } from "vitest";
import { cleanGameTitle, defaultGameIconUrl, titleLooksLikeTagline } from "./gameCatalog.js";

describe("cleanGameTitle", () => {
  it("passes short titles through (hyphenated names survive)", () => {
    expect(cleanGameTitle("Wordle")).toBe("Wordle");
    expect(cleanGameTitle("Cross-wordle")).toBe("Cross-wordle");
  });

  it("collapses whitespace and trims", () => {
    expect(cleanGameTitle("  Daily\n  Tens \t")).toBe("Daily Tens");
  });

  it("keeps the segment before the separator on short taglines too (prod backtest 2026-11-02)", () => {
    expect(cleanGameTitle("Krillion · the daily dive")).toBe("Krillion");
    expect(cleanGameTitle("Size It Up | Magnitudle")).toBe("Size It Up");
    expect(cleanGameTitle("Fermi: The Daily Estimation Puzzle Game")).toBe("Fermi");
    expect(cleanGameTitle("Spotle: Music Wordle Game")).toBe("Spotle");
    expect(cleanGameTitle("Le Mot - Wordle en français")).toBe("Le Mot");
    expect(cleanGameTitle("Satle - A daily geography puzzle")).toBe("Satle");
    // A bare colon inside a name (no space after) is not a separator.
    expect(cleanGameTitle("Re:Play")).toBe("Re:Play");
  });

  it("falls back to og:site_name when the title is still a sentence", () => {
    expect(cleanGameTitle("Guess the song, one instrument at a time", "Bandle")).toBe("Bandle");
    expect(
      cleanGameTitle("Play Strands, our newest word-search game with a twist.", "Strands"),
    ).toBe("Strands");
    // No usable site name (hostname fallback / missing) → the sentence stays.
    expect(cleanGameTitle("Guess the song, one instrument at a time", "bandle.app")).toBe(
      "Guess the song, one instrument at a time",
    );
    expect(cleanGameTitle("Guess the song, one instrument at a time")).toBe(
      "Guess the song, one instrument at a time",
    );
    // Short titles never swap to the site name.
    expect(cleanGameTitle("Farflung Geography Game", "Farflung")).toBe("Farflung Geography Game");
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

describe("titleLooksLikeTagline", () => {
  it("flags separators and sentences, passes names", () => {
    expect(titleLooksLikeTagline("Krillion · the daily dive")).toBe(true);
    expect(titleLooksLikeTagline("Guess the song, one instrument at a time")).toBe(true);
    expect(titleLooksLikeTagline("Fermi: The Daily Estimation Puzzle Game")).toBe(true);
    expect(titleLooksLikeTagline("Minute Cryptic")).toBe(false);
    expect(titleLooksLikeTagline("Farflung Geography Game")).toBe(false);
    expect(titleLooksLikeTagline("Cross-wordle")).toBe(false);
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
