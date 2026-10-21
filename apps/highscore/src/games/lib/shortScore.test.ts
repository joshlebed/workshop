import { describe, expect, it } from "vitest";
import { ordinal, shortScore } from "./shortScore";

const score = (scoreSummary: string | null, scoreValue: number | null = null) => ({
  parseStatus: "score" as const,
  scoreSummary,
  scoreValue,
  scoreRaw: scoreSummary,
});

describe("shortScore", () => {
  it("keeps fractions", () => {
    expect(shortScore(score("Wordle 1,936 6/6*\n🟩⬛⬛⬛🟩", 6))).toBe("6/6");
    expect(shortScore(score("🟥🟥🟥🟥🟩⬜ 5/6", 5))).toBe("5/6");
    expect(shortScore(score("Wordle 1,936 X/6", null))).toBe("X/6");
  });
  it("takes the number off a labelled last line", () => {
    expect(shortScore(score("100🎯 93🏆 89🎉 97🔥 80🌞\nFinal score: 902", 902))).toBe("902");
  });
  it("keeps short human tails and folds keycaps", () => {
    expect(shortScore(score("✅🟧✅✅ +1", 1))).toBe("+1");
    expect(shortScore(score("0️⃣:4️⃣5️⃣", 45))).toBe("0:45");
    expect(shortScore(score("🟨🟧🟥🟥🟥🟥🟩 = 7", 7))).toBe("7");
  });
  it("falls back to the numeric value for emoji-only recaps", () => {
    expect(shortScore(score("🏆🏆❌🏆🏆\n🏆🏆❌❌🏆", 7))).toBe("7");
    expect(shortScore(score("Geozee #91 — 676/798 · top 47% 🌍\n🇮🇶", 676))).toBe("676/798");
  });
  it("marks losses and unread rows", () => {
    expect(
      shortScore({ parseStatus: "no_result", scoreSummary: "x", scoreValue: null, scoreRaw: "x" }),
    ).toBe("✗");
    expect(
      shortScore({ parseStatus: "failed", scoreSummary: null, scoreValue: null, scoreRaw: "x" }),
    ).toBe("?");
  });
  it("handles legacy rows with only a value or only text", () => {
    expect(shortScore({ scoreSummary: undefined, scoreValue: 1234, scoreRaw: "..." })).toBe(
      "1,234",
    );
    expect(shortScore({ scoreSummary: undefined, scoreValue: null, scoreRaw: null })).toBe("—");
  });
});

describe("ordinal", () => {
  it("formats english ordinals in caps", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      "1ST",
      "2ND",
      "3RD",
      "4TH",
      "11TH",
      "12TH",
      "13TH",
      "21ST",
      "22ND",
      "101ST",
    ]);
  });
});
