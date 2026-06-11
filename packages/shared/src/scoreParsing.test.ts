import { describe, expect, it } from "vitest";
import {
  evaluateScoreSpec,
  parseFirstNumber,
  parseScoreWithSpec,
  SCORE_COUNT_PREFIX,
  SCORE_SPEC_PREFIX,
  type ScoreSpec,
  safeParseScoreSpec,
  specFromStoredRule,
  storedRuleFromSpec,
  suggestScoreDirection,
  synthesizeScoreSpec,
  tokenizeScoreCandidates,
} from "./scoreParsing.js";

const spec = (rules: ScoreSpec["rules"]): ScoreSpec => ({ rules });

describe("capture rule", () => {
  it("reads capture group 1 as the score", () => {
    const s = spec([{ kind: "capture", pattern: "Final score:\\s*(\\d+)" }]);
    expect(parseScoreWithSpec(s, "www.maptap.gg June 11\nFinal score: 938")).toBe(938);
  });

  it("strips thousands separators (GeoSports `1,000`)", () => {
    const s = spec([{ kind: "capture", pattern: "([\\d,]+)\\s*/\\s*[\\d,]+" }]);
    expect(parseScoreWithSpec(s, "1,000 / 1,000")).toBe(1000);
  });

  it("returns null when the pattern doesn't match — no silent fallback", () => {
    const s = spec([{ kind: "capture", pattern: "Wordle\\s+[\\d,]+\\s+(\\d+)/6" }]);
    // A failed Wordle is X/6 — no numeric score.
    expect(parseScoreWithSpec(s, "Wordle 1,127 X/6")).toBe(null);
  });

  it("is case-insensitive", () => {
    const s = spec([{ kind: "capture", pattern: "score\\s*(\\d+)" }]);
    expect(parseScoreWithSpec(s, "SCORE 42")).toBe(42);
  });
});

describe("count rule", () => {
  const dailyTens = spec([{ kind: "count", token: "🏆", within: "[🏆❌]" }]);

  it("counts trophies in a Daily Tens grid (URL ref id ignored)", () => {
    const raw =
      "DailyTens #766\n\n     🏆    🏆\n     🏆    🏆\n     🏆    ❌\n     ❌    ❌\n     🏆    🏆 https://dailytens.com/?ref=527216";
    expect(parseScoreWithSpec(dailyTens, raw)).toBe(7);
  });

  it("scores a legitimate 0 for an all-❌ grid", () => {
    expect(parseScoreWithSpec(dailyTens, "DailyTens #1\n❌ ❌\n❌ ❌")).toBe(0);
  });

  it("yields null (not 0) for a URL-only share when `within` is set", () => {
    expect(parseScoreWithSpec(dailyTens, "https://dailytens.com/?ref=944415")).toBe(null);
  });

  it("counts 0 without a `within` guard (legacy count: behavior)", () => {
    const s = spec([{ kind: "count", token: "🏆" }]);
    expect(parseScoreWithSpec(s, "no trophies here")).toBe(0);
  });
});

describe("countLines rule", () => {
  const connections = spec([{ kind: "countLines", pattern: "^[🟨🟩🟦🟪]{4}$" }]);

  it("counts Connections guess rows (perfect game = 4)", () => {
    const raw = "Connections\nPuzzle #745\n🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪";
    expect(parseScoreWithSpec(connections, raw)).toBe(4);
  });

  it("counts mistake rows too (mixed rows still count as guesses)", () => {
    const raw = "Connections\nPuzzle #745\n🟨🟨🟩🟨\n🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪";
    expect(parseScoreWithSpec(connections, raw)).toBe(5);
  });

  it("yields null (not 0) when no line matches — no grid means no result", () => {
    expect(parseScoreWithSpec(connections, "https://nytimes.com/games/connections")).toBe(null);
  });
});

describe("duration rule", () => {
  const mini = spec([{ kind: "duration" }]);

  it("parses m:ss into seconds (NYT Mini, date in text is not a trap)", () => {
    const raw = "I solved the 6/10/2026 New York Times Mini Crossword in 0:30!";
    expect(parseScoreWithSpec(mini, raw)).toBe(30);
  });

  it("parses minutes and seconds", () => {
    expect(parseScoreWithSpec(mini, "done in 12:05")).toBe(725);
  });

  it("parses h:mm:ss", () => {
    expect(parseScoreWithSpec(mini, "marathon: 1:02:33")).toBe(3753);
  });

  it("returns null when there is no time", () => {
    expect(parseScoreWithSpec(mini, "I played the Mini today")).toBe(null);
  });
});

describe("tokenPosition rule", () => {
  const framed = spec([{ kind: "tokenPosition", token: "🟩", among: ["🟥", "⬛", "⬜"] }]);

  it("scores Framed by the position of 🟩 among the squares", () => {
    expect(parseScoreWithSpec(framed, "Framed #1234\n🎥 🟥 🟥 🟩 ⬛ ⬛ ⬛")).toBe(3);
  });

  it("a first-guess win scores 1", () => {
    expect(parseScoreWithSpec(framed, "Framed #1234\n🎥 🟩 ⬛ ⬛ ⬛ ⬛ ⬛")).toBe(1);
  });

  it("a loss (no 🟩) has no numeric score", () => {
    expect(parseScoreWithSpec(framed, "Framed #1234\n🎥 🟥 🟥 🟥 🟥 🟥 🟥")).toBe(null);
  });

  it("ignores non-square emoji before the grid (the 🎥 header)", () => {
    // 🎥 is not in `among`, so it doesn't shift the position.
    expect(parseScoreWithSpec(framed, "🎥 🟩")).toBe(1);
  });
});

describe("wordMap rule", () => {
  const bee = spec([
    {
      kind: "wordMap",
      pattern: "hit\\s+([A-Za-z ]{2,20}?)\\s+on",
      map: { genius: 9, "queen bee": 10, amazing: 8 },
    },
  ]);

  it("maps a rank word case-insensitively", () => {
    expect(parseScoreWithSpec(bee, "I just hit Genius on Spelling Bee.")).toBe(9);
  });

  it("maps multi-word ranks with whitespace normalization", () => {
    expect(parseScoreWithSpec(bee, "I just hit Queen  Bee on Spelling Bee.")).toBe(10);
  });

  it("returns null for an unmapped word", () => {
    expect(parseScoreWithSpec(bee, "I just hit Nice on Spelling Bee.")).toBe(null);
  });
});

describe("evaluateScoreSpec", () => {
  it("first matching rule wins", () => {
    const s = spec([
      { kind: "capture", pattern: "score:\\s*(\\d+)" },
      { kind: "capture", pattern: "(\\d+)" },
    ]);
    expect(parseScoreWithSpec(s, "round 9, score: 42")).toBe(42);
  });

  it("falls through a non-matching rule to the next", () => {
    const s = spec([
      { kind: "capture", pattern: "score:\\s*(\\d+)" },
      { kind: "count", token: "⭐" },
    ]);
    expect(parseScoreWithSpec(s, "⭐⭐⭐")).toBe(3);
  });

  it("reports hadValidRule: false when every rule is malformed", () => {
    const s = spec([{ kind: "capture", pattern: "([unclosed" }]);
    expect(evaluateScoreSpec(s, "anything 42")).toEqual({ value: null, hadValidRule: false });
  });

  it("a malformed rule is skipped, not fatal", () => {
    const s = spec([
      { kind: "capture", pattern: "([unclosed" },
      { kind: "capture", pattern: "(\\d+)" },
    ]);
    expect(parseScoreWithSpec(s, "42")).toBe(42);
  });
});

describe("stored-rule strings (legacy compatibility)", () => {
  it("decodes a bare regex source as a capture rule", () => {
    const s = specFromStoredRule("Final score:\\s*(\\d+)");
    expect(s).toEqual(spec([{ kind: "capture", pattern: "Final score:\\s*(\\d+)" }]));
  });

  it("decodes count:🏆 as a count rule (no within — legacy counts 0)", () => {
    expect(specFromStoredRule(`${SCORE_COUNT_PREFIX}🏆`)).toEqual(
      spec([{ kind: "count", token: "🏆" }]),
    );
  });

  it("decodes a spec: JSON envelope", () => {
    const original = spec([{ kind: "duration" }]);
    const stored = `${SCORE_SPEC_PREFIX}${JSON.stringify(original)}`;
    expect(specFromStoredRule(stored)).toEqual(original);
  });

  it("returns null for empty/null/invalid", () => {
    expect(specFromStoredRule(null)).toBe(null);
    expect(specFromStoredRule("")).toBe(null);
    expect(specFromStoredRule(`${SCORE_SPEC_PREFIX}{not json`)).toBe(null);
    expect(specFromStoredRule(`${SCORE_SPEC_PREFIX}{"rules":[]}`)).toBe(null);
  });

  it("round-trips: single capture/count specs use the legacy formats", () => {
    const capture = spec([{ kind: "capture", pattern: "(\\d+)/6" }]);
    expect(storedRuleFromSpec(capture)).toBe("(\\d+)/6");
    const count = spec([{ kind: "count", token: "🏆" }]);
    expect(storedRuleFromSpec(count)).toBe(`${SCORE_COUNT_PREFIX}🏆`);
    const guarded = spec([{ kind: "count", token: "🏆", within: "[🏆❌]" }]);
    expect(storedRuleFromSpec(guarded)).toBe(`${SCORE_SPEC_PREFIX}${JSON.stringify(guarded)}`);
    for (const s of [capture, count, guarded]) {
      expect(specFromStoredRule(storedRuleFromSpec(s))).toEqual(s);
    }
  });
});

describe("safeParseScoreSpec", () => {
  it("accepts a valid spec", () => {
    expect(safeParseScoreSpec({ rules: [{ kind: "count", token: "🏆" }] })).toEqual(
      spec([{ kind: "count", token: "🏆" }]),
    );
  });

  it("rejects non-compiling patterns", () => {
    expect(safeParseScoreSpec({ rules: [{ kind: "capture", pattern: "([oops" }] })).toBe(null);
  });

  it("rejects unknown rule kinds and extra fields", () => {
    expect(safeParseScoreSpec({ rules: [{ kind: "eval", code: "1+1" }] })).toBe(null);
    expect(safeParseScoreSpec({ rules: [{ kind: "count", token: "🏆", extra: true }] })).toBe(null);
  });

  it("rejects empty and oversized rule lists", () => {
    expect(safeParseScoreSpec({ rules: [] })).toBe(null);
    const many = Array.from({ length: 9 }, () => ({ kind: "count", token: "x" }));
    expect(safeParseScoreSpec({ rules: many })).toBe(null);
  });
});

describe("parseFirstNumber", () => {
  it("reads the first number anywhere (the legacy last resort)", () => {
    expect(parseFirstNumber("round 12 of 30")).toBe(12);
    expect(parseFirstNumber("-3.5 degrees")).toBe(-3.5);
    expect(parseFirstNumber("no numbers")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Synthesis (the self-serve "tap your score" flow)
// ---------------------------------------------------------------------------

describe("tokenizeScoreCandidates", () => {
  it("never offers numbers inside URLs (referral ids are not scores)", () => {
    const candidates = tokenizeScoreCandidates("https://dailytens.com/?ref=944415");
    expect(candidates.filter((c) => c.kind !== "emojiCount")).toEqual([]);
  });

  it("finds durations, fractions, plus-scores, numbers and emoji tallies", () => {
    const raw = "Solved in 0:42 — 3/6, +2 extra, total 950\n🏆🏆❌";
    const kinds = tokenizeScoreCandidates(raw).map((c) => [c.kind, c.value]);
    expect(kinds).toContainEqual(["duration", 42]);
    expect(kinds).toContainEqual(["fraction", 3]);
    expect(kinds).toContainEqual(["plus", 2]);
    expect(kinds).toContainEqual(["number", 950]);
    expect(kinds).toContainEqual(["emojiCount", 2]); // 🏆 × 2
    expect(kinds).toContainEqual(["emojiCount", 1]); // ❌ × 1
  });

  it("does not double-report the parts of a fraction or duration as bare numbers", () => {
    const candidates = tokenizeScoreCandidates("3/6 in 0:42");
    const numbers = candidates.filter((c) => c.kind === "number");
    expect(numbers).toEqual([]);
  });
});

describe("synthesizeScoreSpec", () => {
  // A made-up game the registry doesn't know — the self-serve case.
  const raw = "DoodleDash June 11\n🟢🟢🔴\nRound points: 850\nBest streak 12\nwww.doodledash.io";

  it("synthesizes an anchored capture from a tapped number", () => {
    const candidates = tokenizeScoreCandidates(raw);
    const points = candidates.find((c) => c.kind === "number" && c.value === 850);
    expect(points).toBeDefined();
    const s = synthesizeScoreSpec(raw, points!);
    expect(s).not.toBe(null);
    expect(parseScoreWithSpec(s!, raw)).toBe(850);
    // The anchor must survive a different day's share with different values.
    const nextDay =
      "DoodleDash June 12\n🔴🔴🔴\nRound points: 430\nBest streak 13\nwww.doodledash.io";
    expect(parseScoreWithSpec(s!, nextDay)).toBe(430);
  });

  it("synthesizes a guarded count from a tapped emoji tally", () => {
    const grid = "DoodleDash #5\n🟢🟢🔴";
    const tally = tokenizeScoreCandidates(grid).find(
      (c) => c.kind === "emojiCount" && c.text === "🟢",
    );
    const s = synthesizeScoreSpec(grid, tally!);
    expect(s).not.toBe(null);
    expect(parseScoreWithSpec(s!, grid)).toBe(2);
    // URL-only share parses to null, not 0 — the `within` guard.
    expect(parseScoreWithSpec(s!, "https://doodledash.io/?ref=99")).toBe(null);
  });

  it("synthesizes a duration rule from a tapped time", () => {
    const share = "I finished today's puzzle in 1:23!";
    const time = tokenizeScoreCandidates(share).find((c) => c.kind === "duration");
    const s = synthesizeScoreSpec(share, time!);
    expect(s).toEqual(spec([{ kind: "duration" }]));
    expect(parseScoreWithSpec(s!, share)).toBe(83);
  });

  it("synthesizes a denominator-anchored capture from a tapped fraction", () => {
    const share = "Quizzle #88 4/6\n🟩🟩🟩🟩";
    const frac = tokenizeScoreCandidates(share).find((c) => c.kind === "fraction");
    const s = synthesizeScoreSpec(share, frac!);
    expect(s).not.toBe(null);
    expect(parseScoreWithSpec(s!, "Quizzle #89 2/6")).toBe(2);
  });

  it("synthesizes a plus capture", () => {
    const share = "#hopple #12 +3\n✅✅🟧";
    const plus = tokenizeScoreCandidates(share).find((c) => c.kind === "plus");
    const s = synthesizeScoreSpec(share, plus!);
    expect(s).not.toBe(null);
    expect(parseScoreWithSpec(s!, "#hopple #13 +0")).toBe(0);
  });

  it("only returns specs that reproduce the tapped value on the example", () => {
    // Whatever it returns, the contract holds; null is acceptable too.
    for (const c of tokenizeScoreCandidates(raw)) {
      const s = synthesizeScoreSpec(raw, c);
      if (s) expect(parseScoreWithSpec(s, raw)).toBe(c.value);
    }
  });
});

describe("suggestScoreDirection", () => {
  it("suggests asc for times/fractions/plus, desc otherwise", () => {
    const raw = "0:42 3/6 +2 950 🏆🏆";
    const byKind = new Map(tokenizeScoreCandidates(raw).map((c) => [c.kind, c]));
    expect(suggestScoreDirection(byKind.get("duration")!)).toBe("asc");
    expect(suggestScoreDirection(byKind.get("fraction")!)).toBe("asc");
    expect(suggestScoreDirection(byKind.get("plus")!)).toBe("asc");
    expect(suggestScoreDirection(byKind.get("number")!)).toBe("desc");
    expect(suggestScoreDirection(byKind.get("emojiCount")!)).toBe("desc");
  });
});
