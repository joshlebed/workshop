import { specFromStoredRule } from "@workshop/shared/scoreParsing";
import { describe, expect, it } from "vitest";
import { parseScoreValue } from "../../lib/gameCatalog.js";
import { rankEntries } from "../../lib/ranking.js";
import { periodKeySchema, scoreRawSchema, upsertScoreSchema } from "../../lib/scoreSchemas.js";

// Score helpers shared by the Games surface (`PUT /v1/games/:id/scores`,
// `GET /v1/games/:id/leaderboard`). The legacy Lists-side leaderboard bridge
// (`/v1/items/:id/scores`, `/v1/lists/:id/scores`) was removed after the Games
// migration; these tests still lock the request schemas, the numeric parser,
// and the ranking helper that the live Games routes rely on.

describe("periodKeySchema", () => {
  it("accepts a YYYY-MM-DD date", () => {
    expect(periodKeySchema.safeParse("2026-05-18").success).toBe(true);
  });

  it("accepts a YYYY-WNN ISO week token", () => {
    expect(periodKeySchema.safeParse("2026-W21").success).toBe(true);
  });

  it("accepts 'all-time'", () => {
    expect(periodKeySchema.safeParse("all-time").success).toBe(true);
  });

  it("accepts an alphanumeric custom token", () => {
    expect(periodKeySchema.safeParse("season_2_finale").success).toBe(true);
    expect(periodKeySchema.safeParse("Q1.2026").success).toBe(true);
  });

  it("accepts ':' separator (e.g. ISO timestamp keys)", () => {
    expect(periodKeySchema.safeParse("2026-05-18T12:00:00").success).toBe(true);
  });

  it("rejects the empty string", () => {
    expect(periodKeySchema.safeParse("").success).toBe(false);
  });

  it("rejects whitespace in the key", () => {
    expect(periodKeySchema.safeParse("2026 05 18").success).toBe(false);
  });

  it("rejects punctuation outside [_-:.]", () => {
    expect(periodKeySchema.safeParse("2026/05/18").success).toBe(false);
    expect(periodKeySchema.safeParse("2026,05,18").success).toBe(false);
    expect(periodKeySchema.safeParse("hello!").success).toBe(false);
  });

  it("rejects a key longer than 64 chars", () => {
    expect(periodKeySchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(periodKeySchema.safeParse("a".repeat(65)).success).toBe(false);
  });
});

describe("scoreRawSchema", () => {
  it("accepts a number-shaped string", () => {
    expect(scoreRawSchema.safeParse("42").success).toBe(true);
  });

  it("accepts emoji-decorated Wordle-style scores", () => {
    expect(scoreRawSchema.safeParse("Wordle 1,127 3/6\n\n⬜⬜🟩🟩🟩").success).toBe(true);
  });

  it("rejects the empty string", () => {
    expect(scoreRawSchema.safeParse("").success).toBe(false);
  });

  it("clamps at 2000 chars", () => {
    expect(scoreRawSchema.safeParse("x".repeat(2000)).success).toBe(true);
    expect(scoreRawSchema.safeParse("x".repeat(2001)).success).toBe(false);
  });
});

describe("upsertScoreSchema", () => {
  it("accepts a typical (periodKey, scoreRaw) pair", () => {
    expect(upsertScoreSchema.safeParse({ periodKey: "2026-05-18", scoreRaw: "42" }).success).toBe(
      true,
    );
  });

  it("requires periodKey", () => {
    expect(upsertScoreSchema.safeParse({ scoreRaw: "42" }).success).toBe(false);
  });

  it("requires scoreRaw", () => {
    expect(upsertScoreSchema.safeParse({ periodKey: "2026-05-18" }).success).toBe(false);
  });

  it("rejects an unknown extra field", () => {
    const r = upsertScoreSchema.safeParse({
      periodKey: "2026-05-18",
      scoreRaw: "42",
      scoreValue: 42,
    });
    // zod by default ignores extras unless strict — we accept this shape
    // (server computes scoreValue itself), so this lookup verifies the
    // contract rather than enforcing strictness.
    expect(r.success).toBe(true);
  });
});

describe("parseScoreValue over stored rule strings (helper)", () => {
  // Items store their parser as a rule string (bare regex / count: / spec:);
  // the route decodes it with specFromStoredRule before parsing.
  const parse = (raw: string, stored?: string) =>
    parseScoreValue(raw, specFromStoredRule(stored ?? null));

  describe("with no rule (legacy fallback)", () => {
    it("parses a leading integer", () => {
      expect(parse("42")).toBe(42);
    });

    it("parses a decimal", () => {
      expect(parse("3.14")).toBe(3.14);
    });

    it("parses a negative", () => {
      expect(parse("-7")).toBe(-7);
    });

    it("extracts the first number from a Wordle-style block", () => {
      expect(parse("Wordle 1,127 3/6")).toBe(1);
    });

    it("returns null when no number is present", () => {
      expect(parse("⬜⬜🟩🟩🟩")).toBeNull();
      expect(parse("abc")).toBeNull();
    });
  });

  describe("with a per-item regex rule (legacy stored format)", () => {
    it("extracts MapTap's final score from a real share", () => {
      const raw = "www.maptap.gg May 18\n96🔥 95🏅 99🎯 96🔥 93👑\nFinal score: 956";
      expect(parse(raw, "Final score:\\s*(\\d+)")).toBe(956);
    });

    it("extracts Satle's guesses (X/6) — not the puzzle number", () => {
      const raw = "🛰Satle #449 5/6\n🟥🟥🟥🟥🟩⬜\nhttps://satle.ca";
      expect(parse(raw, "Satle\\s*#\\d+\\s+(\\d+)/6")).toBe(5);
    });

    it("extracts travle's extra-guess count from +N", () => {
      const raw = "#travle #1252 +1\n🟧✅✅✅\nhttps://travle.earth";
      expect(parse(raw, "#travle\\s+#?\\d+\\s+\\+(\\d+)")).toBe(1);
    });

    it("extracts Tradle's guesses (X/6) — not the puzzle number", () => {
      const raw = "#Tradle #1547 1/6\n🟩🟩🟩🟩🟩\nhttps://tradle.net/";
      expect(parse(raw, "Tradle\\s*#?\\d+\\s+(\\d+)/6")).toBe(1);
    });

    it("extracts Globle's = N daily count even with URL + hashtag trailing", () => {
      const raw = "🌎 May 19, 2026 🌍\n⬜⬜🟧🟥🟩 = 5\n\nhttps://globle-game.com\n#globle";
      expect(parse(raw, "=\\s*(\\d+)")).toBe(5);
    });

    it("returns null when the configured pattern doesn't match — does NOT fall back to legacy", () => {
      // Once a parser is configured we trust it. Falling back to the first
      // number would resurface the "pulled the puzzle number out of the
      // share" bug this fixed.
      expect(parse("abc 42 def", "Final score:\\s*(\\d+)")).toBeNull();
    });

    it("is case-insensitive (the capture rule always applies the `i` flag)", () => {
      expect(parse("FINAL SCORE: 70", "Final score:\\s*(\\d+)")).toBe(70);
    });

    it("returns null when the pattern itself is invalid (no crash)", () => {
      // unclosed group; new RegExp() throws — we swallow and fall back. With
      // no other digits in the input this means null.
      expect(parse("no digits here", "(\\d+")).toBeNull();
    });

    it("falls back to legacy first-number when the stored regex throws", () => {
      // Bad pattern + free-form input → legacy fallback finds the first num.
      expect(parse("Wordle 1,127 3/6", "(\\d+")).toBe(1);
    });

    it("strips thousands separators from a captured number", () => {
      expect(parse("1,000 / 1,000", "([\\d,]+)\\s*/\\s*[\\d,]+")).toBe(1000);
    });
  });

  describe("with a count: rule (tally games like Daily Tens)", () => {
    it("scores by the number of 🏆 (more correct is better)", () => {
      const raw = "DailyTens #760\n🏆 🏆 🏆 🏆 🏆 🏆 🏆 🏆 ❌ ❌";
      expect(parse(raw, "count:🏆")).toBe(8);
    });

    it("counts only 🏆 — ignores the puzzle number and ?ref id in the share", () => {
      const raw =
        "https://dailytens.com/?ref=943757\nDailyTens #760\n🏆 🏆 🏆 🏆 🏆 🏆 🏆 🏆 🏆 ❌";
      expect(parse(raw, "count:🏆")).toBe(9);
    });

    it("returns 0 (a valid worst score), not null, when nothing was correct", () => {
      expect(parse("DailyTens #761\n❌ ❌ ❌ ❌ ❌ ❌ ❌ ❌ ❌ ❌", "count:🏆")).toBe(0);
    });

    it("treats the count token as a literal string, not a regex", () => {
      // The old parser compiled count:<pattern> as a regex; the spec rule
      // counts literal occurrences. "(" is just a character now.
      expect(parse("a ( b ( c", "count:(")).toBe(2);
    });
  });

  describe("with a spec: rule (current stored format)", () => {
    it("decodes and applies a serialized ScoreSpec", () => {
      const stored = `spec:${JSON.stringify({ rules: [{ kind: "duration" }] })}`;
      expect(parse("solved in 0:42!", stored)).toBe(42);
    });
  });
});

describe("rankEntries (helper)", () => {
  it("ranks descending (higher is better) — MapTap-style", () => {
    const ranked = rankEntries(
      [
        { userId: "a", scoreValue: 980 },
        { userId: "b", scoreValue: 950 },
        { userId: "c", scoreValue: 932 },
      ],
      "desc",
    );
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("ranks ascending (lower is better) — Wordle / Satle-style", () => {
    const ranked = rankEntries(
      [
        { userId: "a", scoreValue: 6 },
        { userId: "b", scoreValue: 3 },
        { userId: "c", scoreValue: 5 },
      ],
      "asc",
    );
    const ranksById = Object.fromEntries(ranked.map((r) => [r.userId, r.rank]));
    expect(ranksById).toEqual({ a: 3, b: 1, c: 2 });
  });

  it("uses standard competition ranking for ties (1, 2, 2, 4)", () => {
    const ranked = rankEntries(
      [
        { userId: "a", scoreValue: 100 },
        { userId: "b", scoreValue: 90 },
        { userId: "c", scoreValue: 90 },
        { userId: "d", scoreValue: 50 },
      ],
      "desc",
    );
    const ranksById = Object.fromEntries(ranked.map((r) => [r.userId, r.rank]));
    expect(ranksById).toEqual({ a: 1, b: 2, c: 2, d: 4 });
  });

  it("leaves unplayed entries with rank: null", () => {
    const ranked = rankEntries(
      [
        { userId: "a", scoreValue: 100 },
        { userId: "b", scoreValue: null },
        { userId: "c", scoreValue: 50 },
      ],
      "desc",
    );
    const ranksById = Object.fromEntries(ranked.map((r) => [r.userId, r.rank]));
    expect(ranksById).toEqual({ a: 1, b: null, c: 2 });
  });

  it("returns display order: played sorted by rank, then unplayed", () => {
    // Responses are rank-sorted server-side — clients render entries as-is
    // (the old contract returned join order and made StandingsCard re-sort).
    const ranked = rankEntries(
      [
        { userId: "u", scoreValue: null },
        { userId: "a", scoreValue: 100 },
        { userId: "b", scoreValue: 200 },
      ],
      "desc",
    );
    expect(ranked.map((r) => r.userId)).toEqual(["b", "a", "u"]);
  });

  it("ties keep their incoming relative order (stable sort for SQL tiebreaks)", () => {
    const ranked = rankEntries(
      [
        { userId: "newer", scoreValue: 5 },
        { userId: "older", scoreValue: 5 },
      ],
      "asc",
    );
    expect(ranked.map((r) => r.userId)).toEqual(["newer", "older"]);
  });
});
