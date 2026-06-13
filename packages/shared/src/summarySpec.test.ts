import { describe, expect, it } from "vitest";
import {
  evaluateSummarySpec,
  type SummarySpec,
  safeParseSummarySpec,
  suggestSummaryLineIndexes,
  summaryShareLines,
  synthesizeSummarySpec,
} from "./summarySpec.js";

// Real-world-shaped shares for an unknown (non-registry) game.
const MAPTAP_LIKE = [
  "www.maptap.gg May 27",
  "100🎯 95🏆 94🏅 52😔 77😂",
  "Final score: 770",
  "https://maptap.gg/?ref=abc123",
].join("\n");

const GRID_GAME = [
  "Squardle #512",
  "Streak: 14 🔥",
  "🟩🟩🟨⬜⬜",
  "🟩🟩🟩🟨⬜",
  "🟩🟩🟩🟩🟩",
  "3/6",
  "#squardle",
  "https://squardle.example.com",
].join("\n");

describe("summaryShareLines", () => {
  it("strips URLs, blank lines and hashtag-only lines, keeps original indexes", () => {
    const lines = summaryShareLines(GRID_GAME);
    expect(lines.map((l) => l.text)).toEqual([
      "Squardle #512",
      "Streak: 14 🔥",
      "🟩🟩🟨⬜⬜",
      "🟩🟩🟩🟨⬜",
      "🟩🟩🟩🟩🟩",
      "3/6",
    ]);
    expect(lines.map((l) => l.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps leading whitespace (grid alignment) but trims trailing", () => {
    const lines = summaryShareLines("  🏆  ❌  \nplain");
    expect(lines[0]?.text).toBe("  🏆  ❌");
  });

  it("drops a line that is only a URL", () => {
    const lines = summaryShareLines(MAPTAP_LIKE);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.index)).toEqual([0, 1, 2]);
  });
});

describe("evaluateSummarySpec", () => {
  it("keeps lines matching any rule, in share order", () => {
    const spec: SummarySpec = {
      rules: [
        { kind: "matchLines", pattern: "^[^A-Za-z]+$" },
        { kind: "matchLines", pattern: "^Final score:" },
      ],
    };
    expect(evaluateSummarySpec(spec, MAPTAP_LIKE)).toBe(
      "100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770",
    );
  });

  it("returns null when nothing matches", () => {
    const spec: SummarySpec = { rules: [{ kind: "matchLines", pattern: "^nope$" }] };
    expect(evaluateSummarySpec(spec, MAPTAP_LIKE)).toBeNull();
  });

  it("returns null when every rule is malformed, skips only the bad ones otherwise", () => {
    const bad: SummarySpec = { rules: [{ kind: "matchLines", pattern: "(" }] };
    expect(evaluateSummarySpec(bad, MAPTAP_LIKE)).toBeNull();
    const mixed: SummarySpec = {
      rules: [
        { kind: "matchLines", pattern: "(" },
        { kind: "matchLines", pattern: "^Final score:" },
      ],
    };
    expect(evaluateSummarySpec(mixed, MAPTAP_LIKE)).toBe("Final score: 770");
  });
});

describe("synthesizeSummarySpec", () => {
  it("reproduces a grid + score-line selection and survives next-day churn", () => {
    // Keep the grid rows and the fraction line; drop the header/streak lines.
    const spec = synthesizeSummarySpec(GRID_GAME, [2, 3, 4, 5]);
    expect(spec).not.toBeNull();
    expect(evaluateSummarySpec(spec!, GRID_GAME)).toBe("🟩🟩🟨⬜⬜\n🟩🟩🟩🟨⬜\n🟩🟩🟩🟩🟩\n3/6");

    // Tomorrow: different puzzle number, streak, grid height and score.
    const tomorrow = [
      "Squardle #513",
      "Streak: 15 🔥",
      "🟨⬜⬜⬜⬜",
      "🟩🟩🟩🟩🟩",
      "2/6",
      "https://squardle.example.com",
    ].join("\n");
    expect(evaluateSummarySpec(spec!, tomorrow)).toBe("🟨⬜⬜⬜⬜\n🟩🟩🟩🟩🟩\n2/6");
  });

  it("generalizes digits in text lines so the score line matches every day", () => {
    const spec = synthesizeSummarySpec(MAPTAP_LIKE, [1, 2]);
    expect(spec).not.toBeNull();
    const nextDay = [
      "www.maptap.gg May 28",
      "88🎯 91🏆 100🏅 64😔 70😂",
      "Final score: 938",
      "https://maptap.gg/?ref=abc123",
    ].join("\n");
    expect(evaluateSummarySpec(spec!, nextDay)).toBe("88🎯 91🏆 100🏅 64😔 70😂\nFinal score: 938");
  });

  it("falls back to line-anchored rules when only some letterless lines are kept", () => {
    const raw = "Game Title\n🟩🟩🟩\n12345\nScore: 9";
    // Keep the grid but not the bare-number line — the structural letterless
    // class would keep both, so synthesis must anchor on the lines instead.
    const spec = synthesizeSummarySpec(raw, [1, 3]);
    expect(spec).not.toBeNull();
    expect(evaluateSummarySpec(spec!, raw)).toBe("🟩🟩🟩\nScore: 9");
  });

  it("returns null for an empty selection", () => {
    expect(synthesizeSummarySpec(GRID_GAME, [])).toBeNull();
  });

  it("returns null when everything is selected (fallback already renders that)", () => {
    expect(synthesizeSummarySpec(GRID_GAME, [0, 1, 2, 3, 4, 5])).toBeNull();
  });

  it("round-trips through the wire-format validator", () => {
    const spec = synthesizeSummarySpec(GRID_GAME, [2, 3, 4, 5]);
    expect(safeParseSummarySpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
  });
});

describe("safeParseSummarySpec", () => {
  it("rejects malformed values", () => {
    expect(safeParseSummarySpec(null)).toBeNull();
    expect(safeParseSummarySpec({})).toBeNull();
    expect(safeParseSummarySpec({ rules: [] })).toBeNull();
    expect(safeParseSummarySpec({ rules: [{ kind: "matchLines", pattern: "(" }] })).toBeNull();
    expect(safeParseSummarySpec({ rules: [{ kind: "other", pattern: "x" }] })).toBeNull();
    expect(
      safeParseSummarySpec({ rules: [{ kind: "matchLines", pattern: "x", extra: 1 }] }),
    ).toBeNull();
  });

  it("accepts a valid spec", () => {
    const spec = { rules: [{ kind: "matchLines", pattern: "^[^A-Za-z]+$" }] };
    expect(safeParseSummarySpec(spec)).toEqual(spec);
  });
});

describe("suggestSummaryLineIndexes", () => {
  it("keeps grid lines and the tapped score's line, drops headers", () => {
    const offset = GRID_GAME.indexOf("3/6");
    expect(suggestSummaryLineIndexes(GRID_GAME, offset)).toEqual([2, 3, 4, 5]);
  });

  it("keeps the score line even when it carries text", () => {
    const offset = MAPTAP_LIKE.indexOf("770");
    expect(suggestSummaryLineIndexes(MAPTAP_LIKE, offset)).toEqual([1, 2]);
  });

  it("keeps everything when the heuristic finds nothing", () => {
    const raw = "I reached level twelve today";
    expect(suggestSummaryLineIndexes(raw)).toEqual([0]);
  });
});
