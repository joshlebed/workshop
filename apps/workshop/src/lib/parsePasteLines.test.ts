import { describe, expect, test } from "vitest";
import { parsePasteLines } from "./parsePasteLines";

describe("parsePasteLines", () => {
  test("splits on newlines and trims whitespace", () => {
    expect(parsePasteLines("Dune\n Past Lives \n  Hereditary  ")).toEqual([
      "Dune",
      "Past Lives",
      "Hereditary",
    ]);
  });

  test("drops blanks and tolerates CRLF", () => {
    expect(parsePasteLines("Dune\r\n\r\nPast Lives\n\n\nHereditary\n")).toEqual([
      "Dune",
      "Past Lives",
      "Hereditary",
    ]);
  });

  test("strips numeric, dash, bullet, and asterisk leaders", () => {
    expect(
      parsePasteLines(`1. Dune
2) Past Lives
- The Bear
• Severance
* Past Imperfect`),
    ).toEqual(["Dune", "Past Lives", "The Bear", "Severance", "Past Imperfect"]);
  });

  test("preserves first-appearance order and dedupes", () => {
    expect(parsePasteLines("Dune\nPast Lives\nDune\nThe Bear\nPast Lives")).toEqual([
      "Dune",
      "Past Lives",
      "The Bear",
    ]);
  });

  test("truncates over-500-char titles instead of failing", () => {
    const long = "A".repeat(600);
    const [out] = parsePasteLines(long);
    expect(out).toHaveLength(500);
  });

  test("empty input → empty result", () => {
    expect(parsePasteLines("")).toEqual([]);
    expect(parsePasteLines("\n\n  \n")).toEqual([]);
  });
});
