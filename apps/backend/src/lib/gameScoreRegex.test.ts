import { describe, expect, it } from "vitest";
import { GAME_REGEX_CATALOG, matchGameScoreRegex } from "./gameScoreRegex.js";

describe("matchGameScoreRegex", () => {
  it("identifies Daily Tens from its url (the self-heal path for the ?ref bug)", () => {
    const game = matchGameScoreRegex({ title: "Daily Tens", url: "https://dailytens.com/" });
    expect(game?.key).toBe("dailytens");
    expect(game?.scoreRegex).toBe("DailyTens\\s*#(\\d+)");
  });

  it("identifies a game from content.siteName / sourceId, not just title/url", () => {
    expect(matchGameScoreRegex({ siteName: "maptap.gg" })?.key).toBe("maptap");
    expect(matchGameScoreRegex({ sourceId: "globle-game.com/daily" })?.key).toBe("globle");
  });

  it("returns null for an item that doesn't match any known game", () => {
    expect(
      matchGameScoreRegex({ title: "My custom leaderboard", url: "https://example.com" }),
    ).toBe(null);
  });

  it("returns null when every field is empty/nullish", () => {
    expect(matchGameScoreRegex({})).toBe(null);
    expect(matchGameScoreRegex({ title: null, url: null, siteName: null, sourceId: null })).toBe(
      null,
    );
  });

  it("each Daily Tens regex captures the puzzle number, not the ?ref referral id", () => {
    const dailytens = GAME_REGEX_CATALOG.find((g) => g.key === "dailytens");
    expect(dailytens).toBeDefined();
    const raw = "DailyTens #751\n\n     🏆    ❌\nhttps://dailytens.com/?ref=944415";
    const match = raw.match(new RegExp(dailytens?.scoreRegex ?? "", "i"));
    expect(match?.[1]).toBe("751");
  });

  it("every catalog regex compiles and exposes a capture group", () => {
    for (const game of GAME_REGEX_CATALOG) {
      // Throws if the source is an invalid pattern — the backend stores it
      // verbatim on items.score_regex and applies it with `new RegExp(p, "i")`.
      expect(() => new RegExp(game.scoreRegex, "i")).not.toThrow();
      // Capture group 1 is what the backend reads for the numeric score.
      expect(game.scoreRegex).toContain("(");
    }
  });
});
